import type { OpenACPPlugin } from '../../core/plugin/types.js'

function createTunnelPlugin(): OpenACPPlugin {
  let service: { stop(): Promise<void> } | null = null

  return {
    name: '@openacp/tunnel',
    version: '1.0.0',
    description: 'Expose local services to internet via tunnel providers',
    permissions: ['services:register', 'kernel:access'],

    async setup(ctx) {
      const config = ctx.pluginConfig as Record<string, unknown>
      if (!config.provider) {
        ctx.log.info('Tunnel disabled (no provider configured)')
        return
      }

      const { TunnelService } = await import('./tunnel-service.js')
      const tunnelSvc = new TunnelService(config as any)
      const publicUrl = await tunnelSvc.start()
      service = tunnelSvc

      ctx.registerService('tunnel', tunnelSvc)
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
