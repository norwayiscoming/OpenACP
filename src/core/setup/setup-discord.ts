import * as clack from "@clack/prompts";
import type { DiscordChannelConfig } from "../../adapters/discord/types.js";
import { guardCancel, ok, fail, dim, c } from "./helpers.js";
import { validateDiscordToken } from "./validation.js";

export async function setupDiscord(opts?: {
  existing?: DiscordChannelConfig;
}): Promise<DiscordChannelConfig> {
  const { existing } = opts ?? {};

  console.log('\nDiscord Setup\n');

  console.log(`  ${c.bold}Quick setup:${c.reset}`);
  console.log(dim('  1. Create app at https://discord.com/developers/applications'));
  console.log(dim('  2. Go to Bot → Reset Token → copy it'));
  console.log(dim('  3. Enable Message Content Intent (Bot → Privileged Intents)'));
  console.log(dim('  4. OAuth2 → URL Generator → scopes: bot + applications.commands'));
  console.log(dim('  5. Bot Permissions: Manage Channels, Send Messages, Manage Threads, Attach Files'));
  console.log(dim('  6. Open generated URL → invite bot to your server'));
  console.log('');
  console.log(dim(`  Detailed guide: https://github.com/Open-ACP/OpenACP/blob/main/docs/guide/discord-setup.md`));
  console.log('');

  let botToken = '';
  const existingToken = existing?.botToken;

  while (true) {
    const tokenInput = guardCancel(
      await clack.text({
        message: existingToken
          ? 'Bot token (from Discord Developer Portal) — leave blank to keep current:'
          : 'Bot token (from Discord Developer Portal):',
        ...(existingToken ? { placeholder: 'Leave blank to keep current' } : {}),
        validate: (val) => {
          if (existingToken && (val ?? "").toString().trim().length === 0) return undefined;
          if ((val ?? "").toString().trim().length > 0) return undefined;
          return 'Token cannot be empty';
        },
      }),
    ) as string;
    const keptExisting = existingToken && !tokenInput.trim();
    botToken = tokenInput.trim() || existingToken || '';
    if (!botToken) continue;

    // Skip validation if keeping existing token
    if (keptExisting) {
      console.log(ok("Keeping current bot token"));
      break;
    }

    const s = clack.spinner();
    s.start("Validating token...");
    const result = await validateDiscordToken(botToken);
    s.stop("Token validated");

    if (result.ok) {
      console.log(ok(`Connected as @${result.username} (id: ${result.id})`));
      break;
    }
    console.log(fail(result.error));
    const action = guardCancel(
      await clack.select({
        message: 'What to do?',
        options: [
          { label: 'Re-enter token', value: 'retry' },
          { label: 'Use as-is (skip validation)', value: 'skip' },
        ],
      }),
    );
    if (action === 'skip') break;
  }

  const guildIdInput = guardCancel(
    await clack.text({
      message: existing?.guildId
        ? 'Guild (server) ID — leave blank to keep current:'
        : 'Guild (server) ID:',
      ...(existing?.guildId ? { placeholder: `Current: ${existing.guildId}` } : {}),
      validate: (val) => {
        const trimmed = (val ?? "").toString().trim();
        if (existing?.guildId && !trimmed) return undefined;
        if (!trimmed) return 'Guild ID cannot be empty';
        if (!/^\d{17,20}$/.test(trimmed)) return 'Guild ID must be a numeric Discord snowflake (17-20 digits)';
        return undefined;
      },
    }),
  ) as string;
  const guildId = (guildIdInput.trim() || existing?.guildId || '');

  return {
    enabled: true,
    botToken,
    guildId: guildId.trim(),
    forumChannelId: existing?.forumChannelId ?? null,
    notificationChannelId: existing?.notificationChannelId ?? null,
    assistantThreadId: existing?.assistantThreadId ?? null,
  };
}
