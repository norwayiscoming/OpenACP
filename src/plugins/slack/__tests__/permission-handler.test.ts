import { describe, expect, it, vi } from "vitest";
import { SlackPermissionHandler } from "../permission-handler.js";
import type { ISlackSendQueue } from "../send-queue.js";

function createMockApp() {
  let actionHandler: Function | undefined;
  return {
    action: vi.fn((_pattern: any, handler: Function) => { actionHandler = handler; }),
    _triggerAction: async (payload: any) => {
      if (actionHandler) await actionHandler(payload);
    },
  };
}

function makeMockQueue() {
  return {
    enqueue: vi.fn().mockResolvedValue({}),
  };
}

describe("SlackPermissionHandler", () => {
  it("calls onResponse with parsed requestId and optionId when button is clicked", async () => {
    const onResponse = vi.fn();
    const queue = makeMockQueue();
    const handler = new SlackPermissionHandler(queue as any, onResponse);
    const app = createMockApp();
    handler.register(app as any);

    await app._triggerAction({
      ack: vi.fn().mockResolvedValue(undefined),
      action: { value: "req-123:allow" },
      body: {
        channel: { id: "C123" },
        message: { ts: "1234567890.123456" },
      },
    });

    expect(onResponse).toHaveBeenCalledWith("req-123", "allow");
  });

  it("ignores action values without colon separator (malformed value)", async () => {
    const onResponse = vi.fn();
    const queue = makeMockQueue();
    const handler = new SlackPermissionHandler(queue as any, onResponse);
    const app = createMockApp();
    handler.register(app as any);

    await app._triggerAction({
      ack: vi.fn().mockResolvedValue(undefined),
      action: { value: "malformed-no-colon" },
      body: {
        channel: { id: "C123" },
        message: { ts: "1234567890.123456" },
      },
    });

    expect(onResponse).not.toHaveBeenCalled();
  });

  it("updates the original message after response (calls queue.enqueue with chat.update)", async () => {
    const onResponse = vi.fn();
    const queue = makeMockQueue();
    const handler = new SlackPermissionHandler(queue as any, onResponse);
    const app = createMockApp();
    handler.register(app as any);

    await app._triggerAction({
      ack: vi.fn().mockResolvedValue(undefined),
      action: { value: "req-abc:deny" },
      body: {
        channel: { id: "C456" },
        message: { ts: "9876543210.654321" },
      },
    });

    expect(queue.enqueue).toHaveBeenCalledWith("chat.update", expect.objectContaining({
      channel: "C456",
      ts: "9876543210.654321",
    }));
  });

  it("cleanupSession edits pending permission messages to remove buttons", async () => {
    const mockQueue: ISlackSendQueue = {
      enqueue: vi.fn().mockResolvedValue({ ts: "msg-ts-1" }),
    };
    const handler = new SlackPermissionHandler(mockQueue, vi.fn());

    handler.trackPendingMessage("req-1", "C123", "msg-ts-1");

    await handler.cleanupSession("C123");

    expect(mockQueue.enqueue).toHaveBeenCalledWith("chat.update", expect.objectContaining({
      channel: "C123",
      ts: "msg-ts-1",
      blocks: [],
    }));
  });

  it("handles missing message in body gracefully (no crash when body.message is undefined)", async () => {
    const onResponse = vi.fn();
    const queue = makeMockQueue();
    const handler = new SlackPermissionHandler(queue as any, onResponse);
    const app = createMockApp();
    handler.register(app as any);

    await expect(app._triggerAction({
      ack: vi.fn().mockResolvedValue(undefined),
      action: { value: "req-xyz:allow" },
      body: {
        channel: { id: "C789" },
        message: undefined,
      },
    })).resolves.not.toThrow();

    expect(onResponse).toHaveBeenCalledWith("req-xyz", "allow");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
