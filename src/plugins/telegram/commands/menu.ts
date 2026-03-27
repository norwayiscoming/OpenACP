import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { AgentCommand } from "../../../core/index.js";
import type { CommandsAssistantContext } from "../types.js";

export function buildMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🆕 New Session", "m:new")
    .text("📋 Sessions", "m:topics")
    .row()
    .text("📊 Status", "m:status")
    .text("🤖 Agents", "m:agents")
    .row()
    .text("⚙️ Settings", "m:settings")
    .text("🔗 Integrate", "m:integrate")
    .row()
    .text("🔄 Restart", "m:restart")
    .text("⬆️ Update", "m:update")
    .row()
    .text("❓ Help", "m:help")
    .text("🩺 Doctor", "m:doctor");
}

export async function handleMenu(ctx: Context): Promise<void> {
  await ctx.reply(`<b>OpenACP Menu</b>\nChoose an action:`, {
    parse_mode: "HTML",
    reply_markup: buildMenuKeyboard(),
  });
}

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    `📖 <b>OpenACP Help</b>\n\n` +
      `🚀 <b>Getting Started</b>\n` +
      `Tap 🆕 New Session to start coding with AI.\n` +
      `Each session gets its own topic — chat there to work with the agent.\n\n` +
      `💡 <b>Common Tasks</b>\n` +
      `/new [agent] [workspace] — Create new session\n` +
      `/cancel — Cancel session (in session topic)\n` +
      `/status — Show session or system status\n` +
      `/sessions — List all sessions\n` +
      `/agents — Browse & install agents\n` +
      `/install <name> — Install an agent\n\n` +
      `⚙️ <b>System</b>\n` +
      `/restart — Restart OpenACP\n` +
      `/update — Update to latest version\n` +
      `/integrate — Manage agent integrations\n` +
      `/menu — Show action menu\n\n` +
      `🔒 <b>Session Options</b>\n` +
      `/enable_dangerous — Auto-approve permissions\n` +
      `/disable_dangerous — Restore permission prompts\n` +
      `/handoff — Continue session in terminal\n` +
      `/archive — Archive session topic\n` +
      `/clear — Clear assistant history\n\n` +
      `💬 Need help? Just ask me in this topic!`,
    { parse_mode: "HTML" },
  );
}

export async function handleClear(ctx: Context, assistant?: CommandsAssistantContext): Promise<void> {
  if (!assistant) {
    await ctx.reply("⚠️ Assistant is not available.", { parse_mode: "HTML" });
    return;
  }

  const threadId = ctx.message?.message_thread_id;
  if (threadId !== assistant.topicId) {
    await ctx.reply("ℹ️ /clear only works in the Assistant topic.", { parse_mode: "HTML" });
    return;
  }

  await ctx.reply("🔄 Clearing assistant history...", { parse_mode: "HTML" });

  try {
    await assistant.respawn();
    await ctx.reply("✅ Assistant history cleared.", { parse_mode: "HTML" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ Failed to clear: <code>${message}</code>`, { parse_mode: "HTML" });
  }
}

const TELEGRAM_MSG_LIMIT = 4096;

/**
 * Build plain-text skill command messages. Each command is on its own line
 * wrapped in <code> for tap-to-copy. If the list exceeds Telegram's message
 * limit, it is split into multiple messages (cut at line boundaries).
 */
export function buildSkillMessages(commands: AgentCommand[]): string[] {
  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
  const header = "🛠 <b>Available Skills</b>\n";
  const lines = sorted.map((c) => `<code>/${c.name}</code>`);

  const messages: string[] = [];
  let current = header;

  for (const line of lines) {
    const candidate = current + "\n" + line;
    if (candidate.length > TELEGRAM_MSG_LIMIT) {
      messages.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);
  return messages;
}
