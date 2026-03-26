import type { OpenACPPlugin } from '../../core/plugin/types.js'

function createSlackPlugin(): OpenACPPlugin {
  let adapter: any = null

  return {
    name: '@openacp/slack',
    version: '1.0.0',
    description: 'Slack adapter with channels and threads',
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
      if (!config.botToken || !config.appToken) {
        ctx.log.info('Slack disabled (missing botToken or appToken)')
        return
      }

      const { SlackAdapter } = await import('../../adapters/slack/adapter.js')
      const core = ctx.core as any
      adapter = new SlackAdapter(core, {
        ...config,
        enabled: true,
        maxMessageLength: 3000,
      } as any)

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
