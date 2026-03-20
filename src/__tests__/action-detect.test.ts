import { describe, it, expect } from "vitest";
import { detectAction } from "../adapters/telegram/action-detect.js";

describe("detectAction", () => {
  describe("command pattern detection", () => {
    it("detects /new with agent and workspace", () => {
      const result = detectAction(
        "Mình sẽ tạo session với /new claude ~/project nhé!",
      );
      expect(result).toEqual({
        action: "new_session",
        agent: "claude",
        workspace: "~/project",
      });
    });

    it("detects /new with agent only", () => {
      const result = detectAction("Bạn có thể dùng /new claude để bắt đầu");
      expect(result).toEqual({
        action: "new_session",
        agent: "claude",
        workspace: undefined,
      });
    });

    it("detects /new without params", () => {
      const result = detectAction("Hãy dùng /new để tạo session mới");
      expect(result).toEqual({
        action: "new_session",
        agent: undefined,
        workspace: undefined,
      });
    });

    it("detects /cancel", () => {
      const result = detectAction("Bạn có thể dùng /cancel để huỷ session");
      expect(result).toEqual({ action: "cancel_session" });
    });

    it("does not detect /status or /help", () => {
      expect(detectAction("Dùng /status để xem trạng thái")).toBeNull();
      expect(detectAction("Gõ /help để xem hướng dẫn")).toBeNull();
    });
  });

  describe("keyword detection", () => {
    it('detects "tao session" keyword', () => {
      const result = detectAction("Mình sẽ tạo session mới cho bạn nhé");
      expect(result).toEqual({
        action: "new_session",
        agent: undefined,
        workspace: undefined,
      });
    });

    it('detects "create session" keyword', () => {
      const result = detectAction("I will create session for you");
      expect(result).toEqual({
        action: "new_session",
        agent: undefined,
        workspace: undefined,
      });
    });

    it('detects "huy session" keyword', () => {
      const result = detectAction("Mình sẽ huỷ session hiện tại");
      expect(result).toEqual({ action: "cancel_session" });
    });

    it('detects "cancel session" keyword', () => {
      const result = detectAction("Let me cancel session for you");
      expect(result).toEqual({ action: "cancel_session" });
    });

    it('does not false-positive on single word "huy"', () => {
      expect(detectAction("Anh Huy ơi, chào anh")).toBeNull();
    });

    it("does not false-positive on unrelated text", () => {
      expect(detectAction("Xin chào, tôi có thể giúp gì cho bạn?")).toBeNull();
    });
  });

  describe("priority", () => {
    it("prefers command pattern over keyword", () => {
      const result = detectAction("Tạo session bằng /new claude ~/work");
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
