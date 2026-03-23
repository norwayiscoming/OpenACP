import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { JsonFileSessionStore } from "../core/session-store.js";
import type { SessionRecord } from "../core/types.js";

describe("Lazy Resume Integration", () => {
  let tmpDir: string;
  let filePath: string;
  let store: JsonFileSessionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openacp-resume-"));
    filePath = path.join(tmpDir, "sessions.json");
    store = new JsonFileSessionStore(filePath, 30);
  });

  afterEach(() => {
    store.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("survives restart: save, destroy, reload, find", async () => {
    const record: SessionRecord = {
      sessionId: "sess-resume-1",
      agentSessionId: "agent-uuid-abc",
      agentName: "claude",
      workingDir: "/tmp/ws",
      channelId: "telegram",
      status: "active",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      platform: { topicId: 456 },
    };
    await store.save(record);
    store.flushSync();
    store.destroy();

    // Simulate restart
    const store2 = new JsonFileSessionStore(filePath, 30);
    const found = store2.findByPlatform("telegram", (p) => p.topicId === 456);
    expect(found).toBeDefined();
    expect(found!.sessionId).toBe("sess-resume-1");
    expect(found!.agentSessionId).toBe("agent-uuid-abc");
    store2.destroy();
  });

  it("cancelled sessions are not resumable by lookup convention", async () => {
    const record: SessionRecord = {
      sessionId: "sess-cancelled",
      agentSessionId: "agent-uuid-cancel",
      agentName: "claude",
      workingDir: "/tmp/ws",
      channelId: "telegram",
      status: "cancelled",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      platform: { topicId: 789 },
    };
    await store.save(record);
    const found = store.findByPlatform("telegram", (p) => p.topicId === 789);
    // Record exists, but caller should check status before resuming
    expect(found?.status).toBe("cancelled");
  });

  it("finished sessions persist status correctly", async () => {
    const record: SessionRecord = {
      sessionId: "sess-finished",
      agentSessionId: "agent-uuid-fin",
      agentName: "claude",
      workingDir: "/tmp/ws",
      channelId: "telegram",
      status: "active",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      platform: { topicId: 101 },
    };
    await store.save(record);
    // Simulate status update on session_end
    await store.save({ ...record, status: "finished" });
    store.flushSync();
    store.destroy();

    const store2 = new JsonFileSessionStore(filePath, 30);
    const found = store2.get("sess-finished");
    expect(found?.status).toBe("finished");
    store2.destroy();
  });

  it("platform data lookup matches by topicId", async () => {
    await store.save({
      sessionId: "s1",
      agentSessionId: "a1",
      agentName: "claude",
      workingDir: "/tmp",
      channelId: "telegram",
      status: "active",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      platform: { topicId: 100 },
    });
    await store.save({
      sessionId: "s2",
      agentSessionId: "a2",
      agentName: "claude",
      workingDir: "/tmp",
      channelId: "telegram",
      status: "active",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      platform: { topicId: 200 },
    });

    const found = store.findByPlatform("telegram", (p) => p.topicId === 200);
    expect(found?.sessionId).toBe("s2");
  });
});
