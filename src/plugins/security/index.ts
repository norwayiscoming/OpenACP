import type { OpenACPPlugin, InstallContext, MiddlewarePayloadMap } from '../../core/plugin/types.js'
import { SecurityGuard } from './security-guard.js'
import type { SecurityConfig } from './security-guard.js'
import type { IncomingMessage } from '../../core/types.js'

// Structural type for the core fields SecurityGuard needs, avoiding
// a direct dependency on OpenACPCore's full interface.
interface SecurityCoreAccess {
  sessionManager: ConstructorParameters<typeof SecurityGuard>[1]
  lifecycleManager?: { settingsManager?: import('../../core/plugin/settings-manager.js').SettingsManager }
}

// Factory function pattern (closure for state)
function createSecurityPlugin(): OpenACPPlugin {
  return {
    name: '@openacp/security',
    version: '1.0.0',
    description: 'User access control and session limits',
    essential: false,
    permissions: ['services:register', 'middleware:register', 'kernel:access', 'commands:register'],
    inheritableKeys: ['allowedUserIds', 'maxConcurrentSessions', 'sessionTimeoutMinutes'],

    async install(ctx: InstallContext) {
      const { settings, legacyConfig, terminal } = ctx

      // Migrate from legacy config if present
      if (legacyConfig) {
        const securityCfg = legacyConfig.security as Record<string, unknown> | undefined
        if (securityCfg) {
          await settings.setAll({
            allowedUserIds: securityCfg.allowedUserIds ?? [],
            maxConcurrentSessions: securityCfg.maxConcurrentSessions ?? 20,
            sessionTimeoutMinutes: securityCfg.sessionTimeoutMinutes ?? 60,
          })
          terminal.log.success('Security settings migrated from legacy config')
          return
        }
      }

      // Save defaults (no interactive prompts needed)
      await settings.setAll({
        allowedUserIds: [],
        maxConcurrentSessions: 20,
        sessionTimeoutMinutes: 60,
      })
      terminal.log.success('Security defaults saved')
    },

    async configure(ctx: InstallContext) {
      const { terminal, settings } = ctx
      const current = await settings.getAll()

      const choice = await terminal.select({
        message: 'What to configure?',
        options: [
          { value: 'allowedUsers', label: 'Edit allowed user IDs' },
          { value: 'maxSessions', label: `Max concurrent sessions (current: ${current.maxConcurrentSessions ?? 20})` },
          { value: 'timeout', label: `Session timeout minutes (current: ${current.sessionTimeoutMinutes ?? 60})` },
          { value: 'done', label: 'Done' },
        ],
      })

      if (choice === 'allowedUsers') {
        const currentIds = (current.allowedUserIds as string[]) ?? []
        const val = await terminal.text({
          message: 'Allowed user IDs (comma-separated, empty = allow all):',
          defaultValue: currentIds.join(', '),
        })
        const ids = val.split(',').map((s) => s.trim()).filter(Boolean)
        await settings.set('allowedUserIds', ids)
        terminal.log.success('Allowed user IDs updated')
      } else if (choice === 'maxSessions') {
        const val = await terminal.text({
          message: 'Max concurrent sessions:',
          defaultValue: String(current.maxConcurrentSessions ?? 20),
          validate: (v) => {
            const n = Number(v.trim())
            if (isNaN(n) || n < 1) return 'Must be a positive number'
            return undefined
          },
        })
        await settings.set('maxConcurrentSessions', Number(val.trim()))
        terminal.log.success('Max sessions updated')
      } else if (choice === 'timeout') {
        const val = await terminal.text({
          message: 'Session timeout (minutes):',
          defaultValue: String(current.sessionTimeoutMinutes ?? 60),
          validate: (v) => {
            const n = Number(v.trim())
            if (isNaN(n) || n < 1) return 'Must be a positive number'
            return undefined
          },
        })
        await settings.set('sessionTimeoutMinutes', Number(val.trim()))
        terminal.log.success('Session timeout updated')
      }
    },

    async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
      if (opts.purge) {
        await ctx.settings.clear()
        ctx.terminal.log.success('Security settings cleared')
      }
    },

    async setup(ctx) {
      const core = ctx.core as SecurityCoreAccess
      const settingsManager = core.lifecycleManager?.settingsManager
      const pluginName = ctx.pluginName

      const getSecurityConfig = async (): Promise<SecurityConfig> => {
        if (settingsManager) {
          const settings = await settingsManager.loadSettings(pluginName)
          if (Object.keys(settings).length > 0) {
            return {
              allowedUserIds: (settings.allowedUserIds as string[]) ?? [],
              maxConcurrentSessions: (settings.maxConcurrentSessions as number) ?? 20,
            }
          }
        }
        const cfg = ctx.pluginConfig as Record<string, unknown>
        return {
          allowedUserIds: (cfg.allowedUserIds as string[]) ?? [],
          maxConcurrentSessions: (cfg.maxConcurrentSessions as number) ?? 20,
        }
      }

      const guard = new SecurityGuard(getSecurityConfig, core.sessionManager)

      // Register middleware for message:incoming — block unauthorized users
      ctx.registerMiddleware('message:incoming', {
        handler: async (payload: MiddlewarePayloadMap['message:incoming'], next) => {
          const access = await guard.checkAccess(payload as unknown as IncomingMessage)
          if (!access.allowed) {
            ctx.log.info(`Access denied: ${access.reason}`)
            return null  // block
          }
          return next()
        }
      })

      // Register SecurityGuard as the service directly
      ctx.registerService('security', guard)

      ctx.log.info('Security service ready')
    },
  }
}

export default createSecurityPlugin()
