import type { OpenACPPlugin } from '../../core/plugin/types.js'

function createDiscordPlugin(): OpenACPPlugin {
  let adapter: any = null

  return {
    name: '@openacp/discord',
    version: '1.0.0',
    description: 'Discord adapter with forum threads',
    pluginDependencies: {
      '@openacp/security': '^1.0.0',
      '@openacp/notifications': '^1.0.0',
    },
    optionalPluginDependencies: {
      '@openacp/speech': '^1.0.0',
    },
    permissions: ['services:register', 'kernel:access', 'events:read'],

    async setup(ctx) {
      const config = ctx.pluginConfig as Record<string, unknown>
      if (!config.botToken || !config.guildId) {
        ctx.log.info('Discord disabled (missing botToken or guildId)')
        return
      }

      const { DiscordAdapter } = await import('../../adapters/discord/adapter.js')
      const core = ctx.core as any
      adapter = new DiscordAdapter(core, {
        ...config,
        enabled: true,
        maxMessageLength: 2000,
      } as any)

      ctx.registerService('adapter:discord', adapter)
      ctx.log.info('Discord adapter registered')
    },

    async teardown() {
      if (adapter) {
        await adapter.stop()
      }
    },
  }
}

export default createDiscordPlugin()
