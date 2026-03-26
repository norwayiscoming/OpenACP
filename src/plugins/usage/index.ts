import type { OpenACPPlugin } from '../../core/plugin/types.js'
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
    permissions: ['services:register'],

    async setup(ctx) {
      const config = ctx.pluginConfig as Record<string, unknown>
      const usagePath = path.join(os.homedir(), '.openacp', 'usage.json')
      const retentionDays = (config.retentionDays as number) ?? 30
      store = new UsageStore(usagePath, retentionDays)
      const budget = new UsageBudget(store, config as any)

      ctx.registerService('usage', { store, budget })
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
