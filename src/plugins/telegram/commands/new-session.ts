import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { OpenACPCore } from "../../../core/index.js";
import type { Session } from "../../../core/sessions/session.js";
import { escapeHtml } from "../formatting.js";
import { createSessionTopic, renameSessionTopic, buildDeepLink } from "../topics.js";
import { createChildLogger } from "../../../core/utils/log.js";
import { buildSessionControlKeyboard, buildSessionStatusText } from "./admin.js";
import type { CommandsAssistantContext } from "../types.js";
const log = createChildLogger({ module: "telegram-cmd-new-session" });

function botFromCtx(ctx: Context): Bot {
  // createSessionTopic only uses bot.api.createForumTopic
  return { api: ctx.api } as unknown as Bot;
}

export async function handleNew(
  ctx: Context,
  core: OpenACPCore,
  chatId: number,
  assistant?: CommandsAssistantContext,
  onControlMessage?: (sessionId: string, msgId: number) => void,
): Promise<void> {
  const rawMatch = (ctx as Context & { match: unknown }).match;
  const matchStr = typeof rawMatch === "string" ? rawMatch : "";
  const args = matchStr.split(" ").filter(Boolean);
  const agentName = args[0];
  const workspace = args[1];

  // Full args → create directly
  if (agentName && workspace) {
    await createSessionDirect(ctx, core, chatId, agentName, workspace, onControlMessage);
    return;
  }

  // In assistant topic → forward to assistant for conversational handling
  const currentThreadId = ctx.message?.message_thread_id;
  if (assistant && currentThreadId === assistant.topicId) {
    const assistantSession = assistant.getSession();
    if (assistantSession) {
      const prompt = agentName
        ? `User wants to create a new session with agent "${agentName}" but didn't specify a workspace. Ask them which project directory to use as workspace.`
        : `User wants to create a new session. Guide them through choosing an agent and workspace (project directory).`;
      await assistantSession.enqueuePrompt(prompt);
      return;
    }
  }

  // Outside assistant topic or no assistant — show usage hint
  await ctx.reply(
    `Usage: <code>/new &lt;agent&gt; &lt;workspace&gt;</code>\n\n` +
      `Or ask the assistant to create a session for you.`,
    { parse_mode: "HTML" },
  );
}

export async function createSessionDirect(
  ctx: Context,
  core: OpenACPCore,
  chatId: number,
  agentName: string,
  workspace: string,
  onControlMessage?: (sessionId: string, msgId: number) => void,
): Promise<number | null> {
  log.info({ userId: ctx.from?.id, agentName, workspace }, "New session command (direct)");

  let threadId: number | undefined;
  try {
    const topicName = `🔄 New Session`;
    threadId = await createSessionTopic(botFromCtx(ctx), chatId, topicName);

    await ctx.api.sendMessage(chatId, `⏳ Setting up session, please wait...`, {
      message_thread_id: threadId,
      parse_mode: "HTML",
    });

    const session = await core.handleNewSession("telegram", agentName, workspace);
    session.threadId = String(threadId);

    await core.sessionManager.patchRecord(session.id, { platform: { topicId: threadId } });

    const finalName = `🔄 ${session.agentName} — New Session`;
    try {
      await ctx.api.editForumTopic(chatId, threadId, { name: finalName });
    } catch { /* ignore rename failures */ }

    const controlMsg = await ctx.api.sendMessage(
      chatId,
      buildSessionStatusText(session, `✅ <b>Session started</b>`),
      {
        message_thread_id: threadId,
        parse_mode: "HTML",
        reply_markup: buildSessionControlKeyboard(session.id, false, false),
      },
    );

    onControlMessage?.(session.id, controlMsg.message_id);

    return threadId ?? null;
  } catch (err) {
    log.error({ err }, "Session creation failed");
    if (threadId) {
      try { await ctx.api.deleteForumTopic(chatId, threadId); } catch { /* ignore */ }
    }
    const message = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
    await ctx.reply(`❌ ${escapeHtml(message)}`, { parse_mode: "HTML" });
    return null;
  }
}

export async function handleNewChat(
  ctx: Context,
  core: OpenACPCore,
  chatId: number,
  onControlMessage?: (sessionId: string, msgId: number) => void,
): Promise<void> {
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) {
    await ctx.reply(
      "Use /newchat inside a session topic to inherit its config.",
      { parse_mode: "HTML" },
    );
    return;
  }

  // Resolve agent config from existing session/record BEFORE spawning
  const currentSession = await core.getOrResumeSession(
    "telegram",
    String(threadId),
  );
  let agentName: string | undefined;
  let workspace: string | undefined;

  if (currentSession) {
    agentName = currentSession.agentName;
    workspace = currentSession.workingDirectory;
  } else {
    const record = core.sessionManager.getRecordByThread("telegram", String(threadId));
    if (!record || record.status === "cancelled" || record.status === "error") {
      await ctx.reply("No active session in this topic.", {
        parse_mode: "HTML",
      });
      return;
    }
    agentName = record.agentName;
    workspace = record.workingDir;
  }

  let newThreadId: number | undefined;
  try {
    // Create topic FIRST so threadId is ready before session events fire
    const topicName = `🔄 ${agentName} — New Chat`;
    newThreadId = await createSessionTopic(
      botFromCtx(ctx),
      chatId,
      topicName,
    );

    // Notify in the original topic immediately with a deep link to the new one
    const topicLink = buildDeepLink(chatId, newThreadId);
    await ctx.reply(
      `✅ New chat created → <a href="${topicLink}">Open topic</a>`,
      { parse_mode: "HTML" },
    );

    await ctx.api.sendMessage(chatId, `⏳ Setting up session, please wait...`, {
      message_thread_id: newThreadId,
      parse_mode: "HTML",
    });

    const session = await core.handleNewSession(
      "telegram",
      agentName,
      workspace,
    );
    session.threadId = String(newThreadId);

    // Persist platform mapping for new chat
    await core.sessionManager.patchRecord(session.id, { platform: {
      topicId: newThreadId,
    } });

    const controlMsg = await ctx.api.sendMessage(
      chatId,
      buildSessionStatusText(session, `✅ New chat (same agent &amp; workspace)`),
      {
        message_thread_id: newThreadId,
        parse_mode: "HTML",
        reply_markup: buildSessionControlKeyboard(session.id, false, false),
      },
    );

    onControlMessage?.(session.id, controlMsg.message_id);

  } catch (err) {
    // Clean up orphaned topic if session creation failed
    if (newThreadId) {
      try {
        await ctx.api.deleteForumTopic(chatId, newThreadId);
      } catch {
        /* ignore cleanup failures */
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ ${escapeHtml(message)}`, { parse_mode: "HTML" });
  }
}

// --- New Session button flow (ns: prefix) ---

/** Workspace cache for callback data — avoids Telegram's 64-byte callback limit */
const workspaceCache = new Map<number, { agentKey: string; workspace: string }>()
let nextWsId = 0

export async function showAgentPicker(ctx: Context, core: OpenACPCore, chatId: number): Promise<void> {
  const catalog = core.agentCatalog
  const installed = catalog.getAvailable().filter((i) => i.installed)

  if (installed.length === 0) {
    await ctx.reply('No agents installed. Use /install to add one.', { parse_mode: 'HTML' }).catch(() => {})
    return
  }

  // Single agent → skip picker, go to workspace
  if (installed.length === 1) {
    await showWorkspacePicker(ctx, core, chatId, installed[0].key)
    return
  }

  const kb = new InlineKeyboard()
  for (let i = 0; i < installed.length; i += 2) {
    const row = installed.slice(i, i + 2)
    for (const agent of row) {
      kb.text(agent.name, `ns:agent:${agent.key}`)
    }
    kb.row()
  }

  await ctx.reply('<b>🆕 New Session</b>\nSelect an agent:', {
    parse_mode: 'HTML',
    reply_markup: kb,
  }).catch(() => {})
}

async function showWorkspacePicker(ctx: Context, core: OpenACPCore, chatId: number, agentKey: string): Promise<void> {
  const records = core.sessionManager.listRecords()
  const recentWorkspaces = [...new Set(records.map((r: any) => r.workingDir).filter(Boolean))]
    .slice(0, 5)

  const config = core.configManager.get()
  const baseDir = config.workspace.baseDir

  // Ensure baseDir is always an option
  const workspaces = recentWorkspaces.includes(baseDir)
    ? recentWorkspaces
    : [baseDir, ...recentWorkspaces].slice(0, 5)

  const kb = new InlineKeyboard()
  for (const ws of workspaces) {
    const id = nextWsId++
    workspaceCache.set(id, { agentKey, workspace: ws })
    // Show shortened path for display
    const label = ws.startsWith('/Users/') ? '~/' + ws.split('/').slice(3).join('/') : ws
    kb.text(`📁 ${label}`, `ns:ws:${id}`).row()
  }
  // Custom path → delegate to AI
  kb.text('📁 Custom path...', `ns:custom:${agentKey}`).row()

  const agentLabel = escapeHtml(agentKey)
  await ctx.reply(`<b>🆕 New Session</b>\nAgent: <code>${agentLabel}</code>\n\nSelect workspace:`, {
    parse_mode: 'HTML',
    reply_markup: kb,
  }).catch(() => {})
}

export function setupNewSessionCallbacks(
  bot: Bot,
  core: OpenACPCore,
  chatId: number,
  getAssistantSession?: () => { topicId: number; enqueuePrompt: (p: string) => Promise<void> } | undefined,
): void {
  // Agent picker (also triggered from m: handler callback case)
  bot.callbackQuery('ns:start', async (ctx) => {
    try { await ctx.answerCallbackQuery() } catch { /* expired */ }
    await showAgentPicker(ctx, core, chatId)
  })

  bot.callbackQuery(/^ns:agent:/, async (ctx) => {
    const agentKey = ctx.callbackQuery.data.replace('ns:agent:', '')
    try { await ctx.answerCallbackQuery() } catch { /* expired */ }
    await showWorkspacePicker(ctx, core, chatId, agentKey)
  })

  bot.callbackQuery(/^ns:ws:/, async (ctx) => {
    const id = parseInt(ctx.callbackQuery.data.replace('ns:ws:', ''), 10)
    try { await ctx.answerCallbackQuery() } catch { /* expired */ }

    const entry = workspaceCache.get(id)
    if (!entry) {
      await ctx.reply('⚠️ Session expired. Please try again via /menu.').catch(() => {})
      return
    }
    workspaceCache.delete(id)
    await createSessionDirect(ctx, core, chatId, entry.agentKey, entry.workspace)
  })

  bot.callbackQuery(/^ns:custom:/, async (ctx) => {
    const agentKey = ctx.callbackQuery.data.replace('ns:custom:', '')
    try { await ctx.answerCallbackQuery() } catch { /* expired */ }

    const assistant = getAssistantSession?.()
    if (assistant) {
      await assistant.enqueuePrompt(
        `User wants to create a new session with agent "${agentKey}". Ask them for the workspace (project directory) path, then create the session.`
      )
    } else {
      await ctx.reply(
        `Usage: <code>/new ${escapeHtml(agentKey)} &lt;workspace-path&gt;</code>`,
        { parse_mode: 'HTML' },
      ).catch(() => {})
    }
  })
}

export async function executeNewSession(
  bot: Bot,
  core: OpenACPCore,
  chatId: number,
  agentName?: string,
  workspace?: string,
): Promise<{ session: Session; threadId: number; firstMsgId: number }> {
  // Create topic with generic name first (same as original handleNew)
  const threadId = await createSessionTopic(bot, chatId, "🔄 New Session");

  const setupMsg = await bot.api.sendMessage(chatId, "⏳ Setting up session, please wait...", {
    message_thread_id: threadId,
    parse_mode: "HTML",
  });
  const firstMsgId = setupMsg.message_id;

  try {
    // core.handleNewSession() already wires events internally — do NOT call wireSessionEvents again
    const session = await core.handleNewSession(
      "telegram",
      agentName,
      workspace,
    );
    session.threadId = String(threadId);

    await core.sessionManager.patchRecord(session.id, { platform: {
      topicId: threadId,
    } });

    // Rename topic with agent name after session is created
    const finalName = `🔄 ${session.agentName} — New Session`;
    await renameSessionTopic(bot, chatId, threadId, finalName);

    return { session, threadId, firstMsgId };
  } catch (err) {
    // Clean up orphaned topic on failure
    try {
      await bot.api.deleteForumTopic(chatId, threadId);
    } catch {
      /* best effort */
    }
    throw err;
  }
}
