import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import type { OpenACPCore } from '../../core/core.js'
import type { ApiConfig } from './api-server.js'

function createApiServerPlugin(): OpenACPPlugin {
  let server: { start(): Promise<void>; stop?(): Promise<void> } | null = null

  return {
    name: '@openacp/api-server',
    version: '1.0.0',
    description: 'REST API + SSE streaming server',
    essential: false,
    permissions: ['services:register', 'kernel:access', 'events:read'],

    async install(ctx: InstallContext) {
      const { settings, legacyConfig, terminal } = ctx

      // Migrate from legacy config if present
      if (legacyConfig) {
        const apiCfg = legacyConfig.api as Record<string, unknown> | undefined
        if (apiCfg) {
          await settings.setAll({
            port: apiCfg.port ?? 21420,
            host: apiCfg.host ?? '127.0.0.1',
          })
          terminal.log.success('API server settings migrated from legacy config')
          return
        }
      }

      // Save defaults
      await settings.setAll({
        port: 21420,
        host: '127.0.0.1',
      })
      terminal.log.success('API server defaults saved')
    },

    async configure(ctx: InstallContext) {
      const { terminal, settings } = ctx
      const current = await settings.getAll()

      const choice = await terminal.select({
        message: 'What to configure?',
        options: [
          { value: 'port', label: `Change port (current: ${current.port ?? 21420})` },
          { value: 'host', label: `Change host (current: ${current.host ?? '127.0.0.1'})` },
          { value: 'done', label: 'Done' },
        ],
      })

      if (choice === 'port') {
        const val = await terminal.text({
          message: 'API port:',
          defaultValue: String(current.port ?? 21420),
          validate: (v) => {
            const n = Number(v.trim())
            if (isNaN(n) || n < 1 || n > 65535) return 'Port must be 1-65535'
            return undefined
          },
        })
        await settings.set('port', Number(val.trim()))
        terminal.log.success('Port updated')
      } else if (choice === 'host') {
        const val = await terminal.text({
          message: 'API host:',
          defaultValue: (current.host as string) ?? '127.0.0.1',
        })
        await settings.set('host', val.trim())
        terminal.log.success('Host updated')
      }
    },

    async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
      if (opts.purge) {
        await ctx.settings.clear()
        ctx.terminal.log.success('API server settings cleared')
      }
    },

    async setup(ctx) {
      const config = ctx.pluginConfig as Record<string, unknown>

      // Lazy import to avoid loading unless needed
      const { ApiServer } = await import('./api-server.js')

      const apiConfig: ApiConfig = {
        port: (config.port as number) ?? 0,
        host: (config.host as string) ?? '127.0.0.1',
      }

      server = new ApiServer(ctx.core as OpenACPCore, apiConfig)

      ctx.registerService('api-server', server)

      // Start on system:ready
      ctx.on('system:ready', async () => {
        try {
          await server!.start()
          ctx.log.info('API server started')
        } catch (err) {
          ctx.log.error(`API server failed to start: ${err}`)
        }
      })
    },

    async teardown() {
      if (server) {
        await server.stop?.()
      }
    },
  }
}

export default createApiServerPlugin()
