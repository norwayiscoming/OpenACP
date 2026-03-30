import { describe, expect, it, vi } from "vitest";
import { SlackChannelManager } from "../channel-manager.js";
import type { ISlackSendQueue } from "../send-queue.js";
import type { SlackChannelConfig } from "../types.js";

function makeConfig(overrides: Partial<SlackChannelConfig> = {}): SlackChannelConfig {
  return {
    enabled: true,
    botToken: "xoxb-test",
    appToken: "xapp-test",
    signingSecret: "secret",
    allowedUserIds: [],
    channelPrefix: "openacp",
    autoCreateSession: true,
    ...overrides,
  } as SlackChannelConfig;
}

function makeMockQueue(overrides: Partial<{ enqueue: ReturnType<typeof vi.fn> }> = {}) {
  return {
    enqueue: vi.fn().mockResolvedValue({ channel: { id: "C_NEW" } }),
    ...overrides,
  };
}

describe("SlackChannelManager", () => {
  it("creates channel and returns meta (happy path)", async () => {
    const queue = makeMockQueue();
    const manager = new SlackChannelManager(queue as any, makeConfig());

    const meta = await manager.createChannel("sess-1", "Fix Auth Bug");

    expect(queue.enqueue).toHaveBeenCalledWith(
      "conversations.create",
      expect.objectContaining({ is_private: true }),
    );
    expect(meta.channelId).toBe("C_NEW");
    expect(meta.channelSlug).toMatch(/^openacp-/);
  });

  it("retries with new slug on name_taken error", async () => {
    const nameTakenError = { data: { error: "name_taken" } };
    const queue = {
      enqueue: vi.fn()
        .mockRejectedValueOnce(nameTakenError)
        .mockResolvedValue({ channel: { id: "C_RETRY" } }),
    };
    const manager = new SlackChannelManager(queue as any, makeConfig());

    const meta = await manager.createChannel("sess-2", "Duplicate Session");

    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(meta.channelId).toBe("C_RETRY");
  });

  it("throws non-name_taken errors", async () => {
    const otherError = new Error("rate_limited");
    const queue = {
      enqueue: vi.fn().mockRejectedValue(otherError),
    };
    const manager = new SlackChannelManager(queue as any, makeConfig());

    await expect(manager.createChannel("sess-3", "Some Session")).rejects.toThrow("rate_limited");
  });

  it("invites allowedUserIds when configured", async () => {
    const queue = makeMockQueue();
    const manager = new SlackChannelManager(
      queue as any,
      makeConfig({ allowedUserIds: ["U1", "U2"] }),
    );

    await manager.createChannel("sess-4", "Restricted Session");

    expect(queue.enqueue).toHaveBeenCalledWith(
      "conversations.invite",
      expect.objectContaining({ channel: "C_NEW", users: "U1,U2" }),
    );
  });

  it("skips invite when allowedUserIds is empty", async () => {
    const queue = makeMockQueue();
    const manager = new SlackChannelManager(queue as any, makeConfig({ allowedUserIds: [] }));

    await manager.createChannel("sess-5", "Open Session");

    const inviteCalls = (queue.enqueue.mock.calls as any[]).filter(
      (call) => call[0] === "conversations.invite",
    );
    expect(inviteCalls).toHaveLength(0);
  });

  it("retries up to 3 times on name_taken, then throws", async () => {
    const mockQueue: ISlackSendQueue = {
      enqueue: vi.fn()
        .mockRejectedValueOnce({ data: { error: "name_taken" } })
        .mockRejectedValueOnce({ data: { error: "name_taken" } })
        .mockRejectedValueOnce({ data: { error: "name_taken" } }),
    };

    const manager = new SlackChannelManager(mockQueue, { channelPrefix: "test" } as any);

    await expect(manager.createChannel("s1", "test")).rejects.toThrow();
    expect(mockQueue.enqueue).toHaveBeenCalledTimes(3);
  });

  it("succeeds on second attempt after name_taken", async () => {
    const mockQueue: ISlackSendQueue = {
      enqueue: vi.fn()
        .mockRejectedValueOnce({ data: { error: "name_taken" } })
        .mockResolvedValueOnce({ channel: { id: "C456" } })
        .mockResolvedValue(undefined),
    };

    const manager = new SlackChannelManager(mockQueue, {
      channelPrefix: "test",
      allowedUserIds: [],
    } as any);

    const result = await manager.createChannel("s1", "test");
    expect(result.channelId).toBe("C456");
    expect(mockQueue.enqueue).toHaveBeenCalledTimes(2);
  });
});
