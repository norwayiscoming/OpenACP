import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssistantManager } from "../assistant/assistant-manager.js";
import { AssistantRegistry } from "../assistant/assistant-registry.js";

function mockCore() {
  const session = {
    id: "assistant-1",
    threadId: "",
    enqueuePrompt: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  return {
    createSession: vi.fn().mockImplementation(async (params) => {
      if (params.threadId) session.threadId = params.threadId;
      return session;
    }),
    connectSessionBridge: vi.fn(),
    configManager: {
      get: () => ({ defaultAgent: "claude-code" }),
      resolveWorkspace: () => "/home/user/code",
    },
    _session: session,
  };
}

describe("AssistantManager", () => {
  let core: ReturnType<typeof mockCore>;
  let registry: AssistantRegistry;
  let manager: AssistantManager;

  beforeEach(() => {
    core = mockCore();
    registry = new AssistantRegistry();
    manager = new AssistantManager(core as any, registry);
  });

  it("spawn creates session and stores it", async () => {
    const session = await manager.spawn("telegram", "12345");
    expect(core.createSession).toHaveBeenCalledWith(expect.objectContaining({
      channelId: "telegram",
      isAssistant: true,
      initialName: "Assistant",
    }));
    expect(session.threadId).toBe("12345");
    expect(manager.get("telegram")).toBe(session);
  });

  it("get returns null for unknown channel", () => {
    expect(manager.get("discord")).toBeNull();
  });

  it("isAssistant returns true for assistant session", async () => {
    await manager.spawn("telegram", "12345");
    expect(manager.isAssistant("assistant-1")).toBe(true);
    expect(manager.isAssistant("other-session")).toBe(false);
  });

  it("respawn destroys old and creates new", async () => {
    await manager.spawn("telegram", "12345");
    const oldSession = core._session;
    const newSession = { ...oldSession, id: "assistant-2", threadId: "", enqueuePrompt: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
    core.createSession.mockResolvedValueOnce(newSession);

    await manager.respawn("telegram", "12345");
    expect(oldSession.destroy).toHaveBeenCalled();
    expect(manager.get("telegram")).toBe(newSession);
  });

  it("concurrent respawn returns current session", async () => {
    await manager.spawn("telegram", "12345");
    core._session.destroy.mockImplementation(() => new Promise((r) => setTimeout(r, 100)));
    const newSession = { ...core._session, id: "assistant-2", threadId: "", enqueuePrompt: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
    core.createSession.mockResolvedValueOnce(newSession);

    const [r1, r2] = await Promise.all([
      manager.respawn("telegram", "12345"),
      manager.respawn("telegram", "12345"),
    ]);
    expect(core._session.destroy).toHaveBeenCalledTimes(1);
  });
});
