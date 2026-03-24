import type { DoctorCheck, CheckResult } from "../types.js";

// Discord bot tokens are base64-encoded and follow a recognizable pattern:
// <user_id>.<timestamp>.<hmac> — the user_id part is a base64-encoded snowflake
const BOT_TOKEN_REGEX = /^[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}$/;

export const discordCheck: DoctorCheck = {
  name: "Discord",
  order: 3.5,
  async run(ctx) {
    const results: CheckResult[] = [];

    if (!ctx.config) {
      results.push({ status: "fail", message: "Cannot check Discord — config not loaded" });
      return results;
    }

    const discordConfig = (ctx.config.channels as Record<string, unknown>).discord as Record<string, unknown> | undefined;
    if (!discordConfig || !discordConfig.enabled) {
      results.push({ status: "pass", message: "Discord not enabled (skipped)" });
      return results;
    }

    // Check 1: Bot token format/presence
    const botToken = discordConfig.botToken as string | undefined;
    if (!botToken || !BOT_TOKEN_REGEX.test(botToken)) {
      results.push({ status: "fail", message: "Discord bot token format invalid or missing" });
      return results;
    }
    results.push({ status: "pass", message: "Discord bot token format valid" });

    // Check 2: Token validity via GET https://discord.com/api/v10/users/@me
    let botUsername: string | undefined;
    try {
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (res.status === 200) {
        const data = (await res.json()) as { username: string; id: string };
        botUsername = data.username;
        results.push({ status: "pass", message: `Bot token valid (@${data.username}, id: ${data.id})` });
      } else if (res.status === 401) {
        results.push({ status: "fail", message: "Bot token rejected by Discord (401 Unauthorized)" });
        return results;
      } else {
        const text = await res.text();
        results.push({ status: "fail", message: `Discord API error ${res.status}: ${text.slice(0, 100)}` });
        return results;
      }
    } catch (err) {
      results.push({ status: "fail", message: `Cannot reach Discord API: ${err instanceof Error ? err.message : String(err)}` });
      return results;
    }

    // Check 3: Guild access via GET https://discord.com/api/v10/guilds/{guildId}
    const guildId = discordConfig.guildId as string | undefined;
    if (!guildId) {
      results.push({ status: "fail", message: "Guild ID not configured" });
      return results;
    }

    try {
      const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (res.status === 200) {
        const data = (await res.json()) as { name: string; id: string };
        results.push({ status: "pass", message: `Bot has access to guild "${data.name}" (id: ${data.id})` });
      } else if (res.status === 403) {
        results.push({
          status: "fail",
          message: `Bot (${botUsername ?? "unknown"}) is not a member of guild ${guildId} or lacks access. Invite the bot to your server.`,
        });
      } else if (res.status === 404) {
        results.push({ status: "fail", message: `Guild ${guildId} not found — check the guild ID` });
      } else {
        const text = await res.text();
        results.push({ status: "fail", message: `Guild check error ${res.status}: ${text.slice(0, 100)}` });
      }
    } catch (err) {
      results.push({ status: "fail", message: `Cannot validate guild: ${err instanceof Error ? err.message : String(err)}` });
    }

    return results;
  },
};
