import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionBridge } from "../session-bridge.js";
import { Session } from "../session.js";
import type { AgentInstance } from "../agent-instance.js";
import type { ChannelAdapter } from "../channel.js";
import type { MessageTransformer } from "../message-transformer.js";
import type { NotificationManager } from "../notification.js";
import type { SessionManager } from "../session-manager.js";
import type { AgentEvent, PermissionRequest } from "../types.js";
import { TypedEmitter } from "../typed-emitter.js";

function createMockAgentInstance(): AgentInstance {
  const emitter = new TypedEmitter<{ agent_event: (event: AgentEvent) => void }>();
  return Object.assign(emitter, {
    sessionId: "agent-session-1",
    agentName: "test-agent",
    prompt: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    onPermissionRequest: vi.fn(),
  }) as unknown as AgentInstance;
}

function createMockAdapter(): ChannelAdapter {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendPermissionRequest: vi.fn().mockResolvedValue(undefined),
    sendNotification: vi.fn().mockResolvedValue(undefined),
    sendSkillCommands: vi.fn().mockResolvedValue(undefined),
    cleanupSkillCommands: vi.fn().mockResolvedValue(undefined),
    renameSessionThread: vi.fn().mockResolvedValue(undefined),
    createSessionThread: vi.fn().mockResolvedValue("thread-1"),
    deleteSessionThread: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChannelAdapter;
}

function createMockDeps() {
  return {
    messageTransformer: {
      transform: vi.fn().mockReturnValue({ type: "text", text: "transformed" }),
    } as unknown as MessageTransformer,
    notificationManager: {
      notify: vi.fn().mockResolvedValue(undefined),
      notifyAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as NotificationManager,
    sessionManager: {
      patchRecord: vi.fn().mockResolvedValue(undefined),
      updateSessionStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionManager,
  };
}

function createSession(agentInstance?: AgentInstance): Session {
  return new Session({
    channelId: "test-channel",
    agentName: "test-agent",
    workingDirectory: "/tmp/test",
    agentInstance: agentInstance ?? createMockAgentInstance(),
  });
}

function makePermissionRequest(description: string): PermissionRequest {
  return {
    id: "req-1",
    description,
    options: [
      { id: "allow-1", label: "Allow", isAllow: true },
      { id: "deny-1", label: "Deny", isAllow: false },
    ],
  };
}

describe("SessionBridge auto-approve", () => {
  let agent: AgentInstance;
  let session: Session;
  let adapter: ChannelAdapter;
  let deps: ReturnType<typeof createMockDeps>;
  let bridge: SessionBridge;

  beforeEach(() => {
    agent = createMockAgentInstance();
    session = createSession(agent);
    adapter = createMockAdapter();
    deps = createMockDeps();
    bridge = new SessionBridge(session, adapter, deps);
    bridge.connect();
  });

  it("auto-approves openacp commands without reaching the adapter", async () => {
    const request = makePermissionRequest("Run openacp install plugin");

    const result = await agent.onPermissionRequest(request);

    expect(result).toBe("allow-1");
    expect(adapter.sendPermissionRequest).not.toHaveBeenCalled();
  });

  it("auto-approves openacp commands case-insensitively", async () => {
    const request = makePermissionRequest("Run OpenACP config command");

    const result = await agent.onPermissionRequest(request);

    expect(result).toBe("allow-1");
    expect(adapter.sendPermissionRequest).not.toHaveBeenCalled();
  });

  it("auto-approves when dangerousMode is enabled", async () => {
    session.dangerousMode = true;
    const request = makePermissionRequest("Execute rm -rf /important");

    const result = await agent.onPermissionRequest(request);

    expect(result).toBe("allow-1");
    expect(adapter.sendPermissionRequest).not.toHaveBeenCalled();
  });

  it("forwards normal requests to the adapter", async () => {
    const request = makePermissionRequest("Delete file foo.txt");

    // The promise will hang until resolved via permissionGate, so trigger it
    const resultPromise = agent.onPermissionRequest(request);

    expect(adapter.sendPermissionRequest).toHaveBeenCalledWith(
      session.id,
      request,
    );
    expect(session.permissionGate.isPending).toBe(true);

    // Resolve to complete the test
    session.permissionGate.resolve("deny-1");
    const result = await resultPromise;
    expect(result).toBe("deny-1");
  });

  it("does not auto-approve normal requests even with similar descriptions", async () => {
    const request = makePermissionRequest("Run npm install");

    const resultPromise = agent.onPermissionRequest(request);

    expect(adapter.sendPermissionRequest).toHaveBeenCalled();

    session.permissionGate.resolve("allow-1");
    await resultPromise;
  });
});
