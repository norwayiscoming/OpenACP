import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { OpenACPCore } from "../../../core/index.js";
import type { Session } from "../../../core/session.js";
import { escapeHtml, formatUsageReport, formatSummary } from "../formatting.js";
import { createChildLogger } from "../../../core/log.js";
import type { CommandsAssistantContext } from "../types.js";
const log = createChildLogger({ module: "telegram-cmd-session" });

export async function handleCancel(
  ctx: Context,
  core: OpenACPCore,
  assistant?: CommandsAssistantContext,
): Promise<void> {
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return;

  // In assistant topic: forward to assistant for confirmation
  if (assistant && threadId === assistant.topicId) {
    const assistantSession = assistant.getSession();
    if (assistantSession) {
      await assistantSession.enqueuePrompt(
        "User wants to cancel a session. Confirm which session to cancel.",
      );
      return;
    }
  }

  const session = core.sessionManager.getSessionByThread(
    "telegram",
    String(threadId),
  );
  if (session) {
    log.info({ sessionId: session.id }, "Abort prompt command");
    await session.abortPrompt();
    await ctx.reply("⛔ Prompt aborted. Session is still active — send a new message to continue.", { parse_mode: "HTML" });
    return;
  }

  // Fallback: session not in memory — nothing to abort, but session can
  // still be resumed when the user sends a new message.
  const record = core.sessionManager.getRecordByThread("telegram", String(threadId));
  if (record && record.status !== "error") {
    log.info({ sessionId: record.sessionId, status: record.status }, "Cancel command — no active prompt to abort");
    await ctx.reply("ℹ️ No active prompt to cancel. Send a new message to resume the session.", { parse_mode: "HTML" });
  }
}

export async function handleStatus(ctx: Context, core: OpenACPCore): Promise<void> {
  const threadId = ctx.message?.message_thread_id;
  if (threadId) {
    const session = core.sessionManager.getSessionByThread(
      "telegram",
      String(threadId),
    );
    if (session) {
      await ctx.reply(
        `<b>Session:</b> ${escapeHtml(session.name || session.id)}\n` +
          `<b>Agent:</b> ${escapeHtml(session.agentName)}\n` +
          `<b>Status:</b> ${escapeHtml(session.status)}\n` +
          `<b>Workspace:</b> <code>${escapeHtml(session.workingDirectory)}</code>\n` +
          `<b>Queue:</b> ${session.queueDepth} pending`,
        { parse_mode: "HTML" },
      );
    } else {
      // Fallback: show stored session info when not loaded in memory (e.g. after restart)
      const record = core.sessionManager.getRecordByThread("telegram", String(threadId));
      if (record) {
        await ctx.reply(
          `<b>Session:</b> ${escapeHtml(record.name || record.sessionId)}\n` +
            `<b>Agent:</b> ${escapeHtml(record.agentName)}\n` +
            `<b>Status:</b> ${escapeHtml(record.status)} (not loaded)\n` +
            `<b>Workspace:</b> <code>${escapeHtml(record.workingDir)}</code>`,
          { parse_mode: "HTML" },
        );
      } else {
        await ctx.reply("No active session in this topic.", {
          parse_mode: "HTML",
        });
      }
    }
  } else {
    const sessions = core.sessionManager.listSessions("telegram");
    const active = sessions.filter(
      (s) => s.status === "active" || s.status === "initializing",
    );
    await ctx.reply(
      `<b>OpenACP Status</b>\n` +
        `Active sessions: ${active.length}\n` +
        `Total sessions: ${sessions.length}`,
      { parse_mode: "HTML" },
    );
  }
}

export async function handleTopics(ctx: Context, core: OpenACPCore): Promise<void> {
  try {
    const allRecords = core.sessionManager.listRecords();

    // Only show sessions that have a Telegram topic (skip headless/CLI-only)
    const records = allRecords.filter((r) => {
      const platform = r.platform as { topicId?: number };
      return !!platform?.topicId;
    });

    const headlessCount = allRecords.length - records.length;

    if (records.length === 0) {
      const extra = headlessCount > 0 ? ` (${headlessCount} headless hidden)` : "";
      await ctx.reply(`No sessions with topics found.${extra}`, { parse_mode: "HTML" });
      return;
    }

    const statusEmoji: Record<string, string> = {
      active: "🟢",
      initializing: "🟡",
      finished: "✅",
      error: "❌",
      cancelled: "⛔",
    };

    // Sort: active/initializing first, then by lastActiveAt desc
    const statusOrder: Record<string, number> = { active: 0, initializing: 1, error: 2, finished: 3, cancelled: 4 };
    records.sort((a, b) => (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5));

    const MAX_DISPLAY = 30;
    const displayed = records.slice(0, MAX_DISPLAY);

    const lines = displayed.map((r) => {
      const emoji = statusEmoji[r.status] || "⚪";
      const name = r.name?.trim();
      const label = name ? escapeHtml(name) : `<i>${escapeHtml(r.agentName)} session</i>`;
      return `${emoji} ${label}  <code>[${r.status}]</code>`;
    });

    const header = `<b>Sessions: ${records.length}</b>` +
      (headlessCount > 0 ? ` (${headlessCount} headless hidden)` : "");
    const truncated = records.length > MAX_DISPLAY ? `\n\n<i>...and ${records.length - MAX_DISPLAY} more</i>` : "";

    // Count by status for cleanup buttons (include headless sessions)
    const finishedCount = allRecords.filter((r) => r.status === "finished").length;
    const errorCount = allRecords.filter((r) => r.status === "error" || r.status === "cancelled").length;

    const keyboard = new InlineKeyboard();
    if (finishedCount > 0) {
      keyboard.text(`Cleanup finished (${finishedCount})`, "m:cleanup:finished").row();
    }
    if (errorCount > 0) {
      keyboard.text(`Cleanup errors (${errorCount})`, "m:cleanup:errors").row();
    }
    if (finishedCount + errorCount > 0) {
      keyboard.text(`Cleanup all non-active (${finishedCount + errorCount})`, "m:cleanup:all").row();
    }
    keyboard.text(`⚠️ Cleanup ALL (${allRecords.length})`, "m:cleanup:everything").row();
    keyboard.text("Refresh", "m:topics");

    await ctx.reply(
      `${header}\n\n${lines.join("\n")}${truncated}`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  } catch (err) {
    log.error({ err }, "handleTopics error");
    await ctx.reply("❌ Failed to list sessions.", { parse_mode: "HTML" }).catch(() => {});
  }
}

export async function handleCleanup(ctx: Context, core: OpenACPCore, chatId: number, statuses: string[]): Promise<void> {
  const allRecords = core.sessionManager.listRecords();
  const cleanable = allRecords.filter((r) => statuses.includes(r.status));

  if (cleanable.length === 0) {
    await ctx.reply("Nothing to clean up.", { parse_mode: "HTML" });
    return;
  }

  let deleted = 0;
  let failed = 0;

  for (const record of cleanable) {
    try {
      const topicId = (record.platform as { topicId?: number })?.topicId;
      if (topicId) {
        try {
          await ctx.api.deleteForumTopic(chatId, topicId);
        } catch (err) {
          log.warn({ err, sessionId: record.sessionId, topicId }, "Failed to delete forum topic during cleanup");
        }
      }
      await core.sessionManager.removeRecord(record.sessionId);
      deleted++;
    } catch (err) {
      log.error({ err, sessionId: record.sessionId }, "Failed to cleanup session");
      failed++;
    }
  }

  await ctx.reply(
    `🗑 Cleaned up <b>${deleted}</b> sessions${failed > 0 ? ` (${failed} failed)` : ""}.`,
    { parse_mode: "HTML" },
  );
}

export async function handleCleanupEverything(
  ctx: Context,
  core: OpenACPCore,
  chatId: number,
  systemTopicIds?: { notificationTopicId: number; assistantTopicId: number },
): Promise<void> {
  const allRecords = core.sessionManager.listRecords();
  const cleanable = allRecords.filter((r) => {
    const platform = r.platform as { topicId?: number };
    if (systemTopicIds && platform?.topicId && (platform.topicId === systemTopicIds.notificationTopicId || platform.topicId === systemTopicIds.assistantTopicId)) return false;
    return true;
  });

  if (cleanable.length === 0) {
    await ctx.reply("Nothing to clean up.", { parse_mode: "HTML" });
    return;
  }

  // Group by status for breakdown
  const statusCounts = new Map<string, number>();
  for (const r of cleanable) {
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  }

  const statusEmoji: Record<string, string> = {
    active: "🟢", initializing: "🟡", finished: "✅", error: "❌", cancelled: "⛔",
  };

  const breakdown = Array.from(statusCounts.entries())
    .map(([status, count]) => `${statusEmoji[status] ?? "⚪"} ${status}: ${count}`)
    .join("\n");

  const activeCount = (statusCounts.get("active") ?? 0) + (statusCounts.get("initializing") ?? 0);
  const activeWarning = activeCount > 0
    ? `\n\n⚠️ <b>${activeCount} active session(s) will be cancelled and their agents stopped!</b>`
    : "";

  const keyboard = new InlineKeyboard()
    .text("Yes, delete all", "m:cleanup:everything:confirm")
    .text("Cancel", "m:topics");

  await ctx.reply(
    `<b>Delete ${cleanable.length} topics?</b>\n\n` +
    `This will:\n` +
    `• Delete all session topics from this group\n` +
    `• Cancel any running agent sessions\n` +
    `• Remove all session records\n\n` +
    `<b>Breakdown:</b>\n${breakdown}${activeWarning}\n\n` +
    `<i>Notifications and Assistant topics will NOT be deleted.</i>`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

export async function handleCleanupEverythingConfirmed(
  ctx: Context,
  core: OpenACPCore,
  chatId: number,
  systemTopicIds?: { notificationTopicId: number; assistantTopicId: number },
): Promise<void> {
  const allRecords = core.sessionManager.listRecords();
  const cleanable = allRecords.filter((r) => {
    const platform = r.platform as { topicId?: number };
    if (systemTopicIds && platform?.topicId && (platform.topicId === systemTopicIds.notificationTopicId || platform.topicId === systemTopicIds.assistantTopicId)) return false;
    return true;
  });

  if (cleanable.length === 0) {
    await ctx.reply("Nothing to clean up.", { parse_mode: "HTML" });
    return;
  }

  let deleted = 0;
  let failed = 0;

  for (const record of cleanable) {
    try {
      // Cancel active sessions first
      if (record.status === "active" || record.status === "initializing") {
        try {
          await core.sessionManager.cancelSession(record.sessionId);
        } catch (err) {
          log.warn({ err, sessionId: record.sessionId }, "Failed to cancel session during cleanup");
        }
      }

      const topicId = (record.platform as { topicId?: number })?.topicId;
      if (topicId) {
        try {
          await ctx.api.deleteForumTopic(chatId, topicId);
        } catch (err) {
          log.warn({ err, sessionId: record.sessionId, topicId }, "Failed to delete forum topic during cleanup");
        }
      }
      await core.sessionManager.removeRecord(record.sessionId);
      deleted++;
    } catch (err) {
      log.error({ err, sessionId: record.sessionId }, "Failed to cleanup session");
      failed++;
    }
  }

  await ctx.reply(
    `🗑 Cleaned up <b>${deleted}</b> sessions${failed > 0 ? ` (${failed} failed)` : ""}.`,
    { parse_mode: "HTML" },
  );
}

export async function executeCancelSession(
  core: OpenACPCore,
  excludeSessionId?: string,
): Promise<Session | null> {
  const sessions = core.sessionManager
    .listSessions("telegram")
    .filter((s) => s.status === "active" && s.id !== excludeSessionId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const session = sessions[0];
  if (!session) return null;

  await session.abortPrompt();
  return session;
}

export function setupSessionCallbacks(
  bot: Bot,
  core: OpenACPCore,
  chatId: number,
  systemTopicIds?: { notificationTopicId: number; assistantTopicId: number },
): void {
  bot.callbackQuery(/^m:cleanup/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    try {
      await ctx.answerCallbackQuery();
    } catch { /* expired */ }

    switch (data) {
      case "m:cleanup:finished":
        await handleCleanup(ctx, core, chatId, ["finished"]);
        break;
      case "m:cleanup:errors":
        await handleCleanup(ctx, core, chatId, ["error", "cancelled"]);
        break;
      case "m:cleanup:all":
        await handleCleanup(ctx, core, chatId, ["finished", "error", "cancelled"]);
        break;
      case "m:cleanup:everything":
        await handleCleanupEverything(ctx, core, chatId, systemTopicIds);
        break;
      case "m:cleanup:everything:confirm":
        await handleCleanupEverythingConfirmed(ctx, core, chatId, systemTopicIds);
        break;
    }
  });
}

export async function handleUsage(ctx: Context, core: OpenACPCore): Promise<void> {
  if (!core.usageStore) {
    await ctx.reply("📊 Usage tracking is disabled.", { parse_mode: "HTML" });
    return;
  }

  const rawMatch = (ctx as Context & { match: unknown }).match;
  const period = typeof rawMatch === "string" ? rawMatch.trim().toLowerCase() : "";

  let summaries: ReturnType<typeof core.usageStore.query>[];

  if (period === "today" || period === "week" || period === "month") {
    summaries = [core.usageStore.query(period)];
  } else {
    summaries = [
      core.usageStore.query("month"),
      core.usageStore.query("week"),
      core.usageStore.query("today"),
    ];
  }

  const budgetStatus = core.usageBudget
    ? core.usageBudget.getStatus()
    : { status: "ok" as const, used: 0, budget: 0, percent: 0 };

  const text = formatUsageReport(summaries, budgetStatus);
  await ctx.reply(text, { parse_mode: "HTML" });
}

export async function handleArchive(
  ctx: Context,
  core: OpenACPCore,
): Promise<void> {
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return;

  // Check in-memory session first, then fall back to stored record
  const session = core.sessionManager.getSessionByThread("telegram", String(threadId));
  const record = !session ? core.sessionManager.getRecordByThread("telegram", String(threadId)) : undefined;
  // Use sessionId if available, otherwise use threadId as identifier for orphan topics
  const identifier = session?.id ?? record?.sessionId ?? `topic:${threadId}`;

  await ctx.reply(
    "⚠️ <b>Archive this session?</b>\n\n" +
    "This will:\n" +
    "• Delete this topic and all messages\n" +
    "• Stop the agent session (if running)\n" +
    "• Remove the session record\n\n" +
    "<i>This action cannot be undone.</i>",
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🗑 Yes, archive", `ar:yes:${identifier}`)
        .text("❌ Cancel", `ar:no:${identifier}`),
    },
  );
}

export async function handleArchiveConfirm(
  ctx: Context,
  core: OpenACPCore,
  chatId: number,
): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  try {
    await ctx.answerCallbackQuery();
  } catch { /* expired */ }

  // Format: ar:<action>:<identifier> where identifier is sessionId or topic:<threadId>
  const [, action, ...rest] = data.split(":");
  const identifier = rest.join(":");

  if (action === "no") {
    await ctx.editMessageText("Archive cancelled.", { parse_mode: "HTML" });
    return;
  }

  // action === "yes"
  await ctx.editMessageText("🔄 Archiving...", { parse_mode: "HTML" });

  // Handle orphan topics (no session/record) — delete topic directly
  if (identifier.startsWith("topic:")) {
    const topicId = Number(identifier.slice("topic:".length));
    try {
      await ctx.api.deleteForumTopic(chatId, topicId);
      core.notificationManager.notifyAll({
        sessionId: "system",
        sessionName: `Orphan topic #${topicId}`,
        type: "completed",
        summary: `Orphan topic #${topicId} archived and deleted.`,
      });
    } catch (err) {
      core.notificationManager.notifyAll({
        sessionId: "system",
        sessionName: `Orphan topic #${topicId}`,
        type: "error",
        summary: `Failed to delete orphan topic #${topicId}: ${(err as Error).message}`,
      });
    }
    return;
  }

  const result = await core.archiveSession(identifier);
  if (result.ok) {
    core.notificationManager.notifyAll({
      sessionId: identifier,
      type: "completed",
      summary: `Session archived and deleted.`,
    });
  } else {
    try {
      await ctx.editMessageText(`❌ Failed to archive: <code>${escapeHtml(result.error)}</code>`, { parse_mode: "HTML" });
    } catch {
      core.notificationManager.notifyAll({
        sessionId: identifier,
        type: "error",
        summary: `Failed to archive session "${identifier}": ${result.error}`,
      });
    }
  }
}

export async function handleSummary(
  ctx: Context,
  core: OpenACPCore,
): Promise<void> {
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return;

  const session = core.sessionManager.getSessionByThread("telegram", String(threadId));
  const record = !session ? core.sessionManager.getRecordByThread("telegram", String(threadId)) : undefined;
  const sessionId = session?.id ?? record?.sessionId;

  if (!sessionId) {
    await ctx.reply(
      "ℹ️ <b>/summary</b> works in session topics — it asks the agent to summarize the session.\n\nGo to a session topic and type /summary there.",
      { parse_mode: "HTML" },
    );
    return;
  }

  await ctx.replyWithChatAction("typing");
  const result = await core.summarizeSession(sessionId);

  if (result.ok) {
    await ctx.reply(formatSummary(result.summary, session?.name ?? record?.name), { parse_mode: "HTML" });
  } else {
    await ctx.reply(`⚠️ ${escapeHtml(result.error)}`, { parse_mode: "HTML" });
  }
}

export async function handleSummaryCallback(
  ctx: Context,
  core: OpenACPCore,
  chatId: number,
): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const sessionId = data.replace("sm:summary:", "");

  try {
    await ctx.answerCallbackQuery();
  } catch { /* expired */ }

  // Find thread ID from active session or stored record
  const session = core.sessionManager.getSession(sessionId);
  const record = !session ? core.sessionManager.getSessionRecord(sessionId) : undefined;
  const threadId = session ? Number(session.threadId) : ((record?.platform as any)?.topicId ?? 0);
  if (!threadId) return;

  await ctx.api.sendMessage(chatId, "📋 Generating summary...", {
    message_thread_id: threadId,
    parse_mode: "HTML",
  });

  const result = await core.summarizeSession(sessionId);
  const sessionName = session?.name ?? record?.name;
  if (result.ok) {
    await ctx.api.sendMessage(chatId, formatSummary(result.summary, sessionName), {
      message_thread_id: threadId,
      parse_mode: "HTML",
    });
  } else {
    await ctx.api.sendMessage(chatId, `⚠️ ${escapeHtml(result.error)}`, {
      message_thread_id: threadId,
      parse_mode: "HTML",
    });
  }
}
