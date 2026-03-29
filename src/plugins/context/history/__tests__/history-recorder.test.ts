import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryRecorder } from "../history-recorder.js";
import { HistoryStore } from "../history-store.js";
import type { AgentEvent, Attachment } from "../../../../core/types.js";
import type { SessionHistory, Step, ToolCallStep } from "../types.js";

function makeStore() {
  return {
    write: vi.fn<[SessionHistory], Promise<void>>().mockResolvedValue(undefined),
    read: vi.fn<[string], Promise<SessionHistory | null>>().mockResolvedValue(null),
    exists: vi.fn<[string], Promise<boolean>>().mockResolvedValue(false),
    list: vi.fn<[], Promise<string[]>>().mockResolvedValue([]),
    delete: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
  } as unknown as HistoryStore & { write: ReturnType<typeof vi.fn> };
}

function att(overrides?: Partial<Attachment>): Attachment {
  return {
    type: "image",
    filePath: "/tmp/img.png",
    fileName: "img.png",
    mimeType: "image/png",
    size: 1024,
    ...overrides,
  };
}

describe("HistoryRecorder", () => {
  let store: ReturnType<typeof makeStore>;
  let recorder: HistoryRecorder;

  beforeEach(() => {
    store = makeStore();
    recorder = new HistoryRecorder(store as unknown as HistoryStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── User turn capture ──

  describe("onBeforePrompt", () => {
    it("creates a user turn with content", () => {
      recorder.onBeforePrompt("s1", "Hello world", undefined);
      const state = recorder.getState("s1");
      expect(state).toBeDefined();
      expect(state!.history.turns).toHaveLength(2); // user + pre-created assistant
      expect(state!.history.turns[0]).toMatchObject({
        index: 0,
        role: "user",
        content: "Hello world",
      });
      expect(state!.history.turns[0].timestamp).toBeDefined();
    });

    it("records attachments on user turn (stripping filePath)", () => {
      const attachments: Attachment[] = [
        att({ fileName: "photo.jpg", mimeType: "image/jpeg", size: 2048 }),
      ];
      recorder.onBeforePrompt("s1", "See image", attachments);
      const userTurn = recorder.getState("s1")!.history.turns[0];
      expect(userTurn.attachments).toEqual([
        { type: "image", fileName: "photo.jpg", mimeType: "image/jpeg", size: 2048 },
      ]);
      // filePath must NOT be present
      expect((userTurn.attachments![0] as any).filePath).toBeUndefined();
    });

    it("pre-creates an assistant turn for step accumulation", () => {
      recorder.onBeforePrompt("s1", "Hi", undefined);
      const assistantTurn = recorder.getState("s1")!.history.turns[1];
      expect(assistantTurn.role).toBe("assistant");
      expect(assistantTurn.index).toBe(1);
      expect(assistantTurn.steps).toEqual([]);
    });
  });

  // ── Text chunk accumulation ──

  describe("text accumulation", () => {
    it("consecutive text chunks merge into one step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", { type: "text", content: "Hello " });
      recorder.onAfterEvent("s1", { type: "text", content: "world" });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps).toHaveLength(1);
      expect(steps[0]).toEqual({ type: "text", content: "Hello world" });
    });

    it("text chunks separated by a different type create separate steps", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", { type: "text", content: "A" });
      recorder.onAfterEvent("s1", { type: "thought", content: "hmm" });
      recorder.onAfterEvent("s1", { type: "text", content: "B" });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps).toHaveLength(3);
      expect(steps[0]).toEqual({ type: "text", content: "A" });
      expect(steps[1]).toEqual({ type: "thinking", content: "hmm" });
      expect(steps[2]).toEqual({ type: "text", content: "B" });
    });
  });

  // ── Thinking chunk accumulation ──

  describe("thinking accumulation", () => {
    it("consecutive thought chunks merge into one thinking step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", { type: "thought", content: "Let me " });
      recorder.onAfterEvent("s1", { type: "thought", content: "think..." });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps).toHaveLength(1);
      expect(steps[0]).toEqual({ type: "thinking", content: "Let me think..." });
    });

    it("thought separated by text creates separate steps", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", { type: "thought", content: "A" });
      recorder.onAfterEvent("s1", { type: "text", content: "X" });
      recorder.onAfterEvent("s1", { type: "thought", content: "B" });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps).toHaveLength(3);
    });
  });

  // ── Tool call and update ──

  describe("tool_call and tool_update", () => {
    it("creates a tool_call step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "tool_call",
        id: "tc1",
        name: "read_file",
        kind: "bash",
        status: "running",
      });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({
        type: "tool_call",
        id: "tc1",
        name: "read_file",
        kind: "bash",
        status: "running",
      });
    });

    it("tool_update updates existing tool_call step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "tool_call",
        id: "tc1",
        name: "read_file",
        status: "running",
      });
      recorder.onAfterEvent("s1", {
        type: "tool_update",
        id: "tc1",
        status: "completed",
        rawInput: { path: "/tmp/f" },
        rawOutput: "contents",
      });
      const step = recorder.getState("s1")!.history.turns[1].steps![0] as ToolCallStep;
      expect(step.status).toBe("completed");
      expect(step.input).toEqual({ path: "/tmp/f" });
      expect(step.output).toBe("contents");
    });

    it("tool_update updates locations", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "tool_call",
        id: "tc1",
        name: "edit",
        status: "running",
      });
      recorder.onAfterEvent("s1", {
        type: "tool_update",
        id: "tc1",
        status: "done",
        locations: [{ path: "/a.ts", line: 10 }],
      });
      const step = recorder.getState("s1")!.history.turns[1].steps![0] as ToolCallStep;
      expect(step.locations).toEqual([{ path: "/a.ts", line: 10 }]);
    });

    it("tool_update extracts diff from content", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "tool_call",
        id: "tc1",
        name: "edit",
        status: "running",
      });
      recorder.onAfterEvent("s1", {
        type: "tool_update",
        id: "tc1",
        status: "done",
        content: [
          { type: "diff", path: "/a.ts", oldText: "old", newText: "new" },
        ],
      });
      const step = recorder.getState("s1")!.history.turns[1].steps![0] as ToolCallStep;
      expect(step.diff).toEqual({ path: "/a.ts", oldText: "old", newText: "new" });
    });

    it("tool_update for unknown id is a no-op", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "tool_update",
        id: "unknown",
        status: "done",
      });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps).toHaveLength(0);
    });
  });

  // ── Diff extraction ──

  describe("diff extraction edge cases", () => {
    it("returns null when content is not an array", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "tool_call",
        id: "tc1",
        name: "edit",
        status: "running",
      });
      recorder.onAfterEvent("s1", {
        type: "tool_update",
        id: "tc1",
        status: "done",
        content: "some string",
      });
      const step = recorder.getState("s1")!.history.turns[1].steps![0] as ToolCallStep;
      expect(step.diff).toBeUndefined();
    });

    it("returns null when array has no diff entry", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "tool_call",
        id: "tc1",
        name: "edit",
        status: "running",
      });
      recorder.onAfterEvent("s1", {
        type: "tool_update",
        id: "tc1",
        status: "done",
        content: [{ type: "text", text: "ok" }],
      });
      const step = recorder.getState("s1")!.history.turns[1].steps![0] as ToolCallStep;
      expect(step.diff).toBeUndefined();
    });
  });

  // ── Plan events ──

  describe("plan events", () => {
    it("creates a plan step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "plan",
        entries: [
          { content: "Step 1", status: "pending", priority: "high" },
          { content: "Step 2", status: "in_progress", priority: "medium" },
        ],
      });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps).toHaveLength(1);
      expect(steps[0]).toEqual({
        type: "plan",
        entries: [
          { content: "Step 1", status: "pending", priority: "high" },
          { content: "Step 2", status: "in_progress", priority: "medium" },
        ],
      });
    });
  });

  // ── Usage ──

  describe("usage events", () => {
    it("sets turn-level usage (not a step)", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "usage",
        tokensUsed: 500,
        contextSize: 10000,
        cost: { amount: 0.01, currency: "USD" },
      });
      const turn = recorder.getState("s1")!.history.turns[1];
      expect(turn.steps).toHaveLength(0);
      expect(turn.usage).toEqual({
        tokensUsed: 500,
        contextSize: 10000,
        cost: { amount: 0.01, currency: "USD" },
      });
    });
  });

  // ── Image / Audio / Resource / ResourceLink ──

  describe("media and resource events", () => {
    it("creates an image step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "image_content",
        data: "base64data",
        mimeType: "image/png",
      });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    });

    it("creates an audio step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "audio_content",
        data: "base64audio",
        mimeType: "audio/mp3",
      });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps[0]).toMatchObject({ type: "audio", mimeType: "audio/mp3" });
    });

    it("creates a resource step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "resource_content",
        uri: "file:///a.ts",
        name: "a.ts",
        text: "content",
      });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps[0]).toEqual({
        type: "resource",
        uri: "file:///a.ts",
        name: "a.ts",
        text: "content",
      });
    });

    it("creates a resource_link step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "resource_link",
        uri: "https://example.com",
        name: "example",
        title: "Example",
        description: "A link",
      });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps[0]).toEqual({
        type: "resource_link",
        uri: "https://example.com",
        name: "example",
        title: "Example",
        description: "A link",
      });
    });
  });

  // ── Mode change / Config change ──

  describe("mode and config changes", () => {
    it("creates a mode_change step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", { type: "current_mode_update", modeId: "code" });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps[0]).toEqual({ type: "mode_change", modeId: "code" });
    });

    it("creates one config_change step per option", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "config_option_update",
        options: [
          { id: "theme", name: "Theme", type: "select", currentValue: "dark", options: [] },
          { id: "verbose", name: "Verbose", type: "boolean", currentValue: true },
        ],
      });
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps).toHaveLength(2);
      expect(steps[0]).toEqual({ type: "config_change", configId: "theme", value: "dark" });
      expect(steps[1]).toEqual({ type: "config_change", configId: "verbose", value: "true" });
    });
  });

  // ── Turn finalization ──

  describe("onTurnEnd", () => {
    it("sets stopReason and writes to disk", async () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", { type: "text", content: "Done" });
      await recorder.onTurnEnd("s1", "end_turn");
      const assistantTurn = store.write.mock.calls[0][0].turns[1];
      expect(assistantTurn.stopReason).toBe("end_turn");
      expect(store.write).toHaveBeenCalledTimes(1);
      expect(store.write.mock.calls[0][0].sessionId).toBe("s1");
    });

    it("is a no-op for unknown session", async () => {
      await recorder.onTurnEnd("unknown", "end_turn");
      expect(store.write).not.toHaveBeenCalled();
    });
  });

  // ── Multiple turns ──

  describe("multiple turns in sequence", () => {
    it("accumulates turns correctly across prompts", async () => {
      recorder.onBeforePrompt("s1", "First", undefined);
      recorder.onAfterEvent("s1", { type: "text", content: "Reply 1" });
      await recorder.onTurnEnd("s1", "end_turn");

      recorder.onBeforePrompt("s1", "Second", undefined);
      recorder.onAfterEvent("s1", { type: "text", content: "Reply 2" });
      await recorder.onTurnEnd("s1", "end_turn");

      const written = store.write.mock.calls[1][0] as SessionHistory;
      expect(written.turns).toHaveLength(4);
      expect(written.turns[0]).toMatchObject({ index: 0, role: "user", content: "First" });
      expect(written.turns[1]).toMatchObject({ index: 1, role: "assistant", stopReason: "end_turn" });
      expect(written.turns[2]).toMatchObject({ index: 2, role: "user", content: "Second" });
      expect(written.turns[3]).toMatchObject({ index: 3, role: "assistant", stopReason: "end_turn" });
    });
  });

  // ── Permission capture ──

  describe("onPermissionResolved", () => {
    it("attaches permission to matching tool_call step", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onAfterEvent("s1", {
        type: "tool_call",
        id: "tc1",
        name: "write_file",
        status: "running",
      });
      recorder.onPermissionResolved("s1", "tc1", "allowed");
      const step = recorder.getState("s1")!.history.turns[1].steps![0] as ToolCallStep;
      expect(step.permission).toEqual({ requested: true, outcome: "allowed" });
    });

    it("is a no-op for unknown session", () => {
      // Should not throw
      recorder.onPermissionResolved("unknown", "tc1", "denied");
    });

    it("is a no-op for unknown tool_call id", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      recorder.onPermissionResolved("s1", "missing-id", "denied");
      // No steps at all
      expect(recorder.getState("s1")!.history.turns[1].steps).toHaveLength(0);
    });
  });

  // ── Session cleanup ──

  describe("finalize", () => {
    it("removes in-memory state", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      expect(recorder.getState("s1")).toBeDefined();
      recorder.finalize("s1");
      expect(recorder.getState("s1")).toBeUndefined();
    });

    it("is safe to call for unknown session", () => {
      recorder.finalize("nonexistent");
    });
  });

  // ── Ignored events ──

  describe("ignored events", () => {
    it("ignores events for unknown session", () => {
      // Should not throw
      recorder.onAfterEvent("unknown", { type: "text", content: "hello" });
    });

    it("ignores event types that should be skipped", () => {
      recorder.onBeforePrompt("s1", "Go", undefined);
      const ignoredEvents: AgentEvent[] = [
        { type: "session_end", reason: "done" },
        { type: "error", message: "err" },
        { type: "system_message", message: "sys" },
        { type: "commands_update", commands: [] },
        { type: "session_info_update", title: "t" },
        { type: "model_update", modelId: "m" },
        { type: "user_message_chunk", content: "c" },
        { type: "tts_strip" },
      ];
      for (const event of ignoredEvents) {
        recorder.onAfterEvent("s1", event);
      }
      const steps = recorder.getState("s1")!.history.turns[1].steps!;
      expect(steps).toHaveLength(0);
    });
  });
});
