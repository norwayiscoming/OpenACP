import { describe, it, expect } from "vitest";
import { SecurityGuard } from "../security-guard.js";
import type { IncomingMessage, SessionStatus } from "../types.js";

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

function makeSessionManager(sessions: Array<{ status: SessionStatus }> = []) {
  return {
    listSessions: () => sessions,
  } as any;
}

describe("SecurityGuard — Comprehensive Edge Cases", () => {
  describe("user access control", () => {
    it("allows all users when allowedUserIds is empty", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ allowedUserIds: [] }),
        makeSessionManager(),
      );
      expect(guard.checkAccess(makeMessage())).toEqual({ allowed: true });
    });

    it("converts numeric userId to string for comparison", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ allowedUserIds: ["12345"] }),
        makeSessionManager(),
      );
      // userId comes as number from Telegram but config stores as string
      const result = guard.checkAccess(makeMessage({ userId: 12345 as any }));
      expect(result).toEqual({ allowed: true });
    });

    it("rejects user not in allowed list", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ allowedUserIds: ["user-2", "user-3"] }),
        makeSessionManager(),
      );
      const result = guard.checkAccess(makeMessage({ userId: "user-1" }));
      expect(result).toEqual({ allowed: false, reason: "Unauthorized user" });
    });

    it("allows user in allowed list (exact match)", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ allowedUserIds: ["user-1", "user-2"] }),
        makeSessionManager(),
      );
      expect(guard.checkAccess(makeMessage({ userId: "user-1" }))).toEqual({
        allowed: true,
      });
    });

    it("single allowed user - authorized", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ allowedUserIds: ["only-me"] }),
        makeSessionManager(),
      );
      expect(guard.checkAccess(makeMessage({ userId: "only-me" }))).toEqual({
        allowed: true,
      });
    });

    it("single allowed user - unauthorized", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ allowedUserIds: ["only-me"] }),
        makeSessionManager(),
      );
      expect(guard.checkAccess(makeMessage({ userId: "not-me" }))).toEqual({
        allowed: false,
        reason: "Unauthorized user",
      });
    });
  });

  describe("session limit enforcement", () => {
    it("allows when active sessions < max", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ maxConcurrentSessions: 3 }),
        makeSessionManager([{ status: "active" }, { status: "active" }]),
      );
      expect(guard.checkAccess(makeMessage())).toEqual({ allowed: true });
    });

    it("rejects when active sessions == max (boundary)", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ maxConcurrentSessions: 2 }),
        makeSessionManager([{ status: "active" }, { status: "active" }]),
      );
      const result = guard.checkAccess(makeMessage());
      expect(result).toEqual({
        allowed: false,
        reason: "Session limit reached (2)",
      });
    });

    it("rejects when active sessions > max", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ maxConcurrentSessions: 1 }),
        makeSessionManager([
          { status: "active" },
          { status: "active" },
        ]),
      );
      expect(guard.checkAccess(makeMessage()).allowed).toBe(false);
    });

    it("counts initializing sessions toward limit", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ maxConcurrentSessions: 2 }),
        makeSessionManager([
          { status: "initializing" },
          { status: "initializing" },
        ]),
      );
      expect(guard.checkAccess(makeMessage()).allowed).toBe(false);
    });

    it("counts mix of active and initializing", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ maxConcurrentSessions: 2 }),
        makeSessionManager([
          { status: "active" },
          { status: "initializing" },
        ]),
      );
      expect(guard.checkAccess(makeMessage()).allowed).toBe(false);
    });

    it("ignores finished sessions for limit", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ maxConcurrentSessions: 1 }),
        makeSessionManager([
          { status: "finished" },
          { status: "finished" },
          { status: "finished" },
        ]),
      );
      expect(guard.checkAccess(makeMessage())).toEqual({ allowed: true });
    });

    it("ignores cancelled sessions for limit", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ maxConcurrentSessions: 1 }),
        makeSessionManager([{ status: "cancelled" }]),
      );
      expect(guard.checkAccess(makeMessage())).toEqual({ allowed: true });
    });

    it("ignores error sessions for limit", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ maxConcurrentSessions: 1 }),
        makeSessionManager([{ status: "error" }]),
      );
      expect(guard.checkAccess(makeMessage())).toEqual({ allowed: true });
    });

    it("maxConcurrentSessions of 0 always rejects", () => {
      const guard = new SecurityGuard(
        makeConfigManager({ maxConcurrentSessions: 0 }),
        makeSessionManager([]),
      );
      expect(guard.checkAccess(makeMessage()).allowed).toBe(false);
    });
  });

  describe("combined checks (user + session limit)", () => {
    it("user check runs before session limit check", () => {
      // If user is unauthorized, should return "Unauthorized user" not "Session limit"
      const guard = new SecurityGuard(
        makeConfigManager({
          allowedUserIds: ["admin"],
          maxConcurrentSessions: 0,
        }),
        makeSessionManager(),
      );
      const result = guard.checkAccess(makeMessage({ userId: "hacker" }));
      expect(result).toEqual({ allowed: false, reason: "Unauthorized user" });
    });

    it("authorized user still blocked by session limit", () => {
      const guard = new SecurityGuard(
        makeConfigManager({
          allowedUserIds: ["user-1"],
          maxConcurrentSessions: 1,
        }),
        makeSessionManager([{ status: "active" }]),
      );
      const result = guard.checkAccess(makeMessage({ userId: "user-1" }));
      expect(result.allowed).toBe(false);
      expect((result as any).reason).toContain("Session limit");
    });
  });

  describe("config reads fresh on each call", () => {
    it("reflects config changes between calls", () => {
      let allowedUserIds: string[] = [];
      const configManager = {
        get: () => ({
          security: { allowedUserIds, maxConcurrentSessions: 5 },
        }),
      } as any;
      const guard = new SecurityGuard(configManager, makeSessionManager());

      // First: no restrictions
      expect(guard.checkAccess(makeMessage())).toEqual({ allowed: true });

      // Update config
      allowedUserIds = ["user-2"];

      // Now user-1 should be blocked
      expect(guard.checkAccess(makeMessage({ userId: "user-1" })).allowed).toBe(false);
    });
  });
});
