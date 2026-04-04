import path from 'node:path'
import os from 'node:os'
import type {
  PluginContext,
  PluginPermission,
  CommandDef,
  MiddlewareHook,
  MiddlewareOptions,
  MiddlewarePayloadMap,
  PluginStorage,
  EventBus,
  Logger,
  OutgoingMessage,
  MenuItem,
} from './types.js'
import type { MenuRegistry } from '../menu-registry.js'
import type { AssistantSection } from '../assistant/assistant-registry.js'
import type { AssistantRegistry } from '../assistant/assistant-registry.js'
import { ServiceRegistry } from './service-registry.js'
import { MiddlewareChain } from './middleware-chain.js'
import { ErrorTracker } from './error-tracker.js'
import { PluginStorageImpl } from './plugin-storage.js'

interface CreatePluginContextOpts {
  pluginName: string
  pluginConfig: Record<string, unknown>
  permissions: PluginPermission[]
  serviceRegistry: ServiceRegistry
  middlewareChain: MiddlewareChain
  errorTracker: ErrorTracker
  eventBus: EventBus & {
    on(event: string, handler: (...args: unknown[]) => void): void
    off(event: string, handler: (...args: unknown[]) => void): void
    emit(event: string, payload: unknown): void
  }
  storagePath: string
  sessions: unknown
  config: unknown
  core?: unknown
  log?: Logger
  instanceRoot?: string
}

function requirePermission(permissions: PluginPermission[], required: PluginPermission, action: string): void {
  if (!permissions.includes(required)) {
    throw new Error(`Plugin does not have '${required}' permission required for ${action}`)
  }
}

export function createPluginContext(opts: CreatePluginContextOpts): PluginContext & { cleanup(): void } {
  const {
    pluginName,
    pluginConfig,
    permissions,
    serviceRegistry,
    middlewareChain,
    eventBus,
    storagePath,
    sessions,
    config,
    core,
  } = opts
  const instanceRoot = opts.instanceRoot ?? path.join(os.homedir(), '.openacp')

  // Track registered items for cleanup
  const registeredListeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = []
  const registeredCommands: CommandDef[] = []

  const noopLog: Logger = {
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() { return noopLog },
  }
  const baseLog: Logger = opts.log ?? noopLog
  const log: Logger = typeof baseLog.child === 'function'
    ? baseLog.child({ plugin: pluginName })
    : baseLog

  const storageImpl = new PluginStorageImpl(storagePath)

  // Create permission-guarded storage proxy
  const storage: PluginStorage = {
    async get<T>(key: string): Promise<T | undefined> {
      requirePermission(permissions, 'storage:read', 'storage.get')
      return storageImpl.get<T>(key)
    },
    async set<T>(key: string, value: T): Promise<void> {
      requirePermission(permissions, 'storage:write', 'storage.set')
      return storageImpl.set(key, value)
    },
    async delete(key: string): Promise<void> {
      requirePermission(permissions, 'storage:write', 'storage.delete')
      return storageImpl.delete(key)
    },
    async list(): Promise<string[]> {
      requirePermission(permissions, 'storage:read', 'storage.list')
      return storageImpl.list()
    },
    getDataDir(): string {
      requirePermission(permissions, 'storage:read', 'storage.getDataDir')
      return storageImpl.getDataDir()
    },
  }

  const ctx: PluginContext & { cleanup(): void } = {
    pluginName,
    pluginConfig,
    log,
    storage,

    on(event: string, handler: (...args: unknown[]) => void): void {
      requirePermission(permissions, 'events:read', 'on()')
      eventBus.on(event, handler)
      registeredListeners.push({ event, handler })
    },

    off(event: string, handler: (...args: unknown[]) => void): void {
      requirePermission(permissions, 'events:read', 'off()')
      eventBus.off(event, handler)
      const idx = registeredListeners.findIndex((l) => l.event === event && l.handler === handler)
      if (idx >= 0) registeredListeners.splice(idx, 1)
    },

    emit(event: string, payload: unknown): void {
      requirePermission(permissions, 'events:emit', 'emit()')
      eventBus.emit(event, payload)
    },

    registerMiddleware<H extends MiddlewareHook>(hook: H, middlewareOpts: MiddlewareOptions<MiddlewarePayloadMap[H]>): void {
      requirePermission(permissions, 'middleware:register', 'registerMiddleware()')
      middlewareChain.add(hook, pluginName, middlewareOpts as { priority?: number; handler: Function })
    },

    registerService<T>(name: string, implementation: T): void {
      requirePermission(permissions, 'services:register', 'registerService()')
      serviceRegistry.register(name, implementation, pluginName)
    },

    getService<T>(name: string): T | undefined {
      requirePermission(permissions, 'services:use', 'getService()')
      return serviceRegistry.get<T>(name)
    },

    registerCommand(def: CommandDef): void {
      requirePermission(permissions, 'commands:register', 'registerCommand()')
      registeredCommands.push(def)
      const registry = serviceRegistry.get<{ register(def: CommandDef, pluginName: string): void }>('command-registry')
      if (registry && typeof registry.register === 'function') {
        registry.register(def, pluginName)
        log.debug(`Command '/${def.name}' registered`)
      }
    },

    async sendMessage(_sessionId: string, _content: OutgoingMessage): Promise<void> {
      requirePermission(permissions, 'services:use', 'sendMessage()')
      // Delegate to message routing service
      const router = serviceRegistry.get<{ send(sessionId: string, content: OutgoingMessage): Promise<void> }>('message-router')
      if (router) {
        await router.send(_sessionId, _content)
      }
    },

    registerMenuItem(item: MenuItem): void {
      requirePermission(permissions, 'commands:register', 'registerMenuItem()')
      const menuRegistry = serviceRegistry.get('menu-registry') as MenuRegistry | undefined
      if (!menuRegistry) return
      menuRegistry.register({ ...item, id: `${pluginName}:${item.id}` })
    },

    unregisterMenuItem(id: string): void {
      requirePermission(permissions, 'commands:register', 'unregisterMenuItem()')
      const menuRegistry = serviceRegistry.get('menu-registry') as MenuRegistry | undefined
      if (!menuRegistry) return
      menuRegistry.unregister(`${pluginName}:${id}`)
    },

    registerAssistantSection(section: AssistantSection): void {
      requirePermission(permissions, 'commands:register', 'registerAssistantSection()')
      const assistantRegistry = serviceRegistry.get('assistant-registry') as AssistantRegistry | undefined
      if (!assistantRegistry) return
      assistantRegistry.register({ ...section, id: `${pluginName}:${section.id}` })
    },

    unregisterAssistantSection(id: string): void {
      requirePermission(permissions, 'commands:register', 'unregisterAssistantSection()')
      const assistantRegistry = serviceRegistry.get('assistant-registry') as AssistantRegistry | undefined
      if (!assistantRegistry) return
      assistantRegistry.unregister(`${pluginName}:${id}`)
    },

    get sessions() {
      requirePermission(permissions, 'kernel:access', 'sessions')
      return sessions as any
    },

    get config() {
      requirePermission(permissions, 'kernel:access', 'config')
      return config as any
    },

    get eventBus() {
      requirePermission(permissions, 'kernel:access', 'eventBus')
      return eventBus as any
    },

    get core() {
      requirePermission(permissions, 'kernel:access', 'core')
      return core
    },

    instanceRoot,

    cleanup(): void {
      // Remove all event listeners registered by this plugin
      for (const { event, handler } of registeredListeners) {
        eventBus.off(event, handler)
      }
      registeredListeners.length = 0

      // Remove all middleware registered by this plugin
      middlewareChain.removeAll(pluginName)

      // Unregister services owned by this plugin
      serviceRegistry.unregisterByPlugin(pluginName)

      // Unregister commands from CommandRegistry
      const cmdRegistry = serviceRegistry.get<{ unregisterByPlugin(name: string): void }>('command-registry')
      if (cmdRegistry && typeof cmdRegistry.unregisterByPlugin === 'function') {
        cmdRegistry.unregisterByPlugin(pluginName)
      }

      // Clear commands
      registeredCommands.length = 0
    },
  }

  return ctx
}
