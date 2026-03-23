import { describe, it, expect, vi } from "vitest";
import { dispatchMessage, type MessageHandlers } from "./message-dispatcher.js";
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
      const handlerName = `on${type.charAt(0).toUpperCase()}${type.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}` as keyof MessageHandlers<string>;
      expect(h[handlerName]).toHaveBeenCalled();
    }
  });

  it("unknown type does not crash", async () => {
    const h = createMockHandlers();
    const msg = { type: "unknown_xyz", text: "" } as any;
    await expect(dispatchMessage(h, "ctx", msg)).resolves.toBeUndefined();
  });
});
