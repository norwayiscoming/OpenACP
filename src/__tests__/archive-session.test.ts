import { describe, it, expect, vi } from "vitest";
import { handleArchive, handleArchiveConfirm } from "../adapters/telegram/commands/session.js";

function mockCtx(threadId?: number) {
  return {
    message: threadId ? { message_thread_id: threadId } : undefined,
    reply: vi.fn(() => Promise.resolve()),
  } as any;
}

describe("handleArchive", () => {
  it("shows guidance when no session found in topic", async () => {
    const ctx = mockCtx(999);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => undefined),
      },
    } as any;

    await handleArchive(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("/archive"),
      expect.any(Object),
    );
  });

  it("shows confirmation prompt when session exists", async () => {
    const ctx = mockCtx(456);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => ({
          id: "sess-1",
          status: "active",
        })),
      },
    } as any;

    await handleArchive(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Archive this session topic"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it("rejects if session is initializing", async () => {
    const ctx = mockCtx(456);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => ({
          id: "sess-1",
          status: "initializing",
        })),
      },
    } as any;

    await handleArchive(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("wait for session"),
      expect.any(Object),
    );
  });

  it("rejects finished session with specific message", async () => {
    const ctx = mockCtx(456);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => ({
          id: "sess-1",
          status: "finished",
        })),
      },
    } as any;

    await handleArchive(ctx, core);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("session is finished"),
      expect.any(Object),
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

  it("calls core.archiveSession on confirm and sends to new topic", async () => {
    const core = {
      archiveSession: vi.fn(() => Promise.resolve({ ok: true, newThreadId: "789" })),
    } as any;
    const ctx = {
      callbackQuery: { data: "ar:yes:sess-1" },
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      editMessageText: vi.fn(() => Promise.resolve()),
      api: { sendMessage: vi.fn(() => Promise.resolve()) },
    } as any;

    await handleArchiveConfirm(ctx, core, 123);
    expect(core.archiveSession).toHaveBeenCalledWith("sess-1");
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(
      123,
      expect.stringContaining("archived"),
      expect.objectContaining({ message_thread_id: 789 }),
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

  it("notifies when both edit and topic are gone", async () => {
    const core = {
      archiveSession: vi.fn(() => Promise.resolve({ ok: false, error: "Create failed" })),
      notificationManager: {
        notifyAll: vi.fn(() => Promise.resolve()),
      },
    } as any;
    let editCallCount = 0;
    const ctx = {
      callbackQuery: { data: "ar:yes:sess-1" },
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      editMessageText: vi.fn(() => {
        editCallCount++;
        // First call ("Archiving...") succeeds, second call (error) fails
        if (editCallCount <= 1) return Promise.resolve();
        return Promise.reject(new Error("topic deleted"));
      }),
    } as any;

    await handleArchiveConfirm(ctx, core, 123);
    expect(core.notificationManager.notifyAll).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        type: "error",
      }),
    );
  });
});

describe("archiveSession (core integration)", () => {
  function makeCoreArchive(session: any, adapter: any) {
    return async (sessionId: string) => {
      if (!session) return { ok: false as const, error: "Session not found" };
      if (session.status === "initializing") return { ok: false as const, error: "Session is still initializing" };
      if (session.status !== "active") return { ok: false as const, error: `Session is ${session.status}` };
      if (!adapter) return { ok: false as const, error: "Adapter not found for session" };
      try {
        const result = await adapter.archiveSessionTopic(sessionId);
        if (!result) return { ok: false as const, error: "Adapter does not support archiving" };
        return { ok: true as const, newThreadId: result.newThreadId };
      } catch (err: any) {
        return { ok: false as const, error: err.message };
      }
    };
  }

  it("returns error for non-existent session", async () => {
    const archive = makeCoreArchive(null, null);
    expect(await archive("x")).toEqual({ ok: false, error: "Session not found" });
  });

  it("returns error for initializing session", async () => {
    const archive = makeCoreArchive({ status: "initializing" }, {});
    expect(await archive("x")).toEqual({ ok: false, error: "Session is still initializing" });
  });

  it("delegates to adapter on success", async () => {
    const adapter = { archiveSessionTopic: vi.fn(() => Promise.resolve({ newThreadId: "999" })) };
    const archive = makeCoreArchive({ status: "active" }, adapter);
    const result = await archive("s1");
    expect(result).toEqual({ ok: true, newThreadId: "999" });
    expect(adapter.archiveSessionTopic).toHaveBeenCalledWith("s1");
  });

  it("returns error when adapter throws", async () => {
    const adapter = { archiveSessionTopic: vi.fn(() => Promise.reject(new Error("Telegram 403"))) };
    const archive = makeCoreArchive({ status: "active" }, adapter);
    expect(await archive("s1")).toEqual({ ok: false, error: "Telegram 403" });
  });

  it("returns error when adapter returns null", async () => {
    const adapter = { archiveSessionTopic: vi.fn(() => Promise.resolve(null)) };
    const archive = makeCoreArchive({ status: "active" }, adapter);
    expect(await archive("s1")).toEqual({ ok: false, error: "Adapter does not support archiving" });
  });
});
