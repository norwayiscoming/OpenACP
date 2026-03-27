import { describe, it, expect } from "vitest";
import { detectAction } from "../plugins/telegram/action-detect.js";

describe("detectAction", () => {
  describe("command pattern detection", () => {
    it("detects /new with agent and workspace", () => {
      const result = detectAction(
        "I will create a session with /new claude ~/project for you!",
      );
      expect(result).toEqual({
        action: "new_session",
        agent: "claude",
        workspace: "~/project",
      });
    });

    it("detects /new with agent only", () => {
      const result = detectAction("Try /new claude");
      expect(result).toEqual({
        action: "new_session",
        agent: "claude",
        workspace: undefined,
      });
    });

    it("detects /new without params", () => {
      const result = detectAction("Please run /new");
      expect(result).toEqual({
        action: "new_session",
        agent: undefined,
        workspace: undefined,
      });
    });

    it("detects /cancel", () => {
      const result = detectAction("You can use /cancel to cancel the session");
      expect(result).toEqual({ action: "cancel_session" });
    });

    it("does not detect /status or /help", () => {
      expect(detectAction("Use /status to check status")).toBeNull();
      expect(detectAction("Type /help for instructions")).toBeNull();
    });
  });

  describe("keyword detection", () => {
    it('detects "create session" keyword', () => {
      const result = detectAction("I will create session for you");
      expect(result).toEqual({
        action: "new_session",
        agent: undefined,
        workspace: undefined,
      });
    });

    it('detects "new session" keyword', () => {
      const result = detectAction("Let me start a new session for you");
      expect(result).toEqual({
        action: "new_session",
        agent: undefined,
        workspace: undefined,
      });
    });

    it('detects "cancel session" keyword', () => {
      const result = detectAction("Let me cancel session for you");
      expect(result).toEqual({ action: "cancel_session" });
    });

    it('detects "stop session" keyword', () => {
      const result = detectAction("I will stop session now");
      expect(result).toEqual({ action: "cancel_session" });
    });

    it("does not false-positive on unrelated text", () => {
      expect(detectAction("Hello, how can I help you?")).toBeNull();
    });
  });

  describe("priority", () => {
    it("prefers command pattern over keyword", () => {
      const result = detectAction("Create session with /new claude ~/work");
      expect(result).toEqual({
        action: "new_session",
        agent: "claude",
        workspace: "~/work",
      });
    });
  });

  it("returns null for empty text", () => {
    expect(detectAction("")).toBeNull();
  });
});
