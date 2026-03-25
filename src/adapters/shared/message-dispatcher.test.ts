import { describe, it, expect, vi } from "vitest";
import {
  dispatchMessage,
  shouldDispatch,
  type MessageHandlers,
} from "./message-dispatcher.js";
import type { OutgoingMessage } from "../../core/types.js";

function createMockHandlers(): MessageHandlers<string> {
  return {
    onText: vi.fn(),
    onThought: vi.fn(),
    onToolCall: vi.fn(),
    onToolUpdate: vi.fn(),
    onPlan: vi.fn(),
    onUsage: vi.fn(),
    onSessionEnd: vi.fn(),
    onError: vi.fn(),
    onAttachment: vi.fn(),
    onSystemMessage: vi.fn(),
  };
}

describe("dispatchMessage", () => {
  it("routes text to onText", async () => {
    const h = createMockHandlers();
    const msg: OutgoingMessage = { type: "text", text: "hello" };
    await dispatchMessage(h, "ctx", msg);
    expect(h.onText).toHaveBeenCalledWith("ctx", msg);
  });

  it("routes each type to correct handler", async () => {
    const types = [
      "text",
      "thought",
      "tool_call",
      "tool_update",
      "plan",
      "usage",
      "session_end",
      "error",
      "attachment",
      "system_message",
    ] as const;
    for (const type of types) {
      const h = createMockHandlers();
      const msg = { type, text: "" } as OutgoingMessage;
      await dispatchMessage(h, "ctx", msg);
      const handlerName =
        `on${type.charAt(0).toUpperCase()}${type.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}` as keyof MessageHandlers<string>;
      expect(h[handlerName]).toHaveBeenCalled();
    }
  });

  it("unknown type does not crash", async () => {
    const h = createMockHandlers();
    const msg = { type: "unknown_xyz", text: "" } as unknown as OutgoingMessage;
    await expect(dispatchMessage(h, "ctx", msg)).resolves.toBeUndefined();
  });
});

describe("shouldDispatch", () => {
  it("hides thought on low", () => {
    expect(shouldDispatch("thought", "low")).toBe(false);
  });
  it("hides plan on low", () => {
    expect(shouldDispatch("plan", "low")).toBe(false);
  });
  it("hides usage on low", () => {
    expect(shouldDispatch("usage", "low")).toBe(false);
  });
  it("shows text on low", () => {
    expect(shouldDispatch("text", "low")).toBe(true);
  });
  it("shows tool_call on low", () => {
    expect(shouldDispatch("tool_call", "low")).toBe(true);
  });
  it("shows error on low", () => {
    expect(shouldDispatch("error", "low")).toBe(true);
  });
  it("shows session_end on low", () => {
    expect(shouldDispatch("session_end", "low")).toBe(true);
  });
  it("shows thought on medium", () => {
    expect(shouldDispatch("thought", "medium")).toBe(true);
  });
  it("shows thought on high", () => {
    expect(shouldDispatch("thought", "high")).toBe(true);
  });
  it("shows plan on medium", () => {
    expect(shouldDispatch("plan", "medium")).toBe(true);
  });
  it("shows usage on high", () => {
    expect(shouldDispatch("usage", "high")).toBe(true);
  });
});

describe("dispatchMessage with verbosity filtering", () => {
  it("does NOT call onThought on low", async () => {
    const h = createMockHandlers();
    const msg: OutgoingMessage = { type: "thought", text: "thinking..." };
    await dispatchMessage(h, "ctx", msg, "low");
    expect(h.onThought).not.toHaveBeenCalled();
  });

  it("does NOT call onPlan on low", async () => {
    const h = createMockHandlers();
    const msg: OutgoingMessage = {
      type: "plan",
      text: "",
      metadata: { entries: [] },
    };
    await dispatchMessage(h, "ctx", msg, "low");
    expect(h.onPlan).not.toHaveBeenCalled();
  });

  it("does NOT call onUsage on low", async () => {
    const h = createMockHandlers();
    const msg: OutgoingMessage = {
      type: "usage",
      text: "",
      metadata: { tokensUsed: 100 },
    };
    await dispatchMessage(h, "ctx", msg, "low");
    expect(h.onUsage).not.toHaveBeenCalled();
  });

  it("calls onText on low", async () => {
    const h = createMockHandlers();
    const msg: OutgoingMessage = { type: "text", text: "hello" };
    await dispatchMessage(h, "ctx", msg, "low");
    expect(h.onText).toHaveBeenCalled();
  });

  it("calls onToolCall on low", async () => {
    const h = createMockHandlers();
    const msg: OutgoingMessage = {
      type: "tool_call",
      text: "Read",
      metadata: { name: "Read" },
    };
    await dispatchMessage(h, "ctx", msg, "low");
    expect(h.onToolCall).toHaveBeenCalled();
  });

  it("calls onThought on medium", async () => {
    const h = createMockHandlers();
    const msg: OutgoingMessage = { type: "thought", text: "thinking..." };
    await dispatchMessage(h, "ctx", msg, "medium");
    expect(h.onThought).toHaveBeenCalled();
  });

  it("calls onPlan on high", async () => {
    const h = createMockHandlers();
    const msg: OutgoingMessage = {
      type: "plan",
      text: "",
      metadata: { entries: [] },
    };
    await dispatchMessage(h, "ctx", msg, "high");
    expect(h.onPlan).toHaveBeenCalled();
  });
});
