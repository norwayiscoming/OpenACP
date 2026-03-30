import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { OpenACPCore } from "../../../core/index.js";
import { escapeHtml } from "../formatting.js";
import { createChildLogger } from "../../../core/utils/log.js";

const log = createChildLogger({ module: "telegram-cmd-switch" });

export async function handleSwitch(
  ctx: Context,
  core: OpenACPCore,
): Promise<void> {
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return;

  const session = core.sessionManager.getSessionByThread(
    "telegram",
    String(threadId),
  );
  if (!session) {
    await ctx.reply("No active session in this topic.");
    return;
  }

  const rawMatch = (ctx as Context & { match: unknown }).match;
  const raw = (typeof rawMatch === "string" ? rawMatch : "").trim();

  // /switch label on|off
  if (raw.startsWith("label ")) {
    const value = raw.slice(6).trim().toLowerCase();
    if (value === "on" || value === "off") {
      await core.configManager.save(
        { agentSwitch: { labelHistory: value === "on" } },
        "agentSwitch.labelHistory",
      );
      await ctx.reply(`Agent label in history: ${value}`);
    } else {
      await ctx.reply("Usage: /switch label on|off");
    }
    return;
  }

  // /switch (no args) → show menu
  if (!raw) {
    const agents = core.agentManager.getAvailableAgents();
    const currentAgent = session.agentName;
    const options = agents.filter((a) => a.name !== currentAgent);

    if (options.length === 0) {
      await ctx.reply("No other agents available.");
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const agent of options) {
      keyboard.text(agent.name, `sw:${agent.name}`).row();
    }

    await ctx.reply(
      `<b>Switch Agent</b>\nCurrent: <code>${escapeHtml(currentAgent)}</code>\n\nSelect an agent:`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
    return;
  }

  // /switch <agentName> → direct switch
  await executeSwitchAgent(ctx, core, session.id, raw);
}

export async function executeSwitchAgent(
  ctx: Context,
  core: OpenACPCore,
  sessionId: string,
  agentName: string,
): Promise<void> {
  try {
    const { resumed } = await core.switchSessionAgent(sessionId, agentName);
    const status = resumed ? "resumed" : "new session";
    await ctx.reply(
      `Switched to <b>${escapeHtml(agentName)}</b> (${status})`,
      { parse_mode: "HTML" },
    );
    log.info({ sessionId, agentName, resumed }, "Agent switched via /switch");
  } catch (err: any) {
    await ctx.reply(`Failed to switch agent: ${escapeHtml(String(err.message || err))}`);
    log.warn({ sessionId, agentName, err: err.message }, "Agent switch failed");
  }
}

export function setupSwitchCallbacks(
  bot: import("grammy").Bot,
  core: OpenACPCore,
): void {
  bot.callbackQuery(/^sw:/, async (ctx) => {
    const agentName = ctx.callbackQuery.data!.replace("sw:", "");
    await ctx.answerCallbackQuery();

    const threadId = ctx.callbackQuery.message?.message_thread_id;
    if (!threadId) return;

    const session = core.sessionManager.getSessionByThread(
      "telegram",
      String(threadId),
    );
    if (!session) {
      await ctx.reply("No active session in this topic.");
      return;
    }

    await executeSwitchAgent(ctx, core, session.id, agentName);
  });
}
