import { describe, expect, it, vi } from "vitest";
import { SlackEventRouter } from "../event-router.js";
import type { SlackChannelConfig } from "../types.js";

function createMockApp() {
  const handlers: Record<string, Function> = {};
  return {
    message: vi.fn((handler: Function) => { handlers["message"] = handler; }),
    _trigger: async (event: string, payload: any) => {
      const handler = handlers[event];
      if (handler) await handler(payload);
    },
  };
}

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

describe("SlackEventRouter", () => {
  it("ignores bot messages (message has bot_id field)", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue(undefined);
    const router = new SlackEventRouter(sessionLookup, onIncoming, "BOT1", "NOTIF", onNewSession, makeConfig());
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "C123", user: "U1", text: "hello", bot_id: "B1" } });

    expect(onIncoming).not.toHaveBeenCalled();
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it("ignores own messages (userId matches botUserId)", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue(undefined);
    const router = new SlackEventRouter(sessionLookup, onIncoming, "BOT1", "NOTIF", onNewSession, makeConfig());
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "C123", user: "BOT1", text: "hello" } });

    expect(onIncoming).not.toHaveBeenCalled();
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it("ignores messages with subtype (edited, deleted)", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue(undefined);
    const router = new SlackEventRouter(sessionLookup, onIncoming, "BOT1", "NOTIF", onNewSession, makeConfig());
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "C123", user: "U1", text: "edited", subtype: "message_changed" } });

    expect(onIncoming).not.toHaveBeenCalled();
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it("rejects messages from non-allowed users when allowedUserIds is configured", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue(undefined);
    const router = new SlackEventRouter(
      sessionLookup,
      onIncoming,
      "BOT1",
      "NOTIF",
      onNewSession,
      makeConfig({ allowedUserIds: ["U_ALLOWED"] }),
    );
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "C123", user: "U_NOT_ALLOWED", text: "hello" } });

    expect(onIncoming).not.toHaveBeenCalled();
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it("allows messages when allowedUserIds is empty (open access mode)", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue(undefined);
    const router = new SlackEventRouter(
      sessionLookup,
      onIncoming,
      "BOT1",
      "NOTIF",
      onNewSession,
      makeConfig({ allowedUserIds: [] }),
    );
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "NOTIF", user: "U_ANYONE", text: "hello" } });

    expect(onNewSession).toHaveBeenCalledWith("hello", "U_ANYONE");
  });

  it("routes to onIncoming when sessionLookup returns a match", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue({ channelId: "C123", channelSlug: "openacp-session-abc1" });
    const router = new SlackEventRouter(sessionLookup, onIncoming, "BOT1", "NOTIF", onNewSession, makeConfig());
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "C123", user: "U1", text: "hello" } });

    expect(onIncoming).toHaveBeenCalledWith("openacp-session-abc1", "hello", "U1", undefined);
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it("routes file_share messages with audio clips", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue({ channelId: "C123", channelSlug: "openacp-session-abc1" });
    const router = new SlackEventRouter(sessionLookup, onIncoming, "BOT1", "NOTIF", onNewSession, makeConfig());
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", {
      message: {
        channel: "C123",
        user: "U1",
        text: "",
        subtype: "file_share",
        files: [
          { id: "F1", name: "audio_message_abc.mp4", mimetype: "video/mp4", size: 1024, url_private: "https://files.slack.com/F1" },
        ],
      },
    });

    expect(onIncoming).toHaveBeenCalledWith(
      "openacp-session-abc1",
      "",
      "U1",
      [{ id: "F1", name: "audio_message_abc.mp4", mimetype: "video/mp4", size: 1024, url_private: "https://files.slack.com/F1" }],
    );
  });

  it("still blocks edited/deleted subtypes", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue({ channelId: "C123", channelSlug: "openacp-session-abc1" });
    const router = new SlackEventRouter(sessionLookup, onIncoming, "BOT1", "NOTIF", onNewSession, makeConfig());
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "C123", user: "U1", text: "edited", subtype: "message_changed" } });
    expect(onIncoming).not.toHaveBeenCalled();

    await app._trigger("message", { message: { channel: "C123", user: "U1", text: "deleted", subtype: "message_deleted" } });
    expect(onIncoming).not.toHaveBeenCalled();
  });

  it("routes to onNewSession when message is in notification channel and no session match", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue(undefined);
    const router = new SlackEventRouter(sessionLookup, onIncoming, "BOT1", "NOTIF_CHAN", onNewSession, makeConfig());
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "NOTIF_CHAN", user: "U1", text: "new task" } });

    expect(onNewSession).toHaveBeenCalledWith("new task", "U1");
    expect(onIncoming).not.toHaveBeenCalled();
  });

  it("falls back to global allowedUserIds when Slack-specific list is empty", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue(undefined);
    const router = new SlackEventRouter(
      sessionLookup,
      onIncoming,
      "BOT1",
      "NOTIF",
      onNewSession,
      makeConfig({ allowedUserIds: [] }),
      ["U_GLOBAL_ALLOWED"],
    );
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "NOTIF", user: "U_RANDOM", text: "hello" } });
    expect(onNewSession).not.toHaveBeenCalled();

    await app._trigger("message", { message: { channel: "NOTIF", user: "U_GLOBAL_ALLOWED", text: "hello" } });
    expect(onNewSession).toHaveBeenCalledWith("hello", "U_GLOBAL_ALLOWED");
  });

  it("prefers Slack-specific list over global list when both are set", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue(undefined);
    const router = new SlackEventRouter(
      sessionLookup,
      onIncoming,
      "BOT1",
      "NOTIF",
      onNewSession,
      makeConfig({ allowedUserIds: ["U_SLACK_ONLY"] }),
      ["U_GLOBAL_ONLY"],
    );
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "NOTIF", user: "U_GLOBAL_ONLY", text: "hello" } });
    expect(onNewSession).not.toHaveBeenCalled();

    await app._trigger("message", { message: { channel: "NOTIF", user: "U_SLACK_ONLY", text: "hello" } });
    expect(onNewSession).toHaveBeenCalledWith("hello", "U_SLACK_ONLY");
  });

  it("allows all users when both Slack and global lists are empty", async () => {
    const onIncoming = vi.fn();
    const onNewSession = vi.fn();
    const sessionLookup = vi.fn().mockReturnValue(undefined);
    const router = new SlackEventRouter(
      sessionLookup,
      onIncoming,
      "BOT1",
      "NOTIF",
      onNewSession,
      makeConfig({ allowedUserIds: [] }),
      [],
    );
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", { message: { channel: "NOTIF", user: "U_ANYONE", text: "hello" } });
    expect(onNewSession).toHaveBeenCalledWith("hello", "U_ANYONE");
  });
});
