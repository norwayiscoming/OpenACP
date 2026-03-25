import { execFileSync } from "node:child_process";
import * as clack from "@clack/prompts";
import type { Config, ConfigManager } from "./config.js";
import { expandHome } from "./config.js";
import { commandExists } from "./agent-dependencies.js";
import type { DiscordChannelConfig } from "../adapters/discord/types.js";

function guardCancel<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }
  return value as T;
}

// --- ANSI colors ---

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

const ok = (msg: string) =>
  `${c.green}${c.bold}✓${c.reset} ${c.green}${msg}${c.reset}`;
const warn = (msg: string) => `${c.yellow}⚠ ${msg}${c.reset}`;
const fail = (msg: string) => `${c.red}✗ ${msg}${c.reset}`;
const step = (n: number, total: number, title: string) =>
  `\n${c.cyan}${c.bold}[${n}/${total}]${c.reset} ${c.bold}${title}${c.reset}\n`;
const dim = (msg: string) => `${c.dim}${msg}${c.reset}`;

// --- Telegram validation ---

export async function validateBotToken(
  token: string,
): Promise<
  | { ok: true; botName: string; botUsername: string }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as {
      ok: boolean;
      result?: { first_name: string; username: string };
      description?: string;
    };
    if (data.ok && data.result) {
      return {
        ok: true,
        botName: data.result.first_name,
        botUsername: data.result.username,
      };
    }
    return { ok: false, error: data.description || "Invalid token" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function validateChatId(
  token: string,
  chatId: number,
): Promise<
  { ok: true; title: string; isForum: boolean } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: { title: string; type: string; is_forum?: boolean };
      description?: string;
    };
    if (!data.ok || !data.result) {
      return { ok: false, error: data.description || "Invalid chat ID" };
    }
    if (data.result.type !== "supergroup") {
      return {
        ok: false,
        error: `Chat is "${data.result.type}", must be a supergroup`,
      };
    }
    return {
      ok: true,
      title: data.result.title,
      isForum: data.result.is_forum === true,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function validateBotAdmin(
  token: string,
  chatId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Get bot's own user ID
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = (await meRes.json()) as {
      ok: boolean;
      result?: { id: number };
    };
    if (!meData.ok || !meData.result) {
      return { ok: false, error: "Could not retrieve bot info" };
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChatMember`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, user_id: meData.result.id }),
      },
    );
    const data = (await res.json()) as {
      ok: boolean;
      result?: { status: string };
      description?: string;
    };
    if (!data.ok || !data.result) {
      return {
        ok: false,
        error: data.description || "Could not check bot membership",
      };
    }

    const { status } = data.result;
    if (status === "administrator" || status === "creator") {
      return { ok: true };
    }
    return {
      ok: false,
      error: `Bot is "${status}" in this group. It must be an admin. Please promote the bot to admin in group settings.`,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// --- Chat ID auto-detection ---

async function promptManualChatId(): Promise<number> {
  const val = guardCancel(
    await clack.text({
      message: "Supergroup chat ID (e.g. -1001234567890):",
      validate: (val) => {
        const n = Number((val ?? "").toString().trim());
        if (isNaN(n) || !Number.isInteger(n)) return "Chat ID must be an integer";
        return undefined;
      },
    }),
  ) as string;
  return Number(val.trim());
}

async function detectChatId(token: string): Promise<number> {
  // Clear old updates
  let lastUpdateId = 0;
  try {
    const clearRes = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=-1`,
    );
    const clearData = (await clearRes.json()) as {
      ok: boolean;
      result?: Array<{ update_id: number }>;
    };
    if (clearData.ok && clearData.result?.length) {
      lastUpdateId = clearData.result[clearData.result.length - 1].update_id;
    }
  } catch {
    // ignore
  }

  console.log("");
  console.log(`  ${c.bold}If you don't have a supergroup yet:${c.reset}`);
  console.log(dim("  1. Open Telegram → New Group → add your bot"));
  console.log(dim("  2. Group Settings → convert to Supergroup"));
  console.log(dim("  3. Enable Topics in group settings"));
  console.log("");
  console.log(`  ${c.bold}Then send "hi" in the group.${c.reset}`);
  console.log(
    dim(
      `  Listening... press ${c.reset}${c.yellow}m${c.reset}${c.dim} to enter ID manually`,
    ),
  );
  console.log("");

  const MAX_ATTEMPTS = 120;
  const POLL_INTERVAL = 1000;

  // Listen for 'm' keypress to switch to manual
  let cancelled = false;
  const onKeypress = (data: Buffer) => {
    const key = data.toString();
    if (key === "m" || key === "M") {
      cancelled = true;
    }
  };
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onKeypress);
  }

  const cleanup = () => {
    if (process.stdin.isTTY) {
      process.stdin.removeListener("data", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };

  try {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (cancelled) {
        cleanup();
        return promptManualChatId();
      }

      try {
        const offset = lastUpdateId ? lastUpdateId + 1 : 0;
        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=1`,
        );
        const data = (await res.json()) as {
          ok: boolean;
          result?: Array<{
            update_id: number;
            message?: {
              chat: { id: number; title?: string; type: string };
            };
            my_chat_member?: {
              chat: { id: number; title?: string; type: string };
            };
          }>;
        };

        if (!data.ok || !data.result?.length) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          continue;
        }

        const groups = new Map<number, string>();
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          const chat = update.message?.chat ?? update.my_chat_member?.chat;
          if (chat && (chat.type === "supergroup" || chat.type === "group")) {
            groups.set(chat.id, chat.title ?? String(chat.id));
          }
        }

        if (groups.size === 1) {
          const [id, title] = [...groups.entries()][0];
          console.log(
            ok(`Group detected: ${c.bold}${title}${c.reset}${c.green} (${id})`),
          );
          cleanup();
          return id;
        }

        if (groups.size > 1) {
          cleanup();
          const options = [...groups.entries()].map(([id, title]) => ({
            label: `${title} (${id})`,
            value: id,
          }));
          return guardCancel(
            await clack.select({
              message: "Multiple groups found. Pick one:",
              options,
            }),
          );
        }
      } catch {
        // Network error, retry
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    console.log(warn("Timed out waiting for messages."));
    cleanup();
    return promptManualChatId();
  } catch (err) {
    cleanup();
    throw err;
  }
}

// --- Agent detection ---

const KNOWN_AGENTS: Array<{ name: string; commands: string[] }> = [
  // claude-agent-acp is bundled as a dependency — no detection needed, but
  // kept here so detectAgents() still returns it for display purposes.
  { name: "claude", commands: ["claude-agent-acp"] },
  { name: "codex", commands: ["codex"] },
];

export async function detectAgents(): Promise<
  Array<{ name: string; command: string }>
> {
  const found: Array<{ name: string; command: string }> = [];
  for (const agent of KNOWN_AGENTS) {
    // Find all available commands for this agent (PATH + node_modules/.bin)
    const available: string[] = [];
    for (const cmd of agent.commands) {
      if (commandExists(cmd)) {
        available.push(cmd);
      }
    }
    if (available.length > 0) {
      // Prefer claude-agent-acp over claude/claude-code (priority order)
      found.push({ name: agent.name, command: available[0] });
    }
  }
  return found;
}

export async function validateAgentCommand(command: string): Promise<boolean> {
  try {
    execFileSync("which", [command], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// --- Setup steps ---

export async function setupTelegram(stepNum = 1, totalSteps = 3): Promise<Config["channels"][string]> {
  console.log(step(stepNum, totalSteps, "Telegram Bot"));

  let botToken = "";

  while (true) {
    botToken = guardCancel(
      await clack.text({
        message: "Bot token (from @BotFather):",
        validate: (val) => (val ?? "").toString().trim().length > 0 ? undefined : "Token cannot be empty",
      }),
    ) as string;
    botToken = botToken.trim();

    const s = clack.spinner();
    s.start("Validating token...");
    const result = await validateBotToken(botToken);
    s.stop("Token validated");

    if (result.ok) {
      console.log(ok(`Connected to @${result.botUsername}`));
      break;
    }
    console.log(fail(result.error));
    const action = guardCancel(
      await clack.select({
        message: "What to do?",
        options: [
          { label: "Re-enter token", value: "retry" },
          { label: "Use as-is (skip validation)", value: "skip" },
        ],
      }),
    );
    if (action === "skip") break;
  }

  let chatId: number;

  while (true) {
    chatId = await detectChatId(botToken);

    // Validate bot can access this chat and it's a supergroup
    const chatResult = await validateChatId(botToken, chatId);
    if (!chatResult.ok) {
      console.log(fail(chatResult.error));
      console.log("");
      console.log(`  ${c.bold}How to fix:${c.reset}`);
      console.log(dim("  1. Make sure the bot is added to the group"));
      console.log(dim("  2. The group must be a Supergroup (Group Settings → convert)"));
      console.log(dim("  3. Send a message in the group after adding the bot"));
      console.log("");
      guardCancel(await clack.text({ message: "Press Enter to try again..." }));
      continue;
    }
    console.log(
      ok(
        `Group: ${c.bold}${chatResult.title}${c.reset}${c.green}${chatResult.isForum ? " (Topics enabled)" : ""}`,
      ),
    );

    // Check bot has admin privileges
    const adminResult = await validateBotAdmin(botToken, chatId);
    if (!adminResult.ok) {
      console.log(fail(adminResult.error));
      console.log("");
      console.log(`  ${c.bold}How to fix:${c.reset}`);
      console.log(dim("  1. Open the group in Telegram"));
      console.log(dim("  2. Go to Group Settings → Administrators"));
      console.log(dim("  3. Add the bot as an administrator"));
      console.log("");
      guardCancel(await clack.text({ message: "Press Enter to check again..." }));
      continue;
    }
    console.log(ok("Bot has admin privileges"));
    break;
  }

  return {
    enabled: true,
    botToken,
    chatId,
    notificationTopicId: null,
    assistantTopicId: null,
  };
}

// --- Discord validation ---

export async function validateDiscordToken(token: string): Promise<
  | { ok: true; username: string; id: string }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.status === 200) {
      const data = (await res.json()) as { username: string; id: string };
      return { ok: true, username: data.username, id: data.id };
    }
    if (res.status === 401) {
      return { ok: false, error: "Token rejected by Discord (401 Unauthorized)" };
    }
    return { ok: false, error: `Discord API returned ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function setupDiscord(): Promise<DiscordChannelConfig> {
  console.log('\n📱 Discord Setup\n');

  console.log(`  ${c.bold}Quick setup:${c.reset}`);
  console.log(dim('  1. Create app at https://discord.com/developers/applications'));
  console.log(dim('  2. Go to Bot → Reset Token → copy it'));
  console.log(dim('  3. Enable Message Content Intent (Bot → Privileged Intents)'));
  console.log(dim('  4. OAuth2 → URL Generator → scopes: bot + applications.commands'));
  console.log(dim('  5. Bot Permissions: Manage Channels, Send Messages, Manage Threads, Attach Files'));
  console.log(dim('  6. Open generated URL → invite bot to your server'));
  console.log('');
  console.log(dim(`  📖 Detailed guide: https://github.com/Open-ACP/OpenACP/blob/main/docs/guide/discord-setup.md`));
  console.log('');

  let botToken = '';

  while (true) {
    botToken = guardCancel(
      await clack.text({
        message: 'Bot token (from Discord Developer Portal):',
        validate: (val) => (val ?? "").toString().trim().length > 0 ? undefined : 'Token cannot be empty',
      }),
    ) as string;
    botToken = botToken.trim();

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

  const guildId = guardCancel(
    await clack.text({
      message: 'Guild (server) ID:',
      validate: (val) => {
        const trimmed = (val ?? "").toString().trim();
        if (!trimmed) return 'Guild ID cannot be empty';
        if (!/^\d{17,20}$/.test(trimmed)) return 'Guild ID must be a numeric Discord snowflake (17-20 digits)';
        return undefined;
      },
    }),
  ) as string;

  return {
    enabled: true,
    botToken,
    guildId: guildId.trim(),
    forumChannelId: null,
    notificationChannelId: null,
    assistantThreadId: null,
  };
}

export async function setupAgents(): Promise<{
  defaultAgent: string;
}> {
  const { AgentCatalog } = await import("./agent-catalog.js");
  const { muteLogger, unmuteLogger } = await import("./log.js");

  muteLogger();
  const catalog = new AgentCatalog();
  catalog.load();

  const s = clack.spinner();
  s.start("Checking available agents...");
  await catalog.refreshRegistryIfStale();

  // Claude is always pre-installed (bundled dependency)
  if (!catalog.getInstalledAgent("claude")) {
    const claudeRegistry = catalog.findRegistryAgent("claude-acp");
    if (claudeRegistry) {
      await catalog.install("claude-acp");
    } else {
      // Fallback: register bundled claude-agent-acp directly
      const { AgentStore } = await import("./agent-store.js");
      const store = new AgentStore();
      store.load();
      store.addAgent("claude", {
        registryId: "claude-acp",
        name: "Claude Agent",
        version: "bundled",
        distribution: "npx",
        command: "npx",
        args: ["@zed-industries/claude-agent-acp"],
        env: {},
        installedAt: new Date().toISOString(),
        binaryPath: null,
      });
    }
  }
  s.stop(ok("Claude Agent ready"));
  unmuteLogger();

  const available = catalog.getAvailable();
  const installed = available.filter((a) => a.installed);
  const installable = available.filter((a) => !a.installed && a.available);

  // Offer agent selection — show installed agents as pre-checked + installable agents
  if (installed.length > 0 || installable.length > 0) {
    // Deduplicate by key AND name
    const seen = new Set<string>();
    const options: Array<{ label: string; value: string }> = [];

    for (const a of installed) {
      const dedupeKey = `${a.key}::${a.name}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      options.push({
        label: `${a.name} (installed)`,
        value: a.key,
      });
    }
    for (const a of installable) {
      const dedupeKey = `${a.key}::${a.name}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      options.push({
        label: `${a.name} (${a.distribution})`,
        value: a.key,
      });
    }

    const installedKeys = installed.map(a => a.key);
    const selected = guardCancel(
      await clack.autocompleteMultiselect({
        message: "Install additional agents? (type to search, Space to select)",
        options,
        initialValues: installedKeys,
        required: false,
      }),
    ) as string[];

    for (const key of selected) {
      const regAgent = catalog.findRegistryAgent(key);
      if (regAgent) {
        const installSpinner = clack.spinner();
        installSpinner.start(`Installing ${regAgent.name}...`);
        muteLogger();
        const result = await catalog.install(key);
        unmuteLogger();
        if (result.ok) {
          installSpinner.stop(ok("done"));
        } else {
          installSpinner.stop(warn(`skipped: ${result.error}`));
        }
      }
    }
  }

  // Choose default agent
  const installedAgents = Object.keys(catalog.getInstalledEntries());
  let defaultAgent = "claude";

  if (installedAgents.length > 1) {
    defaultAgent = guardCancel(
      await clack.select({
        message: "Which agent should be the default?",
        options: installedAgents.map((key) => {
          const agent = catalog.getInstalledAgent(key)!;
          return { label: `${agent.name} (${key})`, value: key };
        }),
        initialValue: "claude",
      }),
    ) as string;
  }

  console.log(ok(`Default agent: ${c.bold}${defaultAgent}${c.reset}`));
  return { defaultAgent };
}

export async function setupWorkspace(stepNum = 2, totalSteps = 3): Promise<{ baseDir: string }> {
  console.log(step(stepNum, totalSteps, "Workspace"));

  const baseDir = guardCancel(
    await clack.text({
      message: "Base directory for workspaces:",
      initialValue: "~/openacp-workspace",
      validate: (val) => (val ?? "").toString().trim().length > 0 ? undefined : "Path cannot be empty",
    }),
  ) as string;

  return { baseDir: baseDir.trim().replace(/^['"]|['"]$/g, "") };
}

export async function setupRunMode(stepNum = 3, totalSteps = 3): Promise<{ runMode: 'foreground' | 'daemon'; autoStart: boolean }> {
  console.log(step(stepNum, totalSteps, 'Run Mode'))

  // Don't show daemon option on Windows
  if (process.platform === 'win32') {
    console.log(dim('  (Daemon mode not available on Windows)'))
    return { runMode: 'foreground', autoStart: false }
  }

  const mode = guardCancel(
    await clack.select({
      message: 'How would you like to run OpenACP?',
      options: [
        {
          label: 'Background (daemon)',
          value: 'daemon' as const,
          hint: 'Runs silently, auto-starts on boot. Manage with: openacp status | stop | logs',
        },
        {
          label: 'Foreground (terminal)',
          value: 'foreground' as const,
          hint: 'Runs in current terminal session. Start with: openacp',
        },
      ],
    }),
  );

  if (mode === 'daemon') {
    const { installAutoStart, isAutoStartSupported } = await import('./autostart.js')
    const autoStart = isAutoStartSupported()
    if (autoStart) {
      const result = installAutoStart(expandHome('~/.openacp/logs'))
      if (result.success) {
        console.log(ok('Auto-start on boot enabled'))
      } else {
        console.log(warn(`Auto-start failed: ${result.error}`))
      }
    }
    return { runMode: 'daemon', autoStart }
  }

  return { runMode: 'foreground', autoStart: false }
}

// --- Orchestrator ---

function applyGradient(text: string): string {
  const colors = [135, 99, 63, 33, 39, 44, 44];
  const lines = text.split("\n");
  return lines
    .map((line, i) => {
      const colorIdx = Math.min(i, colors.length - 1);
      return `\x1b[38;5;${colors[colorIdx]}m${line}\x1b[0m`;
    })
    .join("\n");
}

const BANNER = `
   ██████╗ ██████╗ ███████╗███╗   ██╗ █████╗  ██████╗██████╗
  ██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔══██╗██╔════╝██╔══██╗
  ██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████║██║     ██████╔╝
  ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██╔══██║██║     ██╔═══╝
  ╚██████╔╝██║     ███████╗██║ ╚████║██║  ██║╚██████╗██║
   ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝ ╚═════╝╚═╝
`;

/** Compact banner for normal startup (foreground mode) */
export async function printStartBanner(): Promise<void> {
  let version = "0.0.0";
  try {
    const { getCurrentVersion } = await import("../cli/version.js");
    version = getCurrentVersion();
  } catch {
    // ignore
  }
  console.log(applyGradient(BANNER));
  console.log(`${c.dim}              AI coding agents, anywhere.  v${version}${c.reset}\n`);
}

async function printWelcomeBanner(): Promise<void> {
  await printStartBanner();
}

export async function runSetup(configManager: ConfigManager, opts?: { skipRunMode?: boolean }): Promise<boolean> {
  await printWelcomeBanner();
  clack.intro("Let's set up OpenACP");

  try {
    const channelChoice = guardCancel(
      await clack.select({
        message: 'Which messaging platform do you want to use?',
        options: [
          { label: 'Telegram', value: 'telegram' },
          { label: 'Discord', value: 'discord' },
          { label: 'Both', value: 'both' },
        ],
      }),
    );

    let telegram: Config["channels"][string] | undefined;
    let discord: DiscordChannelConfig | undefined;

    // Calculate total steps dynamically: channel(s) + workspace + run mode
    const channelSteps = channelChoice === 'both' ? 2 : 1;
    const runModeSteps = opts?.skipRunMode ? 0 : 1;
    const totalSteps = channelSteps + 1 + runModeSteps; // + workspace + optional run mode

    let currentStep = 0;

    if (channelChoice === 'telegram' || channelChoice === 'both') {
      currentStep++;
      telegram = await setupTelegram(currentStep, totalSteps);
    }
    if (channelChoice === 'discord' || channelChoice === 'both') {
      currentStep++;
      discord = await setupDiscord();
    }

    const { defaultAgent } = await setupAgents();

    // Offer Claude CLI integration
    {
      const installClaude = guardCancel(
        await clack.confirm({
          message: "Install session transfer for Claude? (enables /openacp:handoff in your terminal)",
          initialValue: true,
        }),
      );

      if (installClaude) {
        try {
          const { getIntegration } = await import("../cli/integrate.js");
          const integration = getIntegration("claude");
          if (integration) {
            for (const item of integration.items) {
              const result = await item.install();
              for (const log of result.logs) console.log(`  ${log}`);
            }
          }
          console.log("Claude CLI integration installed.\n");
        } catch (err) {
          console.log(`Could not install Claude CLI integration: ${err instanceof Error ? err.message : err}`);
          console.log("  You can install it later with: openacp integrate claude\n");
        }
      }
    }

    currentStep++;
    const workspace = await setupWorkspace(currentStep, totalSteps);

    let runMode: 'foreground' | 'daemon' = 'foreground';
    let autoStart = false;
    if (!opts?.skipRunMode) {
      currentStep++;
      const result = await setupRunMode(currentStep, totalSteps);
      runMode = result.runMode;
      autoStart = result.autoStart;
    }

    const security = {
      allowedUserIds: [] as string[],
      maxConcurrentSessions: 20,
      sessionTimeoutMinutes: 60,
    };

    const channels: Config["channels"] = {};
    if (telegram) channels.telegram = telegram;
    // DiscordChannelConfig is structurally compatible with the base channel schema
    if (discord) channels.discord = discord as Config["channels"][string];

    const config: Config = {
      channels,
      agents: {},
      defaultAgent,
      workspace,
      security,
      logging: {
        level: "info",
        logDir: "~/.openacp/logs",
        maxFileSize: "10m",
        maxFiles: 7,
        sessionLogRetentionDays: 30,
      },
      runMode,
      autoStart,
      api: {
        port: 21420,
        host: '127.0.0.1',
      },
      sessionStore: { ttlDays: 30 },
      tunnel: {
        enabled: true,
        port: 3100,
        provider: "cloudflare",
        options: {},
        maxUserTunnels: 5,
        storeTtlMinutes: 60,
        auth: { enabled: false },
      },
      usage: {
        enabled: true,
        warningThreshold: 0.8,
        currency: "USD",
        retentionDays: 90,
      },
      integrations: {},
      speech: {
        stt: { provider: null, providers: {} },
        tts: { provider: null, providers: {} },
      },
    };

    try {
      await configManager.writeNew(config);
    } catch (writeErr) {
      console.log(
        fail(`Could not save config: ${(writeErr as Error).message}`),
      );
      return false;
    }

    clack.outro(`Config saved to ${configManager.getConfigPath()}`);

    if (!opts?.skipRunMode) {
      console.log(ok("Starting OpenACP..."));
      console.log("");
    }

    return true;
  } catch (err) {
    if ((err as Error).name === "ExitPromptError") {
      clack.cancel("Setup cancelled.");
      return false;
    }
    throw err;
  }
}
