#!/usr/bin/env node

import { ConfigManager } from './core/config/config.js'
import { OpenACPCore } from './core/core.js'
import { loadAdapterFactory } from './core/plugin-manager.js'
import { initLogger, shutdownLogger, cleanupOldSessionLogs, log, muteLogger, unmuteLogger } from './core/utils/log.js'
import { TelegramAdapter } from './plugins/telegram/adapter.js'
import type { TelegramChannelConfig } from './plugins/telegram/types.js'
import { ApiServer } from './plugins/api-server/api-server.js'
import { TopicManager } from './plugins/telegram/topic-manager.js'
import { corePlugins } from './plugins/core-plugins.js'
import { SettingsManager } from './core/plugin/settings-manager.js'
import { PluginRegistry } from './core/plugin/plugin-registry.js'
import path from 'node:path'
import os from 'node:os'

export const RESTART_EXIT_CODE = 75
let shuttingDown = false

const OPENACP_DIR = path.join(os.homedir(), '.openacp')
const PLUGINS_DATA_DIR = path.join(OPENACP_DIR, 'plugins', 'data')
const REGISTRY_PATH = path.join(OPENACP_DIR, 'plugins.json')

export async function startServer() {
  // 0. If running as daemon child, check state and write PID file
  if (process.argv.includes('--daemon-child')) {
    const { writePidFile, readPidFile, getPidPath, shouldAutoStart } = await import('./cli/daemon.js')

    // Only auto-start if the daemon was previously running (user started it)
    if (!shouldAutoStart()) {
      process.exit(0)
    }

    const pidPath = getPidPath()
    const existingPid = readPidFile(pidPath)
    if (existingPid !== null && existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0)
        console.error(`Another OpenACP instance is already running (PID ${existingPid}). Exiting.`)
        process.exit(1)
      } catch {
        // Stale PID file — safe to overwrite
      }
    }
    writePidFile(pidPath, process.pid)
  }

  // Create SettingsManager and PluginRegistry early (needed by wizard + boot)
  const settingsManager = new SettingsManager(PLUGINS_DATA_DIR)
  const pluginRegistry = new PluginRegistry(REGISTRY_PATH)
  await pluginRegistry.load()

  // 1. Check config exists, run setup if not
  const configManager = new ConfigManager()
  const configExists = await configManager.exists()

  if (!configExists) {
    const { runSetup } = await import('./core/setup/index.js')
    const shouldStart = await runSetup(configManager, { settingsManager, pluginRegistry })
    if (!shouldStart) process.exit(0)
  }

  // 2. Load config (validates with Zod)
  await configManager.load()
  const config = configManager.get()
  initLogger(config.logging)
  log.debug({ configPath: configManager.getConfigPath() }, 'Config loaded')

  // First boot: auto-register built-in plugins if registry is empty
  if (pluginRegistry.list().size === 0) {
    await autoRegisterBuiltinPlugins(settingsManager, pluginRegistry, configManager)
  }

  // Show banner in foreground TTY mode (not daemon, not piped)
  const isForegroundTTY = !!(process.stdout.isTTY && !process.env.NO_COLOR && config.runMode !== 'daemon')
  if (isForegroundTTY) {
    const { printStartBanner } = await import('./core/setup/index.js')
    await printStartBanner()
  }

  // Mute pino during startup, show spinner instead
  let spinner: ReturnType<typeof import('ora').default> | undefined
  if (isForegroundTTY) {
    muteLogger()
    const ora = (await import('ora')).default
    spinner = ora({ text: 'Starting OpenACP...', spinner: 'dots' }).start()
  }

  // Post-upgrade dependency check (blocking — must complete before server start)
  try {
    const { runPostUpgradeChecks } = await import('./cli/post-upgrade.js')
    await runPostUpgradeChecks(config)
  } catch (err) {
    log.warn({ err }, 'Post-upgrade check failed')
  }

  // Async cleanup of old session logs (non-blocking)
  cleanupOldSessionLogs(config.logging.sessionLogRetentionDays).catch(err =>
    log.warn({ err }, 'Session log cleanup failed')
  )

  // 3. Create core
  const core = new OpenACPCore(configManager)

  // 3.5 Start tunnel if configured
  let tunnelService: import('./plugins/tunnel/tunnel-service.js').TunnelService | undefined
  if (config.tunnel.enabled) {
    const { TunnelService } = await import('./plugins/tunnel/tunnel-service.js')
    tunnelService = new TunnelService(config.tunnel)
    const publicUrl = await tunnelService.start()
    core.tunnelService = tunnelService
    log.info({ publicUrl }, 'Tunnel started')
  }

  // 4. Register adapters from config
  for (const [channelName, channelConfig] of Object.entries(config.channels)) {
    if (!channelConfig.enabled) continue

    if (channelName === 'telegram') {
      core.registerAdapter('telegram', new TelegramAdapter(core, channelConfig as TelegramChannelConfig))
      log.info({ adapter: 'telegram' }, 'Adapter registered')
    } else if (channelName === 'slack') {
      const { SlackAdapter } = await import('./plugins/slack/adapter.js')
      const slackConfig = channelConfig as import('./plugins/slack/types.js').SlackChannelConfig
      core.registerAdapter('slack', new SlackAdapter(core, slackConfig))
      log.info({ adapter: 'slack' }, 'Adapter registered')
    } else if (channelName === 'discord') {
      const { DiscordAdapter } = await import('./plugins/discord/adapter.js')
      const discordConfig = channelConfig as import('./plugins/discord/types.js').DiscordChannelConfig
      core.registerAdapter('discord', new DiscordAdapter(core, discordConfig))
      log.info({ adapter: 'discord' }, 'Adapter registered')
    } else if (channelConfig.adapter) {
      // Plugin adapter
      const factory = await loadAdapterFactory(channelConfig.adapter)
      if (factory) {
        const adapter = factory.createAdapter(core, channelConfig)
        core.registerAdapter(channelName, adapter)
        log.info({ adapter: channelName, plugin: channelConfig.adapter }, 'Adapter registered')
      } else {
        const name = channelName
        const err = channelConfig.adapter
        log.error({ adapter: name, err }, 'Failed to load adapter')
      }
    } else {
      log.error({ adapter: channelName }, 'Channel has no built-in adapter; set "adapter" field to a plugin package')
    }
  }

  if (core.adapters.size === 0) {
    log.error('No channels enabled. Enable at least one channel in config.')
    process.exit(1)
  }

  // 4.5 Boot community plugins (if any)
  try {
    // Emit kernel:booted before plugin boot
    core.eventBus.emit('kernel:booted')

    // Pass settingsManager and pluginRegistry to LifecycleManager
    // (LifecycleManager already accepts these in its constructor opts,
    //  but core creates it without them — patch them in before boot)
    ;(core.lifecycleManager as any).settingsManager = settingsManager
    ;(core.lifecycleManager as any).pluginRegistry = pluginRegistry

    // Boot core built-in plugins (security, file-service, context, usage, speech, notifications)
    // plus any community plugins discovered from ~/.openacp/plugins/
    await core.lifecycleManager.boot(corePlugins)

    // Collect registered commands and emit system:commands-ready
    const commands = core.lifecycleManager.serviceRegistry.get<import('./core/plugin/types.js').CommandDef[]>('registered-commands') ?? []
    core.eventBus.emit('system:commands-ready', { commands })

    core.eventBus.emit('system:ready')
  } catch (err) {
    log.error({ err }, 'Plugin boot failed')
  }

  // 5. Start
  let apiServer: ApiServer | undefined

  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info({ signal, exitCode }, 'Signal received, shutting down')

    try {
      if (apiServer) await apiServer.stop()
      await core.stop()
      if (tunnelService) await tunnelService.stop()
    } catch (err) {
      log.error({ err }, 'Error during shutdown')
    }

    const isDaemon = process.argv.includes('--daemon-child')

    // Clean up PID file if running as daemon
    if (isDaemon) {
      const { removePidFile, getPidPath } = await import('./cli/daemon.js')
      removePidFile(getPidPath())
    }

    // Self-respawn on restart
    if (exitCode === RESTART_EXIT_CODE) {
      if (isDaemon) {
        // Daemon mode: spawn detached child writing to log file
        const { spawn: spawnChild } = await import('node:child_process')
        const { expandHome } = await import('./core/config/config.js')
        const fs = await import('node:fs')
        const pathMod = await import('node:path')

        const cliPath = pathMod.resolve(process.argv[1])
        const resolvedLogDir = expandHome(config.logging.logDir)
        fs.mkdirSync(resolvedLogDir, { recursive: true })
        const logFile = pathMod.join(resolvedLogDir, 'openacp.log')
        const out = fs.openSync(logFile, 'a')
        const err = fs.openSync(logFile, 'a')

        const child = spawnChild(process.execPath, [cliPath, '--daemon-child'], {
          detached: true,
          stdio: ['ignore', out, err],
          env: { ...process.env, OPENACP_SKIP_UPDATE_CHECK: '1' },
        })
        fs.closeSync(out)
        fs.closeSync(err)
        child.unref()
        log.info({ newPid: child.pid }, 'Respawned daemon for restart')
      } else if (!process.env.OPENACP_DEV_LOOP) {
        // Foreground production mode: spawn replacement process with inherited stdio
        const { spawn: spawnChild } = await import('node:child_process')
        const child = spawnChild(process.execPath, process.argv.slice(1), {
          stdio: 'inherit',
          env: { ...process.env, OPENACP_SKIP_UPDATE_CHECK: '1' },
        })
        await shutdownLogger()
        child.on('exit', (code) => process.exit(code ?? 0))
        return
      }
    }

    await shutdownLogger()
    process.exit(exitCode)
  }

  // Expose restart trigger for adapters (e.g. /restart command)
  core.requestRestart = () => shutdown('restart', RESTART_EXIT_CODE)

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  process.on('uncaughtException', (err) => {
    log.error({ err }, 'Uncaught exception')
  })

  process.on('unhandledRejection', (err) => {
    log.error({ err }, 'Unhandled rejection')
  })

  await core.start()

  const updatedConfig = core.configManager.get()
  const telegramAdapter = core.adapters.get('telegram') ?? null
  let topicManager: TopicManager | undefined
  if (telegramAdapter) {
    const telegramCfg = updatedConfig.channels?.telegram as TelegramChannelConfig | undefined
    topicManager = new TopicManager(
      core.sessionManager,
      telegramAdapter,
      {
        notificationTopicId: telegramCfg?.notificationTopicId ?? null,
        assistantTopicId: telegramCfg?.assistantTopicId ?? null,
      },
    )
  }

  apiServer = new ApiServer(core, config.api, undefined, topicManager)
  await apiServer.start()

  // 6. Log ready
  if (isForegroundTTY) {
    if (spinner) spinner.stop()
    const ok = (msg: string) => console.log(`\x1b[32m✓\x1b[0m ${msg}`)
    ok('Config loaded')
    ok('Dependencies checked')
    if (tunnelService) ok(`Tunnel ready → ${tunnelService.getPublicUrl()}`)
    for (const [name] of core.adapters) ok(`${name.charAt(0).toUpperCase() + name.slice(1)} connected`)
    if (apiServer) ok(`API server on port ${config.api.port}`)
    console.log(`\nOpenACP is running. Press Ctrl+C to stop.\n`)
    unmuteLogger()
  }
  log.debug({ agents: Object.keys(config.agents) }, 'OpenACP started')
}

/**
 * Auto-register all built-in plugins when the registry is empty (first boot with new plugin system,
 * or upgrade from legacy config). Also runs legacy config migration for each plugin.
 */
async function autoRegisterBuiltinPlugins(
  settingsManager: SettingsManager,
  pluginRegistry: PluginRegistry,
  configManager: ConfigManager,
): Promise<void> {
  const allPlugins = [
    { name: '@openacp/security', version: '1.0.0', description: 'User access control and session limits' },
    { name: '@openacp/file-service', version: '1.0.0', description: 'File storage and management' },
    { name: '@openacp/context', version: '1.0.0', description: 'Conversation context management' },
    { name: '@openacp/usage', version: '1.0.0', description: 'Token usage tracking and budget enforcement' },
    { name: '@openacp/speech', version: '1.0.0', description: 'Text-to-speech and speech-to-text' },
    { name: '@openacp/notifications', version: '1.0.0', description: 'Cross-session notification routing' },
    { name: '@openacp/tunnel', version: '1.0.0', description: 'Expose local services via tunnel' },
    { name: '@openacp/api-server', version: '1.0.0', description: 'REST API + SSE streaming server' },
    { name: '@openacp/telegram', version: '1.0.0', description: 'Telegram adapter with forum topics' },
    { name: '@openacp/discord', version: '1.0.0', description: 'Discord adapter with forum threads' },
    { name: '@openacp/slack', version: '1.0.0', description: 'Slack adapter with channels and threads' },
  ]

  // Try to read legacy config for migration
  let legacyConfig: Record<string, unknown> | undefined
  try {
    const cfg = configManager.get()
    if (cfg && typeof cfg === 'object') {
      legacyConfig = cfg as unknown as Record<string, unknown>
    }
  } catch {
    // No config loaded yet — skip migration
  }

  // Run legacy migration for each plugin silently
  if (legacyConfig) {
    const pluginModules = await Promise.allSettled([
      import('./plugins/security/index.js'),
      import('./plugins/file-service/index.js'),
      import('./plugins/context/index.js'),
      import('./plugins/usage/index.js'),
      import('./plugins/speech/index.js'),
      import('./plugins/notifications/index.js'),
      import('./plugins/tunnel/index.js'),
      import('./plugins/api-server/index.js'),
      import('./plugins/telegram/index.js'),
      import('./plugins/discord/index.js'),
      import('./plugins/slack/index.js'),
    ])

    for (const result of pluginModules) {
      if (result.status !== 'fulfilled') continue
      const plugin = result.value.default
      if (plugin?.install) {
        try {
          // Check if settings already exist
          const existing = await settingsManager.loadSettings(plugin.name)
          if (Object.keys(existing).length > 0) continue

          // Create a silent install context for migration only
          const { createInstallContext } = await import('./core/plugin/install-context.js')
          const ctx = createInstallContext({
            pluginName: plugin.name,
            settingsManager,
            basePath: PLUGINS_DATA_DIR,
            legacyConfig,
          })
          // Override terminal to be silent
          ctx.terminal = createSilentTerminal()
          await plugin.install(ctx)
        } catch {
          // Silently skip — migration is best-effort
        }
      }
    }
  }

  for (const p of allPlugins) {
    pluginRegistry.register(p.name, {
      version: p.version,
      source: 'builtin',
      enabled: true,
      settingsPath: settingsManager.getSettingsPath(p.name),
      description: p.description,
    })
  }
  await pluginRegistry.save()
  log.info('Built-in plugins registered in plugin registry')
}

/**
 * Create a no-op terminal for silent migration (no user interaction).
 */
function createSilentTerminal(): import('./core/plugin/types.js').TerminalIO {
  const noop = () => {}
  return {
    text: async () => '',
    select: async () => '' as any,
    confirm: async () => false,
    password: async () => '',
    multiselect: async () => [],
    log: { info: noop, success: noop, warning: noop, error: noop, step: noop },
    spinner: () => ({ start: noop, stop: noop, fail: noop }),
    note: noop,
    cancel: noop,
  }
}

// Direct execution for dev (node dist/main.js)
const isDirectExecution = process.argv[1]?.endsWith('main.js')
if (isDirectExecution) {
  startServer().catch((err) => {
    log.error({ err }, 'Fatal error')
    process.exit(1)
  })
}
