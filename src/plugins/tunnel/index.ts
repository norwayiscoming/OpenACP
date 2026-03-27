import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import type { TunnelConfig } from '../../core/config/config.js'

function createTunnelPlugin(): OpenACPPlugin {
  let service: { stop(): Promise<void> } | null = null

  return {
    name: '@openacp/tunnel',
    version: '1.0.0',
    description: 'Expose local services to internet via tunnel providers',
    essential: false,
    permissions: ['services:register', 'kernel:access', 'commands:register'],

    async install(ctx: InstallContext) {
      const { terminal, settings, legacyConfig } = ctx

      // Migrate from legacy config if present
      if (legacyConfig) {
        const tunnelCfg = legacyConfig.tunnel as Record<string, unknown> | undefined
        if (tunnelCfg) {
          await settings.setAll({
            enabled: tunnelCfg.enabled ?? true,
            provider: tunnelCfg.provider ?? 'cloudflare',
            port: tunnelCfg.port ?? 3100,
            options: tunnelCfg.options ?? {},
            maxUserTunnels: tunnelCfg.maxUserTunnels ?? 5,
            storeTtlMinutes: tunnelCfg.storeTtlMinutes ?? 60,
            auth: tunnelCfg.auth ?? { enabled: false },
          })
          terminal.log.success('Tunnel settings migrated from legacy config')
          return
        }
      }

      // Interactive setup
      const provider = await terminal.select({
        message: 'Tunnel provider:',
        options: [
          { value: 'cloudflare', label: 'Cloudflare (cloudflared)', hint: 'Free, no account needed' },
          { value: 'ngrok', label: 'ngrok', hint: 'Requires auth token' },
          { value: 'bore', label: 'bore', hint: 'Self-hostable' },
          { value: 'tailscale', label: 'Tailscale Funnel' },
        ],
      })

      const portStr = await terminal.text({
        message: 'Local port to expose:',
        defaultValue: '3100',
        validate: (v) => {
          const n = Number(v.trim())
          if (isNaN(n) || n < 1 || n > 65535) return 'Port must be 1-65535'
          return undefined
        },
      })

      let authToken = ''
      if (provider === 'ngrok') {
        authToken = await terminal.text({
          message: 'ngrok auth token:',
          validate: (v) => (!v.trim() ? 'Auth token cannot be empty' : undefined),
        })
        authToken = authToken.trim()
      }

      await settings.setAll({
        enabled: true,
        provider,
        port: Number(portStr.trim()),
        options: authToken ? { authtoken: authToken } : {},
        maxUserTunnels: 5,
        storeTtlMinutes: 60,
        auth: { enabled: false },
      })
      terminal.log.success('Tunnel settings saved')
    },

    async configure(ctx: InstallContext) {
      const { terminal, settings } = ctx
      const current = await settings.getAll()

      const choice = await terminal.select({
        message: 'What to configure?',
        options: [
          { value: 'provider', label: `Change provider (current: ${current.provider ?? 'none'})` },
          { value: 'port', label: `Change port (current: ${current.port ?? 3100})` },
          { value: 'toggle', label: `${current.enabled ? 'Disable' : 'Enable'} tunnel` },
          { value: 'done', label: 'Done' },
        ],
      })

      if (choice === 'provider') {
        const provider = await terminal.select({
          message: 'Tunnel provider:',
          options: [
            { value: 'cloudflare', label: 'Cloudflare' },
            { value: 'ngrok', label: 'ngrok' },
            { value: 'bore', label: 'bore' },
            { value: 'tailscale', label: 'Tailscale' },
          ],
        })
        await settings.set('provider', provider)
        terminal.log.success('Provider updated')
      } else if (choice === 'port') {
        const val = await terminal.text({
          message: 'New port:',
          defaultValue: String(current.port ?? 3100),
          validate: (v) => {
            const n = Number(v.trim())
            if (isNaN(n) || n < 1 || n > 65535) return 'Port must be 1-65535'
            return undefined
          },
        })
        await settings.set('port', Number(val.trim()))
        terminal.log.success('Port updated')
      } else if (choice === 'toggle') {
        const newState = !current.enabled
        await settings.set('enabled', newState)
        terminal.log.success(`Tunnel ${newState ? 'enabled' : 'disabled'}`)
      }
    },

    async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
      if (opts.purge) {
        await ctx.settings.clear()
        ctx.terminal.log.success('Tunnel settings cleared')
      }
    },

    async setup(ctx) {
      const config = ctx.pluginConfig as Record<string, unknown>
      if (!config.provider) {
        ctx.log.info('Tunnel disabled (no provider configured)')
        return
      }

      const { TunnelService } = await import('./tunnel-service.js')
      const tunnelSvc = new TunnelService(config as unknown as TunnelConfig)
      const publicUrl = await tunnelSvc.start()
      service = tunnelSvc

      ctx.registerService('tunnel', tunnelSvc)

      ctx.registerCommand({
        name: 'tunnel',
        description: 'Show tunnel status and URL',
        category: 'plugin',
        handler: async () => {
          const url = tunnelSvc.getPublicUrl()
          return { type: 'text', text: `Tunnel active: ${url}` }
        },
      })

      ctx.registerCommand({
        name: 'tunnels',
        description: 'List active tunnels',
        category: 'plugin',
        handler: async () => {
          const url = tunnelSvc.getPublicUrl()
          return { type: 'list', title: 'Active Tunnels', items: [
            { label: 'Primary', detail: url },
          ]}
        },
      })

      ctx.log.info(`Tunnel ready: ${publicUrl}`)
    },

    async teardown() {
      if (service) {
        await service.stop()
      }
    },
  }
}

export default createTunnelPlugin()
