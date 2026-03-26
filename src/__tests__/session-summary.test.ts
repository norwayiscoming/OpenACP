import { describe, it, expect, vi } from "vitest";
import { Session } from "../core/session.js";
import { handleSummary, handleSummaryCallback } from "../adapters/telegram/commands/session.js";
import { formatSummary } from "../adapters/telegram/formatting.js";

// --- Session.generateSummary() ---

describe("Session.generateSummary", () => {
  function createTestSession(opts: {
    emitText?: string;
    promptFn?: () => Promise<void>;
  } = {}) {
    const listeners: Map<string, Function[]> = new Map();
    const agentInstance = {
      prompt: opts.promptFn ?? vi.fn(async () => {
        // Simulate agent emitting text during prompt execution
        if (opts.emitText) {
          const handlers = listeners.get("agent_event") || [];
          for (const h of handlers) h({ type: "text", content: opts.emitText });
        }
      }),
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      }),
      off: vi.fn((event: string, handler: Function) => {
        const arr = listeners.get(event);
        if (arr) listeners.set(event, arr.filter(h => h !== handler));
      }),
      onSessionUpdate: null,
      onPermissionRequest: null,
      sessionId: "agent-1",
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(),
    } as any;

    const session = new Session({
      channelId: "telegram",
      agentName: "claude",
      agentInstance,
    });
    session.activate();
    return session;
  }

  it("captures agent text response as summary", async () => {
    const session = createTestSession({ emitText: "Fixed auth bug in login.ts" });
    const summary = await session.generateSummary();
    expect(summary).toContain("Fixed auth bug");
  });

  it("returns empty string on timeout", async () => {
    const session = createTestSession({
      promptFn: () => new Promise(() => {}), // never resolves
    });
    const summary = await session.generateSummary(100);
    expect(summary).toBe("");
  });

  it("returns empty string on error", async () => {
    const session = createTestSession({
      promptFn: () => Promise.reject(new Error("agent crashed")),
    });
    const summary = await session.generateSummary();
    expect(summary).toBe("");
  });

  it("truncates long summaries to 500 chars", async () => {
    const session = createTestSession({ emitText: "A".repeat(600) });
    const summary = await session.generateSummary();
    expect(summary.length).toBeLessThanOrEqual(500);
  });
});

// --- Session.promptCount ---

describe("Session.promptCount", () => {
  it("starts at 0", () => {
    const session = new Session({
      channelId: "telegram",
      agentName: "claude",
      agentInstance: {
        prompt: vi.fn(async () => {}),
        on: vi.fn(),
        off: vi.fn(),
        onSessionUpdate: null,
        onPermissionRequest: null,
        sessionId: "a1",
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(),
      } as any,
    });
    expect(session.promptCount).toBe(0);
  });
});

// --- formatSummary ---

describe("formatSummary", () => {
  it("formats with session name", () => {
    const result = formatSummary("Fixed auth bug.", "Fix login");
    expect(result).toContain("Summary — Fix login");
    expect(result).toContain("Fixed auth bug.");
  });

  it("formats without session name", () => {
    const result = formatSummary("Fixed auth bug.");
    expect(result).toContain("Session Summary");
  });
});

// --- handleSummary command ---

describe("handleSummary", () => {
  it("shows guidance in non-session topic", async () => {
    const ctx = {
      message: { message_thread_id: 999 },
      reply: vi.fn(() => Promise.resolve()),
    } as any;
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => undefined),
        getRecordByThread: vi.fn(() => undefined),
      },
    } as any;

    await handleSummary(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("/summary"),
      expect.any(Object),
    );
  });

  it("calls summarizeSession for ended session via record", async () => {
    const ctx = {
      message: { message_thread_id: 456 },
      reply: vi.fn(() => Promise.resolve()),
      replyWithChatAction: vi.fn(() => Promise.resolve()),
    } as any;
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => undefined),
        getRecordByThread: vi.fn(() => ({ sessionId: "s1", name: "Old Session" })),
      },
      summarizeSession: vi.fn(() => Promise.resolve({ ok: true, summary: "Did some work." })),
    } as any;

    await handleSummary(ctx, core);
    expect(core.summarizeSession).toHaveBeenCalledWith("s1");
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Did some work"),
      expect.any(Object),
    );
  });

  it("calls summarizeSession and displays result", async () => {
    const ctx = {
      message: { message_thread_id: 456 },
      reply: vi.fn(() => Promise.resolve()),
      replyWithChatAction: vi.fn(() => Promise.resolve()),
    } as any;
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => ({ id: "s1", status: "active", name: "Test" })),
      },
      summarizeSession: vi.fn(() => Promise.resolve({ ok: true, summary: "Fixed auth bug." })),
    } as any;

    await handleSummary(ctx, core);
    expect(core.summarizeSession).toHaveBeenCalledWith("s1");
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Fixed auth bug"),
      expect.any(Object),
    );
  });

  it("shows error when summary fails", async () => {
    const ctx = {
      message: { message_thread_id: 456 },
      reply: vi.fn(() => Promise.resolve()),
      replyWithChatAction: vi.fn(() => Promise.resolve()),
    } as any;
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => ({ id: "s1", status: "active" })),
      },
      summarizeSession: vi.fn(() => Promise.resolve({ ok: false, error: "Agent timeout" })),
    } as any;

    await handleSummary(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Agent timeout"),
      expect.any(Object),
    );
  });
});

// --- handleSummaryCallback ---

describe("handleSummaryCallback", () => {
  it("uses record for ended session", async () => {
    const ctx = {
      callbackQuery: { data: "sm:summary:sess-1" },
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      api: { sendMessage: vi.fn(() => Promise.resolve()) },
    } as any;
    const core = {
      sessionManager: {
        getSession: vi.fn(() => null),
        getSessionRecord: vi.fn(() => ({ sessionId: "sess-1", name: "Old", platform: { topicId: 456 } })),
      },
      summarizeSession: vi.fn(() => Promise.resolve({ ok: true, summary: "Recap." })),
    } as any;

    await handleSummaryCallback(ctx, core, 123);
    expect(core.summarizeSession).toHaveBeenCalledWith("sess-1");
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(
      123,
      expect.stringContaining("Recap"),
      expect.objectContaining({ message_thread_id: 456 }),
    );
  });

  it("sends summary to session topic on success", async () => {
    const ctx = {
      callbackQuery: { data: "sm:summary:sess-1" },
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      api: { sendMessage: vi.fn(() => Promise.resolve()) },
    } as any;
    const core = {
      sessionManager: {
        getSession: vi.fn(() => ({ id: "sess-1", status: "active", threadId: "789", name: "Test" })),
      },
      summarizeSession: vi.fn(() => Promise.resolve({ ok: true, summary: "All done." })),
    } as any;

    await handleSummaryCallback(ctx, core, 123);
    expect(core.summarizeSession).toHaveBeenCalledWith("sess-1");
    // Second sendMessage call should contain the summary
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(
      123,
      expect.stringContaining("All done."),
      expect.objectContaining({ message_thread_id: 789 }),
    );
  });
});
