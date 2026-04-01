import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as clack from "@clack/prompts";
import type { Config, ConfigManager } from "../config/config.js";
import type { ChannelId } from "./types.js";
import type { OnboardSection } from "./types.js";
import { ONBOARD_SECTION_OPTIONS } from "./types.js";
import type { CommunityAdapterOption } from "./types.js";
import { guardCancel, ok, fail, printStartBanner, summarizeConfig } from "./helpers.js";
import { setupAgents } from "./setup-agents.js";
import { setupWorkspace } from "./setup-workspace.js";
import { setupRunMode } from "./setup-run-mode.js";
import { setupIntegrations } from "./setup-integrations.js";
import { configureChannels } from "./setup-channels.js";
import { RegistryClient } from "../plugin/registry-client.js";
import type { SettingsManager } from "../plugin/settings-manager.js";
import type { PluginRegistry } from "../plugin/plugin-registry.js";
import { InstanceRegistry } from "../instance/instance-registry.js";
import { generateSlug, getGlobalRoot } from "../instance/instance-context.js";
import { copyInstance } from "../instance/instance-copy.js";
import { protectLocalInstance } from "./git-protect.js";

// ─── Registry discovery ───

async function fetchCommunityAdapters(): Promise<CommunityAdapterOption[]> {
  try {
    const client = new RegistryClient()
    const registry = await client.getRegistry()
    return registry.plugins
      .filter(p => p.category === 'adapter' && p.verified)
      .map(p => ({
        name: p.npm,
        displayName: p.displayName ?? p.name,
        icon: p.icon,
        verified: p.verified,
      }))
  } catch {
    return []
  }
}

// ─── First-run setup ───

export async function runSetup(
  configManager: ConfigManager,
  opts?: {
    skipRunMode?: boolean
    settingsManager?: SettingsManager
    pluginRegistry?: PluginRegistry
    instanceName?: string
    from?: string       // path to copy from (parent dir, not .openacp)
    instanceRoot?: string  // the .openacp dir being set up
  },
): Promise<boolean> {
  await printStartBanner();
  clack.intro("Let's set up OpenACP");

  const { settingsManager, pluginRegistry } = opts ?? {};

  try {
    if (!settingsManager || !pluginRegistry) {
      console.log(fail('Plugin system not initialized. Cannot set up channels.'));
      return false;
    }

    // ─── Instance name prompt ───

    const instanceRoot = opts?.instanceRoot ?? getGlobalRoot();
    const isGlobal = instanceRoot === getGlobalRoot();

    let instanceName = opts?.instanceName;
    if (!instanceName) {
      const defaultName = isGlobal ? 'Global workspace' : path.basename(path.dirname(instanceRoot));
      const locationHint = isGlobal ? 'global (~/.openacp)' : `local (${instanceRoot.replace(/\/.openacp$/, '').replace(os.homedir(), '~')})`;
      const nameResult = await clack.text({
        message: `Name for this workspace (${locationHint})`,
        initialValue: defaultName,
        validate: (v) => (!v?.trim() ? 'Name cannot be empty' : undefined),
      });
      if (clack.isCancel(nameResult)) return false;
      instanceName = nameResult.trim();
    }

    // ─── Copy-from flow ───

    const globalRoot = getGlobalRoot();
    const registryPath = path.join(globalRoot, 'instances.json');
    const instanceRegistry = new InstanceRegistry(registryPath);
    await instanceRegistry.load();

    let didCopy = false;

    // Check --from flag first
    if (opts?.from) {
      const fromRoot = path.join(opts.from, '.openacp');
      if (fs.existsSync(path.join(fromRoot, 'config.json'))) {
        const inheritableMap = buildInheritableKeysMap();
        await copyInstance(fromRoot, instanceRoot, { inheritableKeys: inheritableMap });
        didCopy = true;
      } else {
        console.error(`No OpenACP setup found at ${fromRoot}`);
        return false;
      }
    }

    // If no --from, check if we can offer to copy interactively
    if (!didCopy) {
      const existingInstances = instanceRegistry.list().filter(e =>
        fs.existsSync(path.join(e.root, 'config.json')) && e.root !== instanceRoot
      );

      if (existingInstances.length > 0) {
        // Build display label for the single-instance case
        let singleLabel: string | undefined;
        if (existingInstances.length === 1) {
          const e = existingInstances[0]!;
          let name = e.id;
          try {
            const cfg = JSON.parse(fs.readFileSync(path.join(e.root, 'config.json'), 'utf-8'));
            if (cfg.instanceName) name = cfg.instanceName;
          } catch {}
          const isGlobalEntry = e.root === getGlobalRoot();
          const displayPath = e.root.replace(os.homedir(), '~');
          const type = isGlobalEntry ? 'global' : 'local';
          singleLabel = `${name} workspace (${type} — ${displayPath})`;
        }

        const confirmMsg = singleLabel
          ? `Copy config from ${singleLabel}?`
          : 'Copy config from an existing workspace?';

        const shouldCopy = await clack.confirm({
          message: confirmMsg,
          initialValue: true,
        });

        if (clack.isCancel(shouldCopy)) return false;

        if (shouldCopy === true) {
          let sourceRoot: string;
          if (existingInstances.length === 1) {
            sourceRoot = existingInstances[0]!.root;
          } else {
            const choice = await clack.select({
              message: 'Which workspace to copy from?',
              options: existingInstances.map(e => {
                let name = e.id;
                try {
                  const cfg = JSON.parse(fs.readFileSync(path.join(e.root, 'config.json'), 'utf-8'));
                  if (cfg.instanceName) name = cfg.instanceName;
                } catch {}
                const isGlobalEntry = e.root === getGlobalRoot();
                const displayPath = e.root.replace(os.homedir(), '~');
                const type = isGlobalEntry ? 'global' : 'local';
                return { value: e.root, label: `${name} workspace (${type} — ${displayPath})` };
              }),
            });
            if (clack.isCancel(choice)) return false;
            sourceRoot = choice;
          }

          const inheritableMap = buildInheritableKeysMap();
          await copyInstance(sourceRoot, instanceRoot, {
            inheritableKeys: inheritableMap,
            onProgress: (step, status) => {
              if (status === 'done') console.log(`  ✓ ${step}`);
            },
          });
          didCopy = true;
        }
      }
    }

    // If copied, reload config so the wizard sees existing values
    if (didCopy && await configManager.exists()) {
      await configManager.load();
    }

    const communityAdapters = await fetchCommunityAdapters()

    const builtInOptions = [
      { label: 'Telegram', value: 'telegram' },
    ]

    const officialAdapters = [
      { label: 'Discord', value: 'official:@openacp/discord-adapter' },
      { label: 'Slack', value: 'official:@openacp/slack-adapter' },
    ]

    const communityOptions = communityAdapters.map(a => ({
      label: `${a.icon} ${a.displayName}${a.verified ? ' (verified)' : ''}`,
      value: `community:${a.name}`,
    }))

    // Ask user which channels to set up
    const channelChoices = guardCancel(
      await clack.multiselect({
        message: 'Which channels do you want to set up?',
        options: [
          ...builtInOptions.map(o => ({ value: o.value, label: o.label, hint: 'built-in' })),
          ...officialAdapters.map(o => ({ value: o.value, label: o.label, hint: 'official' })),
          ...(communityOptions.length > 0
            ? communityOptions.map(o => ({ value: o.value, label: o.label, hint: 'from plugin registry' }))
            : []),
        ],
        required: true,
        initialValues: ['telegram' as const],
      }),
    ) as string[];

    // Calculate total steps dynamically: channel(s) + workspace + run mode
    const channelSteps = channelChoices.length;
    const runModeSteps = opts?.skipRunMode ? 0 : 1;
    const totalSteps = channelSteps + 1 + runModeSteps; // + workspace + optional run mode

    let currentStep = 0;

    const { createInstallContext } = await import('../plugin/install-context.js');

    for (const channelId of channelChoices) {
      currentStep++;

      if (channelId === 'telegram') {
        const telegramPlugin = (await import('../../plugins/telegram/index.js')).default;
        const ctx = createInstallContext({
          pluginName: telegramPlugin.name,
          settingsManager,
          basePath: settingsManager.getBasePath(),
        });
        await telegramPlugin.install!(ctx);
        pluginRegistry.register(telegramPlugin.name, {
          version: telegramPlugin.version,
          source: 'builtin',
          enabled: true,
          settingsPath: settingsManager.getSettingsPath(telegramPlugin.name),
          description: telegramPlugin.description,
        });
      }


      // Handle official adapter selections (Discord, Slack, etc.)
      if (channelId.startsWith('official:')) {
        const npmPackage = channelId.slice('official:'.length);
        const { execFileSync } = await import('node:child_process');
        const pluginsDir = path.join(instanceRoot, 'plugins');
        const nodeModulesDir = path.join(pluginsDir, 'node_modules');

        // Install from npm if not already present
        const installedPath = path.join(nodeModulesDir, npmPackage);
        if (!fs.existsSync(installedPath)) {
          try {
            clack.log.step(`Installing ${npmPackage}...`);
            execFileSync('npm', ['install', npmPackage, '--prefix', pluginsDir, '--save'], {
              stdio: 'inherit',
              timeout: 60000,
            });
          } catch {
            console.log(fail(`Failed to install ${npmPackage}.`));
            continue;
          }
        }

        // Load and run install hook
        try {
          const installedPkgPath = path.join(nodeModulesDir, npmPackage, 'package.json');
          const installedPkg = JSON.parse(fs.readFileSync(installedPkgPath, 'utf-8'));
          const pluginModule = await import(path.join(nodeModulesDir, npmPackage, installedPkg.main ?? 'dist/index.js'));
          const plugin = pluginModule.default;

          if (plugin?.install) {
            const installCtx = createInstallContext({
              pluginName: plugin.name ?? npmPackage,
              settingsManager,
              basePath: settingsManager.getBasePath(),
            });
            await plugin.install(installCtx);
          }

          pluginRegistry.register(plugin?.name ?? npmPackage, {
            version: installedPkg.version,
            source: 'npm',
            enabled: true,
            settingsPath: settingsManager.getSettingsPath(plugin?.name ?? npmPackage),
            description: plugin?.description ?? installedPkg.description,
          });
        } catch (err) {
          console.log(fail(`Failed to load ${npmPackage}: ${(err as Error).message}`));
          pluginRegistry.register(npmPackage, {
            version: 'unknown',
            source: 'npm',
            enabled: false,
            settingsPath: settingsManager.getSettingsPath(npmPackage),
          });
        }
      }

      // Handle community plugin selections
      if (channelId.startsWith('community:')) {
        const npmPackage = channelId.slice('community:'.length);
        const { execFileSync } = await import('node:child_process');
        const pluginsDir = path.join(instanceRoot, 'plugins');
        const nodeModulesDir = path.join(pluginsDir, 'node_modules');

        // Install from npm
        try {
          execFileSync('npm', ['install', npmPackage, '--prefix', pluginsDir, '--save'], {
            stdio: 'inherit',
            timeout: 60000,
          });
        } catch {
          console.log(fail(`Failed to install ${npmPackage}.`));
          return false;
        }

        // Load and run install hook
        try {
          const { readFileSync } = await import('node:fs');
          const installedPkgPath = path.join(nodeModulesDir, npmPackage, 'package.json');
          const installedPkg = JSON.parse(readFileSync(installedPkgPath, 'utf-8'));
          const pluginModule = await import(path.join(nodeModulesDir, npmPackage, installedPkg.main ?? 'dist/index.js'));
          const plugin = pluginModule.default;

          if (plugin?.install) {
            const installCtx = createInstallContext({
              pluginName: plugin.name ?? npmPackage,
              settingsManager,
              basePath: settingsManager.getBasePath(),
            });
            await plugin.install(installCtx);
          }

          pluginRegistry.register(plugin?.name ?? npmPackage, {
            version: installedPkg.version,
            source: 'npm',
            enabled: true,
            settingsPath: settingsManager.getSettingsPath(plugin?.name ?? npmPackage),
            description: plugin?.description ?? installedPkg.description,
          });
        } catch (err) {
          // Plugin installed via npm but failed to load — register as disabled
          console.log(fail(`Failed to load ${npmPackage}: ${(err as Error).message}`));
          pluginRegistry.register(npmPackage, {
            version: 'unknown',
            source: 'npm',
            enabled: false,
            settingsPath: settingsManager.getSettingsPath(npmPackage),
          });
        }
      }
    }

    // Persist any community plugin registrations from the loop above
    await pluginRegistry.save();

    const { defaultAgent } = await setupAgents();

    // Offer Claude CLI integration
    await setupIntegrations();

    currentStep++;
    const workspace = await setupWorkspace({ stepNum: currentStep, totalSteps, isGlobal });

    let runMode: 'foreground' | 'daemon' = 'foreground';
    let autoStart = false;
    if (!opts?.skipRunMode) {
      currentStep++;
      const result = await setupRunMode({ stepNum: currentStep, totalSteps, instanceRoot });
      runMode = result.runMode;
      autoStart = result.autoStart;
    }

    const security = {
      allowedUserIds: [] as string[],
      maxConcurrentSessions: 20,
      sessionTimeoutMinutes: 60,
    };

    const config: Config = {
      instanceName,
      channels: {},
      agents: {},
      defaultAgent,
      workspace,
      security,
      logging: {
        level: "info",
        logDir: path.join(instanceRoot, "logs"),
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
      agentSwitch: { labelHistory: true },
    };

    try {
      await configManager.writeNew(config);
    } catch (writeErr) {
      console.log(
        fail(`Could not save config: ${(writeErr as Error).message}`),
      );
      return false;
    }

    // Auto-register remaining built-in plugins in the registry
    if (settingsManager && pluginRegistry) {
      await registerBuiltinPlugins(settingsManager, pluginRegistry);
      await pluginRegistry.save();
    }

    // Register instance in the global registry (skip if this root is already registered)
    const existingEntry = instanceRegistry.getByRoot(instanceRoot);
    if (!existingEntry) {
      const id = instanceRegistry.uniqueId(generateSlug(instanceName));
      instanceRegistry.register(id, instanceRoot);
      await instanceRegistry.save();
    }

    // For local instances: protect secrets from git and document in CLAUDE.md
    const isLocal = instanceRoot !== path.join(getGlobalRoot());
    if (isLocal) {
      const projectDir = path.dirname(instanceRoot) // .openacp parent = project dir
      protectLocalInstance(projectDir)
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

/**
 * Register all built-in plugins that haven't been registered yet.
 * Called after first-run setup to populate the registry with defaults.
 */
async function registerBuiltinPlugins(
  settingsManager: SettingsManager,
  pluginRegistry: PluginRegistry,
): Promise<void> {
  const builtinPlugins = [
    { name: '@openacp/security', version: '1.0.0', description: 'User access control and session limits' },
    { name: '@openacp/file-service', version: '1.0.0', description: 'File storage and management' },
    { name: '@openacp/context', version: '1.0.0', description: 'Conversation context management' },
    { name: '@openacp/speech', version: '1.0.0', description: 'Text-to-speech and speech-to-text' },
    { name: '@openacp/notifications', version: '1.0.0', description: 'Cross-session notification routing' },
    { name: '@openacp/tunnel', version: '1.0.0', description: 'Expose local services via tunnel' },
    { name: '@openacp/api-server', version: '1.0.0', description: 'REST API + SSE streaming server' },
  ];

  for (const p of builtinPlugins) {
    if (!pluginRegistry.get(p.name)) {
      pluginRegistry.register(p.name, {
        version: p.version,
        source: 'builtin',
        enabled: true,
        settingsPath: settingsManager.getSettingsPath(p.name),
        description: p.description,
      });
    }
  }
}

// ─── Inheritable keys for copy flow ───

function buildInheritableKeysMap(): Record<string, string[]> {
  // Hardcoded for built-in plugins — community plugins declare their own
  return {
    '@openacp/tunnel': ['provider', 'maxUserTunnels', 'auth'],
    '@openacp/api-server': ['host'],
    '@openacp/security': ['allowedUsers', 'maxSessionsPerUser', 'rateLimits'],
    '@openacp/usage': ['budget'],
    '@openacp/speech': ['tts'],
  };
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
