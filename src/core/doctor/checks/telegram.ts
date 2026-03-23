import type { DoctorCheck, CheckResult } from "../types.js";

const BOT_TOKEN_REGEX = /^\d+:[A-Za-z0-9_-]{35,}$/;

export const telegramCheck: DoctorCheck = {
  name: "Telegram",
  order: 3,
  async run(ctx) {
    const results: CheckResult[] = [];

    if (!ctx.config) {
      results.push({ status: "fail", message: "Cannot check Telegram — config not loaded" });
      return results;
    }

    const tgConfig = ctx.config.channels.telegram as Record<string, unknown> | undefined;
    if (!tgConfig || !tgConfig.enabled) {
      results.push({ status: "pass", message: "Telegram not enabled (skipped)" });
      return results;
    }

    const botToken = tgConfig.botToken as string | undefined;
    const chatId = tgConfig.chatId as number | undefined;

    if (!botToken || !BOT_TOKEN_REGEX.test(botToken)) {
      results.push({ status: "fail", message: "Bot token format invalid" });
      return results;
    }
    results.push({ status: "pass", message: "Bot token format valid" });

    let botId: number | undefined;
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = (await res.json()) as { ok: boolean; result?: { id: number; username: string }; description?: string };
      if (data.ok && data.result) {
        botId = data.result.id;
        results.push({ status: "pass", message: `Bot token valid (@${data.result.username})` });
      } else {
        results.push({ status: "fail", message: `Bot token rejected: ${data.description || "unknown error"}` });
        return results;
      }
    } catch (err) {
      results.push({ status: "fail", message: `Cannot reach Telegram API: ${err instanceof Error ? err.message : String(err)}` });
      return results;
    }

    if (!chatId || chatId === 0) {
      results.push({ status: "fail", message: "Chat ID not configured" });
      return results;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: { type: string; is_forum?: boolean; title: string };
        description?: string;
      };
      if (!data.ok || !data.result) {
        results.push({ status: "fail", message: `Chat ID invalid: ${data.description || "unknown error"}` });
        return results;
      }
      if (data.result.type !== "supergroup") {
        results.push({ status: "fail", message: `Chat is "${data.result.type}", must be a supergroup` });
        return results;
      }
      if (!data.result.is_forum) {
        results.push({ status: "warn", message: "Chat does not have topics enabled" });
      } else {
        results.push({ status: "pass", message: `Chat is supergroup with topics ("${data.result.title}")` });
      }
    } catch (err) {
      results.push({ status: "fail", message: `Cannot validate chat: ${err instanceof Error ? err.message : String(err)}` });
      return results;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, user_id: botId }),
      });
      const data = (await res.json()) as { ok: boolean; result?: { status: string }; description?: string };
      if (!data.ok || !data.result) {
        results.push({ status: "fail", message: `Cannot check bot membership: ${data.description || "unknown"}` });
      } else if (data.result.status === "administrator" || data.result.status === "creator") {
        results.push({ status: "pass", message: "Bot is admin in group" });
      } else {
        results.push({
          status: "fail",
          message: `Bot is "${data.result.status}" — must be admin. Promote bot in group settings.`,
        });
      }
    } catch (err) {
      results.push({ status: "fail", message: `Admin check failed: ${err instanceof Error ? err.message : String(err)}` });
    }

    return results;
  },
};
