import type { OpenACPPlugin, InstallContext, CoreAccess } from '../../core/plugin/types.js'
import { NotificationService } from './notification.js'

function createNotificationsPlugin(): OpenACPPlugin {
  return {
    name: '@openacp/notifications',
    version: '1.0.0',
    description: 'Cross-session notification routing',
    essential: false,
    // Depends on security so the notification service is only active for authorized sessions
    pluginDependencies: { '@openacp/security': '^1.0.0' },
    permissions: ['services:register', 'services:use', 'kernel:access', 'events:read'],

    async install(ctx: InstallContext) {
      await ctx.settings.setAll({ enabled: true })
      ctx.terminal.log.success('Notifications defaults saved')
    },

    async configure(ctx: InstallContext) {
      const { terminal, settings } = ctx
      const current = await settings.getAll()
      const toggle = await terminal.confirm({
        message: `Notifications are ${current.enabled !== false ? 'enabled' : 'disabled'}. Toggle?`,
        initialValue: false,
      })
      if (toggle) {
        const newState = current.enabled === false
        await settings.set('enabled', newState)
        terminal.log.success(`Notifications ${newState ? 'enabled' : 'disabled'}`)
      }
    },

    async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
      if (opts.purge) {
        await ctx.settings.clear()
        ctx.terminal.log.success('Notifications settings cleared')
      }
    },

    async setup(ctx) {
      // NotificationService needs the live adapters Map from core
      const core = ctx.core as CoreAccess
      const service = new NotificationService(core.adapters)

      // Wire identity resolver if available — enables user-targeted notifications
      const identity = ctx.getService<any>('identity')
      if (identity) service.setIdentityResolver(identity)

      // Listen for identity plugin load in case it boots after notifications
      ctx.on('plugin:loaded', (data: unknown) => {
        if ((data as any)?.name === '@openacp/identity') {
          const id = ctx.getService<any>('identity')
          if (id) service.setIdentityResolver(id)
        }
      })

      ctx.registerService('notifications', service)
      ctx.log.info('Notifications service ready')
    },
  }
}

export default createNotificationsPlugin()
