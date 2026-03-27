import type { OpenACPPlugin, InstallContext, CoreAccess } from '../../core/plugin/types.js'
import { NotificationManager } from './notification.js'

function createNotificationsPlugin(): OpenACPPlugin {
  return {
    name: '@openacp/notifications',
    version: '1.0.0',
    description: 'Cross-session notification routing',
    essential: false,
    pluginDependencies: { '@openacp/security': '^1.0.0' },
    permissions: ['services:register', 'kernel:access'],

    async install(ctx: InstallContext) {
      const { settings, terminal } = ctx

      // No interactive prompts needed — save defaults
      await settings.setAll({ enabled: true })
      terminal.log.success('Notifications defaults saved')
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
      // NotificationManager needs the live adapters Map from core
      const core = ctx.core as CoreAccess
      const manager = new NotificationManager(core.adapters)
      ctx.registerService('notifications', manager)
      ctx.log.info('Notifications service ready')
    },
  }
}

export default createNotificationsPlugin()
