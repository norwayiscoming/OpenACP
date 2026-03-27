import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import type { OpenACPCore } from '../../core/core.js'
import type { TelegramChannelConfig } from './types.js'

function createTelegramPlugin(): OpenACPPlugin {
  let adapter: { stop(): Promise<void> } | null = null

  return {
    name: '@openacp/telegram',
    version: '1.0.0',
    description: 'Telegram adapter with forum topics',
    essential: true,
    pluginDependencies: {
      '@openacp/security': '^1.0.0',
      '@openacp/notifications': '^1.0.0',
    },
    optionalPluginDependencies: {
      '@openacp/speech': '^1.0.0',
    },
    permissions: ['services:register', 'kernel:access', 'events:read'],

    async install(ctx: InstallContext) {
      const { terminal, settings, legacyConfig } = ctx

      // Migrate from legacy config if present
      if (legacyConfig) {
        const tg = legacyConfig.channels as Record<string, unknown> | undefined
        const telegramCfg = tg?.telegram as Record<string, unknown> | undefined
        if (telegramCfg?.botToken) {
          await settings.setAll({
            botToken: telegramCfg.botToken,
            chatId: telegramCfg.chatId,
            notificationTopicId: telegramCfg.notificationTopicId ?? null,
            assistantTopicId: telegramCfg.assistantTopicId ?? null,
          })
          terminal.log.success('Telegram settings migrated from legacy config')
          return
        }
      }

      // Interactive setup via terminal
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
      terminal.log.info('Send a message in your Telegram supergroup to detect the chat ID,')
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
          message: 'Supergroup chat ID (e.g. -1001234567890):',
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
        terminal.log.success(`Group: ${chatResult.title}${chatResult.isForum ? ' (Topics enabled)' : ''}`)
      } else {
        terminal.log.warning(chatResult.error)
      }

      // Validate admin
      const adminResult = await validateBotAdmin(botToken, chatId)
      if (adminResult.ok) {
        terminal.log.success('Bot has admin privileges')
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
      const config = ctx.pluginConfig as Record<string, unknown>
      if (!config.botToken || !config.chatId) {
        ctx.log.info('Telegram disabled (missing botToken or chatId)')
        return
      }

      const { TelegramAdapter } = await import('./adapter.js')
      // config is a Record<string, unknown> from pluginConfig; at runtime it
      // contains all TelegramChannelConfig fields populated from the migrated config.
      adapter = new TelegramAdapter(ctx.core as OpenACPCore, {
        ...config,
        enabled: true,
        maxMessageLength: 4096,
      } as unknown as TelegramChannelConfig)

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
    message: 'Supergroup chat ID (e.g. -1001234567890):',
    validate: (v) => {
      const n = Number(v.trim())
      if (isNaN(n) || !Number.isInteger(n)) return 'Chat ID must be an integer'
      return undefined
    },
  })
  return Number(val.trim())
}

export default createTelegramPlugin()
