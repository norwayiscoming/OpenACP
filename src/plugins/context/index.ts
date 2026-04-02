import * as path from 'node:path'
import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import type { SessionRecord } from '../../core/types.js'
import { ContextManager } from './context-manager.js'
import { EntireProvider } from './entire/entire-provider.js'
import { HistoryProvider } from './history/history-provider.js'
import { HistoryRecorder } from './history/history-recorder.js'
import { HistoryStore } from './history/history-store.js'

const contextPlugin: OpenACPPlugin = {
  name: '@openacp/context',
  version: '1.0.0',
  description: 'Conversation context management with pluggable providers',
  essential: false,
  permissions: ['services:register', 'middleware:register', 'kernel:access'],

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
    // History recording and context
    const historyDir = path.join(ctx.instanceRoot, 'history')
    const store = new HistoryStore(historyDir)
    const recorder = new HistoryRecorder(store)

    // Access session records via SessionManager (kernel:access)
    const sessionManager = ctx.sessions as { listRecords(): SessionRecord[] }
    const getRecords = () => sessionManager.listRecords()

    // Register providers — local first (priority), entire as fallback
    const cachePath = path.join(ctx.instanceRoot, 'cache', 'entire')
    const manager = new ContextManager(cachePath)
    manager.register(new HistoryProvider(store, getRecords))
    manager.register(new EntireProvider())
    manager.setHistoryStore(store)
    ctx.registerService('context', manager)

    // Middleware: capture user prompts
    ctx.registerMiddleware('agent:beforePrompt', {
      priority: 200,
      handler: async (payload, next) => {
        recorder.onBeforePrompt(payload.sessionId, payload.text, payload.attachments)
        return next()
      },
    })

    // Middleware: capture agent events
    ctx.registerMiddleware('agent:afterEvent', {
      priority: 200,
      handler: async (payload, next) => {
        recorder.onAfterEvent(payload.sessionId, payload.event)
        return next()
      },
    })

    // Middleware: finalize turn and write to disk
    ctx.registerMiddleware('turn:end', {
      priority: 200,
      handler: async (payload, next) => {
        await recorder.onTurnEnd(payload.sessionId, payload.stopReason)
        return next()
      },
    })

    // Middleware: capture permission resolutions
    ctx.registerMiddleware('permission:afterResolve', {
      priority: 200,
      handler: async (payload, next) => {
        recorder.onPermissionResolved(payload.sessionId, payload.requestId, payload.decision)
        return next()
      },
    })

    // Middleware: clean up recorder memory on session destroy
    ctx.registerMiddleware('session:afterDestroy', {
      priority: 200,
      handler: async (payload, next) => {
        recorder.finalize(payload.sessionId)
        return next()
      },
    })

    ctx.log.info('Context service ready (local history + entire providers)')
  },
}

export default contextPlugin
