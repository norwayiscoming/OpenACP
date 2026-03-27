import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import { ContextManager } from './context-manager.js'
import { EntireProvider } from './entire/entire-provider.js'

const contextPlugin: OpenACPPlugin = {
  name: '@openacp/context',
  version: '1.0.0',
  description: 'Conversation context management with pluggable providers',
  essential: false,
  permissions: ['services:register'],

  async install(ctx: InstallContext) {
    const { settings, terminal } = ctx

    // No interactive prompts needed — save defaults
    await settings.setAll({ enabled: true })
    terminal.log.success('Context defaults saved')
  },

  async configure(ctx: InstallContext) {
    const { terminal, settings } = ctx
    const current = await settings.getAll()

    const toggle = await terminal.confirm({
      message: `Context service is ${current.enabled !== false ? 'enabled' : 'disabled'}. Toggle?`,
      initialValue: false,
    })
    if (toggle) {
      const newState = current.enabled === false
      await settings.set('enabled', newState)
      terminal.log.success(`Context service ${newState ? 'enabled' : 'disabled'}`)
    }
  },

  async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
    if (opts.purge) {
      await ctx.settings.clear()
      ctx.terminal.log.success('Context settings cleared')
    }
  },

  async setup(ctx) {
    const manager = new ContextManager()
    manager.register(new EntireProvider())
    ctx.registerService('context', manager)
    ctx.log.info('Context service ready')
  },
}

export default contextPlugin
