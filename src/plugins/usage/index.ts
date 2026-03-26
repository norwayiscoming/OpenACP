import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import type { UsageConfig } from '../../core/config/config.js'
import { UsageStore } from './usage-store.js'
import { UsageBudget } from './usage-budget.js'
import path from 'node:path'
import os from 'node:os'

function createUsagePlugin(): OpenACPPlugin {
  let store: UsageStore | null = null

  return {
    name: '@openacp/usage',
    version: '1.0.0',
    description: 'Token usage tracking and budget enforcement',
    essential: false,
    permissions: ['services:register', 'commands:register'],

    async install(ctx: InstallContext) {
      const { settings, legacyConfig, terminal } = ctx

      // Migrate from legacy config if present
      if (legacyConfig) {
        const usageCfg = legacyConfig.usage as Record<string, unknown> | undefined
        if (usageCfg) {
          await settings.setAll({
            enabled: usageCfg.enabled ?? true,
            warningThreshold: usageCfg.warningThreshold ?? 0.8,
            currency: usageCfg.currency ?? 'USD',
            retentionDays: usageCfg.retentionDays ?? 90,
          })
          terminal.log.success('Usage settings migrated from legacy config')
          return
        }
      }

      // Save defaults
      await settings.setAll({
        enabled: true,
        warningThreshold: 0.8,
        currency: 'USD',
        retentionDays: 90,
      })
      terminal.log.success('Usage defaults saved')
    },

    async configure(ctx: InstallContext) {
      const { terminal, settings } = ctx
      const current = await settings.getAll()

      const choice = await terminal.select({
        message: 'What to configure?',
        options: [
          { value: 'threshold', label: `Warning threshold (current: ${current.warningThreshold ?? 0.8})` },
          { value: 'retention', label: `Retention days (current: ${current.retentionDays ?? 90})` },
          { value: 'toggle', label: `${current.enabled ? 'Disable' : 'Enable'} usage tracking` },
          { value: 'done', label: 'Done' },
        ],
      })

      if (choice === 'threshold') {
        const val = await terminal.text({
          message: 'Warning threshold (0-1):',
          defaultValue: String(current.warningThreshold ?? 0.8),
          validate: (v) => {
            const n = Number(v.trim())
            if (isNaN(n) || n < 0 || n > 1) return 'Must be between 0 and 1'
            return undefined
          },
        })
        await settings.set('warningThreshold', Number(val.trim()))
        terminal.log.success('Warning threshold updated')
      } else if (choice === 'retention') {
        const val = await terminal.text({
          message: 'Retention days:',
          defaultValue: String(current.retentionDays ?? 90),
          validate: (v) => {
            const n = Number(v.trim())
            if (isNaN(n) || n < 1) return 'Must be a positive number'
            return undefined
          },
        })
        await settings.set('retentionDays', Number(val.trim()))
        terminal.log.success('Retention days updated')
      } else if (choice === 'toggle') {
        const newState = !current.enabled
        await settings.set('enabled', newState)
        terminal.log.success(`Usage tracking ${newState ? 'enabled' : 'disabled'}`)
      }
    },

    async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
      if (opts.purge) {
        await ctx.settings.clear()
        ctx.terminal.log.success('Usage settings cleared')
      }
    },

    async setup(ctx) {
      const config = ctx.pluginConfig as Record<string, unknown>
      const usagePath = path.join(os.homedir(), '.openacp', 'usage.json')
      const retentionDays = (config.retentionDays as number) ?? 30
      store = new UsageStore(usagePath, retentionDays)
      const budget = new UsageBudget(store, config as unknown as UsageConfig)

      ctx.registerService('usage', { store, budget })

      ctx.registerCommand({
        name: 'usage',
        description: 'Show usage summary',
        category: 'plugin',
        handler: async () => {
          const status = budget.getStatus()
          const lines = [
            `Usage (this month):`,
            `  Spent: $${status.used.toFixed(2)}`,
            `  Budget: $${status.budget.toFixed(2)}`,
            `  Status: ${status.status} (${status.percent}%)`,
          ]
          return { type: 'text', text: lines.join('\n') }
        },
      })

      ctx.log.info('Usage tracking ready')
    },

    async teardown() {
      if (store) {
        store.destroy()
      }
    },
  }
}

export default createUsagePlugin()
