import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import type { OpenACPCore } from '../../core/core.js'
import type { SlackChannelConfig } from './types.js'

function createSlackPlugin(): OpenACPPlugin {
  let adapter: { stop(): Promise<void> } | null = null

  return {
    name: '@openacp/slack',
    version: '1.0.0',
    description: 'Slack adapter with channels and threads',
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
        const ch = legacyConfig.channels as Record<string, unknown> | undefined
        const slackCfg = ch?.slack as Record<string, unknown> | undefined
        if (slackCfg?.botToken) {
          await settings.setAll({
            botToken: slackCfg.botToken,
            appToken: slackCfg.appToken,
            signingSecret: slackCfg.signingSecret ?? '',
            channelId: slackCfg.channelId ?? '',
          })
          terminal.log.success('Slack settings migrated from legacy config')
          return
        }
      }

      // Interactive setup via terminal
      terminal.note(
        '1. Create a Slack App at https://api.slack.com/apps\n' +
        '2. Enable Socket Mode and get an App-Level Token\n' +
        '3. Add Bot Token Scopes: chat:write, channels:history, groups:history, files:write\n' +
        '4. Install app to workspace and copy the Bot User OAuth Token',
        'Slack Setup',
      )

      const botToken = await terminal.text({
        message: 'Bot User OAuth Token (xoxb-...):',
        validate: (v) => (!v.trim() ? 'Token cannot be empty' : undefined),
      })

      const appToken = await terminal.text({
        message: 'App-Level Token (xapp-...):',
        validate: (v) => (!v.trim() ? 'Token cannot be empty' : undefined),
      })

      const signingSecret = await terminal.text({
        message: 'Signing Secret:',
        validate: (v) => (!v.trim() ? 'Signing secret cannot be empty' : undefined),
      })

      const channelId = await terminal.text({
        message: 'Default channel ID (optional):',
      })

      await settings.setAll({
        botToken: botToken.trim(),
        appToken: appToken.trim(),
        signingSecret: signingSecret.trim(),
        channelId: channelId.trim() || '',
      })
      terminal.log.success('Slack settings saved')
    },

    async configure(ctx: InstallContext) {
      const { terminal, settings } = ctx

      const choice = await terminal.select({
        message: 'What to configure?',
        options: [
          { value: 'botToken', label: 'Change bot token' },
          { value: 'appToken', label: 'Change app token' },
          { value: 'channelId', label: 'Change channel ID' },
          { value: 'done', label: 'Done' },
        ],
      })

      if (choice === 'botToken') {
        const val = await terminal.text({
          message: 'New bot token:',
          validate: (v) => (!v.trim() ? 'Token cannot be empty' : undefined),
        })
        await settings.set('botToken', val.trim())
        terminal.log.success('Bot token updated')
      } else if (choice === 'appToken') {
        const val = await terminal.text({
          message: 'New app token:',
          validate: (v) => (!v.trim() ? 'Token cannot be empty' : undefined),
        })
        await settings.set('appToken', val.trim())
        terminal.log.success('App token updated')
      } else if (choice === 'channelId') {
        const val = await terminal.text({ message: 'New channel ID:' })
        await settings.set('channelId', val.trim())
        terminal.log.success('Channel ID updated')
      }
    },

    async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
      if (opts.purge) {
        await ctx.settings.clear()
        ctx.terminal.log.success('Slack settings cleared')
      }
    },

    async setup(ctx) {
      const config = ctx.pluginConfig as Record<string, unknown>
      if (!config.botToken || !config.appToken) {
        ctx.log.info('Slack disabled (missing botToken or appToken)')
        return
      }

      const { SlackAdapter } = await import('./adapter.js')
      // config is a Record<string, unknown> from pluginConfig; at runtime it
      // contains all SlackChannelConfig fields populated from the migrated config.
      adapter = new SlackAdapter(ctx.core as OpenACPCore, {
        ...config,
        enabled: true,
        maxMessageLength: 3000,
      } as unknown as SlackChannelConfig)

      ctx.registerService('adapter:slack', adapter)
      ctx.log.info('Slack adapter registered')
    },

    async teardown() {
      if (adapter) {
        await adapter.stop()
      }
    },
  }
}

export default createSlackPlugin()
