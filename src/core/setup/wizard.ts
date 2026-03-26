import * as clack from "@clack/prompts";
import type { Config, ConfigManager } from "../config.js";
import type { OnboardSection } from "./types.js";
import { ONBOARD_SECTION_OPTIONS } from "./types.js";
import { guardCancel, ok, fail, printStartBanner, summarizeConfig } from "./helpers.js";
import { setupTelegram } from "./setup-telegram.js";
import { setupDiscord } from "./setup-discord.js";
import { setupAgents } from "./setup-agents.js";
import { setupWorkspace } from "./setup-workspace.js";
import { setupRunMode } from "./setup-run-mode.js";
import { setupIntegrations } from "./setup-integrations.js";
import { configureChannels } from "./setup-channels.js";
import type { DiscordChannelConfig } from "../../adapters/discord/types.js";

// ─── First-run setup (unchanged flow) ───

export async function runSetup(
  configManager: ConfigManager,
  opts?: { skipRunMode?: boolean },
): Promise<boolean> {
  await printStartBanner();
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
      telegram = await setupTelegram({ stepNum: currentStep, totalSteps });
    }
    if (channelChoice === 'discord' || channelChoice === 'both') {
      currentStep++;
      discord = await setupDiscord();
    }

    const { defaultAgent } = await setupAgents();

    // Offer Claude CLI integration
    await setupIntegrations();

    currentStep++;
    const workspace = await setupWorkspace({ stepNum: currentStep, totalSteps });

    let runMode: 'foreground' | 'daemon' = 'foreground';
    let autoStart = false;
    if (!opts?.skipRunMode) {
      currentStep++;
      const result = await setupRunMode({ stepNum: currentStep, totalSteps });
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

// ─── Reconfigure (section-based, for existing config) ───

type ReconfigureSection = OnboardSection | "__continue";

async function selectSection(hasSelection: boolean): Promise<ReconfigureSection> {
  return guardCancel(
    await clack.select({
      message: "Select sections to configure",
      options: [
        ...ONBOARD_SECTION_OPTIONS,
        {
          value: "__continue" as const,
          label: "Continue",
          hint: hasSelection ? "Done" : "Skip for now",
        },
      ],
      initialValue: ONBOARD_SECTION_OPTIONS[0].value,
    }),
  ) as ReconfigureSection;
}

export async function runReconfigure(configManager: ConfigManager): Promise<void> {
  await printStartBanner();
  clack.intro("OpenACP — Reconfigure");

  try {
    await configManager.load();
    let config = configManager.get();

    // Show current config summary
    clack.note(summarizeConfig(config), "Current configuration");

    let ranSection = false;

    while (true) {
      const choice = await selectSection(ranSection);
      if (choice === "__continue") break;
      ranSection = true;

      if (choice === "channels") {
        const result = await configureChannels(config);
        if (result.changed) {
          // IMPORTANT: Use writeNew() instead of save() because save() uses deepMerge
          // which cannot delete keys. Channel deletion (delete next.channels.telegram)
          // would be silently ignored by deepMerge. writeNew() overwrites the full config.
          config = { ...config, channels: result.config.channels };
          await configManager.writeNew(config);
        }
      }

      if (choice === "agents") {
        const { defaultAgent } = await setupAgents();
        await configManager.save({ defaultAgent });
        config = configManager.get();
      }

      if (choice === "workspace") {
        const { baseDir } = await setupWorkspace({
          existing: config.workspace.baseDir,
        });
        await configManager.save({ workspace: { baseDir } });
        config = configManager.get();
      }

      if (choice === "runMode") {
        const result = await setupRunMode({
          existing: { runMode: config.runMode, autoStart: config.autoStart },
        });
        await configManager.save({
          runMode: result.runMode,
          autoStart: result.autoStart,
        });
        config = configManager.get();
      }

      if (choice === "integrations") {
        await setupIntegrations(config);
      }
    }

    if (!ranSection) {
      clack.outro("No changes made.");
      return;
    }

    clack.outro(`Config saved to ${configManager.getConfigPath()}`);
  } catch (err) {
    if ((err as Error).name === "ExitPromptError") {
      clack.cancel("Setup cancelled.");
      return;
    }
    throw err;
  }
}
