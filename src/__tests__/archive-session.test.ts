import { describe, it, expect, vi } from "vitest";
import { handleArchive, handleArchiveConfirm } from "../adapters/telegram/commands/session.js";

function mockCtx(threadId?: number) {
  return {
    message: threadId ? { message_thread_id: threadId } : undefined,
    reply: vi.fn(() => Promise.resolve()),
  } as any;
}

describe("handleArchive", () => {
  it("shows confirmation for active session", async () => {
    const ctx = mockCtx(456);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => ({ id: "sess-1", status: "active" })),
        getRecordByThread: vi.fn(),
      },
    } as any;

    await handleArchive(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Archive this session"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it("shows confirmation for initializing session", async () => {
    const ctx = mockCtx(456);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => ({ id: "sess-1", status: "initializing" })),
        getRecordByThread: vi.fn(),
      },
    } as any;

    await handleArchive(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Archive this session"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it("shows confirmation for orphan topic (no session, no record)", async () => {
    const ctx = mockCtx(999);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => undefined),
        getRecordByThread: vi.fn(() => undefined),
      },
    } as any;

    await handleArchive(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Archive this session"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it("shows confirmation for stored record (after restart)", async () => {
    const ctx = mockCtx(456);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => undefined),
        getRecordByThread: vi.fn(() => ({ sessionId: "stored-1" })),
      },
    } as any;

    await handleArchive(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Archive this session"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it("does nothing without threadId", async () => {
    const ctx = mockCtx();
    const core = { sessionManager: {} } as any;

    await handleArchive(ctx, core);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

describe("handleArchiveConfirm", () => {
  it("cancels when user taps Cancel", async () => {
    const ctx = {
      callbackQuery: { data: "ar:no:sess-1" },
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      editMessageText: vi.fn(() => Promise.resolve()),
    } as any;

    await handleArchiveConfirm(ctx, {} as any, 123);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      "Archive cancelled.",
      expect.any(Object),
    );
  });

  it("calls core.archiveSession on confirm and notifies", async () => {
    const core = {
      archiveSession: vi.fn(() => Promise.resolve({ ok: true })),
      notificationManager: { notifyAll: vi.fn(() => Promise.resolve()) },
    } as any;
    const ctx = {
      callbackQuery: { data: "ar:yes:sess-1" },
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      editMessageText: vi.fn(() => Promise.resolve()),
    } as any;

    await handleArchiveConfirm(ctx, core, 123);
    expect(core.archiveSession).toHaveBeenCalledWith("sess-1");
    expect(core.notificationManager.notifyAll).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        type: "completed",
      }),
    );
  });

  it("shows error when archive fails", async () => {
    const core = {
      archiveSession: vi.fn(() => Promise.resolve({ ok: false, error: "No permission" })),
    } as any;
    const ctx = {
      callbackQuery: { data: "ar:yes:sess-1" },
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      editMessageText: vi.fn(() => Promise.resolve()),
    } as any;

    await handleArchiveConfirm(ctx, core, 123);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("No permission"),
      expect.any(Object),
    );
  });

  it("handles orphan topic deletion", async () => {
    const core = {
      notificationManager: { notifyAll: vi.fn(() => Promise.resolve()) },
    } as any;
    const ctx = {
      callbackQuery: { data: "ar:yes:topic:999" },
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      editMessageText: vi.fn(() => Promise.resolve()),
      api: { deleteForumTopic: vi.fn(() => Promise.resolve()) },
    } as any;

    await handleArchiveConfirm(ctx, core, 123);
    expect(ctx.api.deleteForumTopic).toHaveBeenCalledWith(123, 999);
    expect(core.notificationManager.notifyAll).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "system",
        sessionName: "Orphan topic #999",
        type: "completed",
      }),
    );
  });

  it("notifies on orphan topic delete failure", async () => {
    const core = {
      notificationManager: { notifyAll: vi.fn(() => Promise.resolve()) },
    } as any;
    const ctx = {
      callbackQuery: { data: "ar:yes:topic:999" },
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      editMessageText: vi.fn(() => Promise.resolve()),
      api: { deleteForumTopic: vi.fn(() => Promise.reject(new Error("forbidden"))) },
    } as any;

    await handleArchiveConfirm(ctx, core, 123);
    expect(core.notificationManager.notifyAll).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "system",
        type: "error",
        summary: expect.stringContaining("forbidden"),
      }),
    );
  });
});
