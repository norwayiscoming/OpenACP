import { describe, it, expect, vi } from "vitest";
import { SecurityGuard } from "../security-guard.js";
import type { IncomingMessage } from "../types.js";

function makeMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    channelId: "telegram",
    threadId: "t1",
    userId: "user-1",
    text: "hello",
    ...overrides,
  };
}

function makeConfigManager(overrides: {
  allowedUserIds?: string[];
  maxConcurrentSessions?: number;
} = {}) {
  return {
    get: () => ({
      security: {
        allowedUserIds: overrides.allowedUserIds ?? [],
        maxConcurrentSessions: overrides.maxConcurrentSessions ?? 5,
      },
    }),
  } as any;
}

function makeSessionManager(sessions: Array<{ status: string }> = []) {
  return {
    listSessions: () => sessions,
  } as any;
}

describe("SecurityGuard", () => {
  it("allows when no restrictions", () => {
    const guard = new SecurityGuard(makeConfigManager(), makeSessionManager());
    const result = guard.checkAccess(makeMessage());
    expect(result).toEqual({ allowed: true });
  });

  it("rejects unauthorized user", () => {
    const guard = new SecurityGuard(
      makeConfigManager({ allowedUserIds: ["user-2", "user-3"] }),
      makeSessionManager(),
    );
    const result = guard.checkAccess(makeMessage({ userId: "user-1" }));
    expect(result).toEqual({ allowed: false, reason: "Unauthorized user" });
  });

  it("allows authorized user", () => {
    const guard = new SecurityGuard(
      makeConfigManager({ allowedUserIds: ["user-1", "user-2"] }),
      makeSessionManager(),
    );
    const result = guard.checkAccess(makeMessage({ userId: "user-1" }));
    expect(result).toEqual({ allowed: true });
  });

  it("rejects when session limit reached", () => {
    const guard = new SecurityGuard(
      makeConfigManager({ maxConcurrentSessions: 2 }),
      makeSessionManager([
        { status: "active" },
        { status: "initializing" },
      ]),
    );
    const result = guard.checkAccess(makeMessage());
    expect(result).toEqual({ allowed: false, reason: "Session limit reached (2)" });
  });

  it("ignores finished/cancelled sessions for limit check", () => {
    const guard = new SecurityGuard(
      makeConfigManager({ maxConcurrentSessions: 2 }),
      makeSessionManager([
        { status: "active" },
        { status: "finished" },
        { status: "cancelled" },
      ]),
    );
    const result = guard.checkAccess(makeMessage());
    expect(result).toEqual({ allowed: true });
  });
});
