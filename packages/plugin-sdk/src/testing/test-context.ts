import type {
  PluginContext, PluginStorage, CommandDef, CommandResponse,
  OutgoingMessage,
} from '@openacp/cli'

export interface TestContextOpts {
  pluginName: string
  pluginConfig?: Record<string, unknown>
  permissions?: string[]
  services?: Record<string, unknown>
}

export interface TestPluginContext extends PluginContext {
  /** Services registered via registerService() */
  registeredServices: Map<string, unknown>
  /** Commands registered via registerCommand() */
  registeredCommands: Map<string, CommandDef>
  /** Middleware registered via registerMiddleware() */
  registeredMiddleware: Array<{ hook: string; opts: unknown }>
  /** Events emitted via emit() */
  emittedEvents: Array<{ event: string; payload: unknown }>
  /** Messages sent via sendMessage() */
  sentMessages: Array<{ sessionId: string; content: OutgoingMessage }>
  /** Dispatch a registered command by name */
  executeCommand(name: string, args?: Partial<import('@openacp/cli').CommandArgs>): Promise<CommandResponse | void>
}

/**
 * Creates a test-friendly PluginContext for unit-testing plugins.
 * All state is in-memory, logger is silent, services are pre-populated.
 */
export function createTestContext(opts: TestContextOpts): TestPluginContext {
  const storageData = new Map<string, unknown>()
  const eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>()
  const registeredServices = new Map<string, unknown>()
  const registeredCommands = new Map<string, CommandDef>()
  const registeredMiddleware: Array<{ hook: string; opts: unknown }> = []
  const emittedEvents: Array<{ event: string; payload: unknown }> = []
  const sentMessages: Array<{ sessionId: string; content: OutgoingMessage }> = []

  // Pre-populate services from opts
  if (opts.services) {
    for (const [name, impl] of Object.entries(opts.services)) {
      registeredServices.set(name, impl)
    }
  }

  const storage: PluginStorage = {
    async get<T>(key: string): Promise<T | undefined> {
      return storageData.get(key) as T | undefined
    },
    async set<T>(key: string, value: T): Promise<void> {
      storageData.set(key, value)
    },
    async delete(key: string): Promise<void> {
      storageData.delete(key)
    },
    async list(): Promise<string[]> {
      return Array.from(storageData.keys())
    },
    getDataDir(): string {
      return '/tmp/openacp-test-data'
    },
  }

  const silentLog = {
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() { return silentLog },
  }

  const ctx: TestPluginContext = {
    pluginName: opts.pluginName,
    pluginConfig: opts.pluginConfig ?? {},

    // Events
    on(event: string, handler: (...args: unknown[]) => void): void {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set())
      }
      eventHandlers.get(event)!.add(handler)
    },
    off(event: string, handler: (...args: unknown[]) => void): void {
      eventHandlers.get(event)?.delete(handler)
    },
    emit(event: string, payload: unknown): void {
      emittedEvents.push({ event, payload })
      const handlers = eventHandlers.get(event)
      if (handlers) {
        for (const handler of handlers) {
          handler(payload)
        }
      }
    },

    // Actions
    registerMiddleware(hook: string, opts: unknown): void {
      registeredMiddleware.push({ hook, opts })
    },
    registerService<T>(name: string, implementation: T): void {
      registeredServices.set(name, implementation)
    },
    getService<T>(name: string): T | undefined {
      return registeredServices.get(name) as T | undefined
    },
    registerCommand(def: CommandDef): void {
      registeredCommands.set(def.name, def)
    },
    storage,
    log: silentLog,
    async sendMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
      sentMessages.push({ sessionId, content })
    },

    // Kernel access stubs
    sessions: {} as PluginContext['sessions'],
    config: {} as PluginContext['config'],
    eventBus: {} as PluginContext['eventBus'],
    core: {},

    // Test-specific
    registeredServices,
    registeredCommands,
    registeredMiddleware,
    emittedEvents,
    sentMessages,
    async executeCommand(name: string, args?: Partial<import('@openacp/cli').CommandArgs>): Promise<CommandResponse | void> {
      const cmd = registeredCommands.get(name)
      if (!cmd) {
        throw new Error(`Command not found: ${name}`)
      }
      const defaultArgs: import('@openacp/cli').CommandArgs = {
        raw: '',
        sessionId: null,
        channelId: 'test',
        userId: 'test-user',
        async reply() {},
        ...args,
      }
      return cmd.handler(defaultArgs)
    },
  }

  return ctx
}
