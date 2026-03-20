#!/usr/bin/env node

import { ConfigManager } from './config.js'
import { OpenACPCore } from './core.js'
import { loadAdapterFactory } from './plugin-manager.js'
import { log } from './log.js'

let shuttingDown = false

export async function startServer() {
  // 1. Check config exists, run setup if not
  const configManager = new ConfigManager()
  const configExists = await configManager.exists()

  if (!configExists) {
    const { runSetup } = await import('./setup.js')
    const shouldStart = await runSetup(configManager)
    if (!shouldStart) process.exit(0)
  }

  // 2. Load config (validates with Zod)
  await configManager.load()
  const config = configManager.get()
  log.info('Config loaded from', configManager.getConfigPath())

  // 3. Create core
  const core = new OpenACPCore(configManager)

  // 4. Register adapters from config
  for (const [channelName, channelConfig] of Object.entries(config.channels)) {
    if (!channelConfig.enabled) continue

    if (channelName === 'telegram') {
      // Built-in adapter — loaded via getTelegramAdapter()
      const { getTelegramAdapter } = await import('./builtin-adapters.js')
      const TelegramAdapter = await getTelegramAdapter()
      core.registerAdapter('telegram', new TelegramAdapter(core, channelConfig))
      log.info('Telegram adapter registered (built-in)')
    } else if (channelConfig.adapter) {
      // Plugin adapter
      const factory = await loadAdapterFactory(channelConfig.adapter)
      if (factory) {
        const adapter = factory.createAdapter(core, channelConfig)
        core.registerAdapter(channelName, adapter)
        log.info(`${channelName} adapter registered (plugin: ${channelConfig.adapter})`)
      } else {
        log.error(`Skipping channel "${channelName}" — adapter "${channelConfig.adapter}" failed to load`)
      }
    } else {
      log.error(`Channel "${channelName}" has no built-in adapter. Set "adapter" field to a plugin package.`)
    }
  }

  if (core.adapters.size === 0) {
    log.error('No channels enabled. Enable at least one channel in config.')
    process.exit(1)
  }

  // 5. Start
  await core.start()

  // 6. Log ready
  const agents = Object.keys(config.agents).join(', ')
  log.info(`OpenACP started. Agents: ${agents}`)
  log.info('Press Ctrl+C to stop.')

  // 7. Graceful shutdown
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info(`${signal} received. Shutting down...`)

    try {
      await core.stop()
    } catch (err) {
      log.error('Error during shutdown:', err)
    }

    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception:', err)
  })

  process.on('unhandledRejection', (err) => {
    log.error('Unhandled rejection:', err)
  })
}

// Direct execution for dev (node packages/core/dist/main.js)
const isDirectExecution = process.argv[1]?.endsWith('main.js')
if (isDirectExecution) {
  startServer().catch((err) => {
    log.error('Fatal:', err)
    process.exit(1)
  })
}
