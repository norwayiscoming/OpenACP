import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import type { OpenACPCore } from '../../core/core.js'
import type { TelegramChannelConfig } from './types.js'

/**
 * Factory for the Telegram plugin.
 *
 * The plugin is `essential: true` — OpenACP won't start without it. Its `setup()`
 * hook constructs a `TelegramAdapter` and registers it as `adapter:telegram` in
 * the service registry so other plugins can reference it.
 *
 * On first run, topic IDs are null. `TelegramAdapter.start()` creates the system
 * topics and persists their IDs back to plugin settings via the `saveTopicIds` callback.
 * On subsequent runs, the persisted IDs are read from plugin settings in `setup()`.
 */
function createTelegramPlugin(): OpenACPPlugin {
  let adapter: { stop(): Promise<void> } | null = null

  return {
    name: '@openacp/telegram',
    version: '1.0.0',
    description: 'Telegram adapter with Topics support',
    essential: true,
    pluginDependencies: {
      '@openacp/security': '^1.0.0',
      '@openacp/notifications': '^1.0.0',
    },
    optionalPluginDependencies: {
      '@openacp/speech': '^1.0.0',
    },
    permissions: ['services:register', 'kernel:access', 'events:read', 'commands:register'],
    inheritableKeys: [],

    async install(ctx: InstallContext) {
      const { terminal, settings } = ctx

      const { validateBotToken, validateChatId, validateBotAdmin } = await import('./validators.js')

      let botToken = ''
      while (true) {
        botToken = await terminal.text({
          message: 'Telegram bot token (from @BotFather):',
          validate: (val) => {
            if (!val.trim()) return 'Token cannot be empty'
            return undefined
          },
        })
        botToken = botToken.trim()

        const spin = terminal.spinner()
        spin.start('Validating token...')
        const result = await validateBotToken(botToken)
        if (result.ok) {
          spin.stop(`Connected to @${result.botUsername}`)
          break
        }
        spin.fail(result.error)
        const action = await terminal.select({
          message: 'What to do?',
          options: [
            { label: 'Re-enter token', value: 'retry' },
            { label: 'Use as-is (skip validation)', value: 'skip' },
          ],
        })
        if (action === 'skip') break
      }

      // Chat ID detection
      terminal.log.info('Send a message in your Telegram group to detect the chat ID,')
      terminal.log.info('or enter the chat ID manually.')

      const chatIdMethod = await terminal.select({
        message: 'How to get the chat ID?',
        options: [
          { value: 'manual', label: 'Enter chat ID manually' },
          { value: 'detect', label: 'Auto-detect from group message' },
        ],
      })

      let chatId: number
      if (chatIdMethod === 'manual') {
        const val = await terminal.text({
          message: 'Group chat ID (e.g. -1001234567890):',
          validate: (v) => {
            const n = Number(v.trim())
            if (isNaN(n) || !Number.isInteger(n)) return 'Chat ID must be an integer'
            return undefined
          },
        })
        chatId = Number(val.trim())
      } else {
        // Simple polling-based detection
        terminal.log.step('Listening for messages... Send "hi" in the group.')
        chatId = await detectChatIdViaPolling(botToken, terminal)
      }

      // Validate chat ID
      const chatResult = await validateChatId(botToken, chatId)
      if (chatResult.ok) {
        terminal.log.success(`Group: ${chatResult.title}`)
        if (!chatResult.isForum) {
          terminal.log.warning('Topics are not enabled on this group.')
          terminal.log.info('OpenACP requires Topics to organize sessions.')
          terminal.log.info('')
          terminal.log.info('To enable Topics:')
          terminal.log.info('  1. Open your group in Telegram')
          terminal.log.info('  2. Go to Group Settings → Edit')
          terminal.log.info('  3. Enable "Topics"')
          terminal.log.info('')
          const proceed = await terminal.confirm({
            message: 'Topics not enabled. Continue anyway? (You can fix this before starting OpenACP)',
            initialValue: false,
          })
          if (!proceed) {
            terminal.log.info('Setup cancelled. Re-run when Topics are enabled.')
            return
          }
        }
      } else {
        terminal.log.warning(chatResult.error)
      }

      // Validate admin
      const adminResult = await validateBotAdmin(botToken, chatId)
      if (adminResult.ok) {
        terminal.log.success('Bot has admin privileges')
        if (!adminResult.canManageTopics) {
          terminal.log.warning('Bot does not have "Manage Topics" permission.')
          terminal.log.info('')
          terminal.log.info('To fix:')
          terminal.log.info('  1. Open Group Settings → Administrators')
          terminal.log.info('  2. Select the bot')
          terminal.log.info('  3. Enable "Manage Topics"')
          terminal.log.info('')
          const proceed = await terminal.confirm({
            message: 'Bot cannot manage topics. Continue anyway? (You can fix this before starting OpenACP)',
            initialValue: false,
          })
          if (!proceed) {
            terminal.log.info('Setup cancelled. Re-run when bot permissions are set.')
            return
          }
        }
      } else {
        terminal.log.warning(adminResult.error)
      }

      await settings.setAll({
        botToken,
        chatId,
        notificationTopicId: null,
        assistantTopicId: null,
      })
      terminal.log.success('Telegram settings saved')
    },

    async configure(ctx: InstallContext) {
      const { terminal, settings } = ctx
      const current = await settings.getAll()

      const choice = await terminal.select({
        message: 'What to configure?',
        options: [
          { value: 'token', label: 'Change bot token' },
          { value: 'chatId', label: 'Change chat ID' },
          { value: 'done', label: 'Done' },
        ],
      })

      if (choice === 'token') {
        const token = await terminal.text({
          message: 'New bot token:',
          validate: (v) => (!v.trim() ? 'Token cannot be empty' : undefined),
        })
        await settings.set('botToken', token.trim())
        terminal.log.success('Bot token updated')
      } else if (choice === 'chatId') {
        const val = await terminal.text({
          message: 'New chat ID:',
          defaultValue: String(current.chatId ?? ''),
          validate: (v) => {
            const n = Number(v.trim())
            if (isNaN(n) || !Number.isInteger(n)) return 'Chat ID must be an integer'
            return undefined
          },
        })
        await settings.set('chatId', Number(val.trim()))
        terminal.log.success('Chat ID updated')
      }
    },

    async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
      if (opts.purge) {
        await ctx.settings.clear()
        ctx.terminal.log.success('Telegram settings cleared')
      }
    },

    async setup(ctx) {
      ctx.registerEditableFields([
        { key: 'enabled', displayName: 'Enabled', type: 'toggle', scope: 'safe', hotReload: false },
        { key: 'botToken', displayName: 'Bot Token', type: 'string', scope: 'sensitive', hotReload: false },
        { key: 'chatId', displayName: 'Chat ID', type: 'number', scope: 'safe', hotReload: false },
      ])

      const config = ctx.pluginConfig as Record<string, unknown>
      if (!config.botToken || !config.chatId) {
        ctx.log.info('Telegram disabled (missing botToken or chatId)')
        return
      }

      const core = ctx.core as OpenACPCore
      const settingsManager = core.lifecycleManager?.settingsManager

      // If topic IDs are null in plugin settings but present in main config, migrate them.
      // This handles users who ran a version where ensureTopics saved to main config instead of plugin settings.
      if ((config.notificationTopicId == null || config.assistantTopicId == null) && settingsManager) {
        const mainCfg = core.configManager.get()
        const legacy = (mainCfg as any)?.channels?.telegram as Record<string, unknown> | undefined
        const migrated: Record<string, unknown> = {}
        if (legacy?.notificationTopicId != null && config.notificationTopicId == null) {
          config.notificationTopicId = legacy.notificationTopicId
          migrated.notificationTopicId = legacy.notificationTopicId
        }
        if (legacy?.assistantTopicId != null && config.assistantTopicId == null) {
          config.assistantTopicId = legacy.assistantTopicId
          migrated.assistantTopicId = legacy.assistantTopicId
        }
        if (Object.keys(migrated).length > 0) {
          await settingsManager.updatePluginSettings(ctx.pluginName, migrated)
          ctx.log.info('Migrated topic IDs from main config to plugin settings')
        }
      }

      const { TelegramAdapter } = await import('./adapter.js')
      // config is a Record<string, unknown> from pluginConfig; at runtime it
      // contains all TelegramChannelConfig fields populated from the migrated config.
      adapter = new TelegramAdapter(core, {
        ...config,
        enabled: true,
        maxMessageLength: 4096,
      } as unknown as TelegramChannelConfig, async (updates) => {
        // Save topic IDs to plugin settings so they persist across restarts
        if (settingsManager) {
          await settingsManager.updatePluginSettings(ctx.pluginName, updates)
        }
      })

      ctx.registerService('adapter:telegram', adapter)
      ctx.log.info('Telegram adapter registered')
    },

    async teardown() {
      if (adapter) {
        await adapter.stop()
      }
    },
  }
}

/**
 * Poll `getUpdates` until a group message is received, then return its chat ID.
 * Used during `install` when the user chooses auto-detect instead of manual entry.
 * Times out after ~4 minutes (120 attempts × 2s) and falls back to manual input.
 */
async function detectChatIdViaPolling(
  token: string,
  terminal: InstallContext['terminal'],
): Promise<number> {
  let lastUpdateId = 0
  try {
    const clearRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=-1`)
    const clearData = (await clearRes.json()) as { ok: boolean; result?: Array<{ update_id: number }> }
    if (clearData.ok && clearData.result?.length) {
      lastUpdateId = clearData.result[clearData.result.length - 1].update_id
    }
  } catch {
    // ignore
  }

  const MAX_ATTEMPTS = 120
  const POLL_INTERVAL = 2000

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const offset = lastUpdateId ? lastUpdateId + 1 : 0
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=2`)
      const data = (await res.json()) as {
        ok: boolean
        result?: Array<{
          update_id: number
          message?: { chat: { id: number; title?: string; type: string } }
          my_chat_member?: { chat: { id: number; title?: string; type: string } }
        }>
      }

      if (data.ok && data.result?.length) {
        for (const update of data.result) {
          lastUpdateId = update.update_id
          const chat = update.message?.chat ?? update.my_chat_member?.chat
          if (chat && (chat.type === 'supergroup' || chat.type === 'group')) {
            terminal.log.success(`Group detected: ${chat.title ?? chat.id} (${chat.id})`)
            return chat.id
          }
        }
      }
    } catch {
      // Network error, retry
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))
  }

  // Fallback to manual
  terminal.log.warning('Timed out waiting for messages. Enter chat ID manually.')
  const val = await terminal.text({
    message: 'Group chat ID (e.g. -1001234567890):',
    validate: (v) => {
      const n = Number(v.trim())
      if (isNaN(n) || !Number.isInteger(n)) return 'Chat ID must be an integer'
      return undefined
    },
  })
  return Number(val.trim())
}

export default createTelegramPlugin()
