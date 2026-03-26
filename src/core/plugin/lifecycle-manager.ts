import { resolveLoadOrder } from './plugin-loader.js'
import { ServiceRegistry } from './service-registry.js'
import { MiddlewareChain } from './middleware-chain.js'
import { ErrorTracker } from './error-tracker.js'
import { createPluginContext } from './plugin-context.js'
import type { OpenACPPlugin, EventBus, Logger } from './types.js'

const SETUP_TIMEOUT_MS = 30_000
const TEARDOWN_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms)
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      ;(timer as NodeJS.Timeout).unref()
    }
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

export interface LifecycleManagerOpts {
  serviceRegistry?: ServiceRegistry
  middlewareChain?: MiddlewareChain
  errorTracker?: ErrorTracker
  eventBus?: EventBus & {
    on(event: string, handler: (...args: unknown[]) => void): void
    off(event: string, handler: (...args: unknown[]) => void): void
    emit(event: string, payload: unknown): void
  }
  storagePath?: string
  sessions?: unknown
  config?: unknown
  log?: Logger
}

export class LifecycleManager {
  readonly serviceRegistry: ServiceRegistry
  readonly middlewareChain: MiddlewareChain
  readonly errorTracker: ErrorTracker

  private eventBus: LifecycleManagerOpts['eventBus']
  private storagePath: string
  private sessions: unknown
  private config: unknown
  private log: Logger | undefined

  private contexts = new Map<string, ReturnType<typeof createPluginContext>>()
  private loadOrder: OpenACPPlugin[] = []
  private _loaded = new Set<string>()
  private _failed = new Set<string>()

  get loadedPlugins(): string[] {
    return [...this._loaded]
  }

  get failedPlugins(): string[] {
    return [...this._failed]
  }

  constructor(opts?: LifecycleManagerOpts) {
    this.serviceRegistry = opts?.serviceRegistry ?? new ServiceRegistry()
    this.middlewareChain = opts?.middlewareChain ?? new MiddlewareChain()
    this.errorTracker = opts?.errorTracker ?? new ErrorTracker()
    this.eventBus = opts?.eventBus ?? {
      on() {},
      off() {},
      emit() {},
    }
    this.storagePath = opts?.storagePath ?? '/tmp/openacp-plugins'
    this.sessions = opts?.sessions ?? {}
    this.config = opts?.config ?? {}
    this.log = opts?.log
  }

  async boot(plugins: OpenACPPlugin[]): Promise<void> {
    // Resolve load order via topological sort.
    // resolveLoadOrder will skip plugins whose dependencies are missing entirely
    // (not present in the input list). But we also need to handle runtime setup failures.
    let sorted: OpenACPPlugin[]
    try {
      sorted = resolveLoadOrder(plugins)
    } catch (err) {
      // Circular dependency or other fatal error in resolution
      // Mark all as failed
      for (const p of plugins) {
        this._failed.add(p.name)
      }
      return
    }

    this.loadOrder = sorted

    for (const plugin of sorted) {
      // Check if any required dependency failed at runtime
      if (plugin.pluginDependencies) {
        const depFailed = Object.keys(plugin.pluginDependencies).some(
          (dep) => this._failed.has(dep),
        )
        if (depFailed) {
          this._failed.add(plugin.name)
          continue
        }
      }

      // Create context for this plugin
      const ctx = createPluginContext({
        pluginName: plugin.name,
        pluginConfig: {},
        permissions: plugin.permissions ?? [],
        serviceRegistry: this.serviceRegistry,
        middlewareChain: this.middlewareChain,
        errorTracker: this.errorTracker,
        eventBus: this.eventBus!,
        storagePath: `${this.storagePath}/${plugin.name}`,
        sessions: this.sessions,
        config: this.config,
        log: this.log,
      })

      try {
        await withTimeout(plugin.setup(ctx), SETUP_TIMEOUT_MS, `${plugin.name}.setup()`)
        this.contexts.set(plugin.name, ctx)
        this._loaded.add(plugin.name)
        this.eventBus?.emit('plugin:loaded', { name: plugin.name, version: plugin.version })
      } catch (err) {
        this._failed.add(plugin.name)
        ctx.cleanup()
        this.eventBus?.emit('plugin:failed', { name: plugin.name, error: String(err) })
      }
    }
  }

  async shutdown(): Promise<void> {
    // Teardown in reverse load order
    const reversed = [...this.loadOrder].reverse()

    for (const plugin of reversed) {
      if (!this._loaded.has(plugin.name)) continue

      if (plugin.teardown) {
        try {
          await withTimeout(plugin.teardown(), TEARDOWN_TIMEOUT_MS, `${plugin.name}.teardown()`)
        } catch {
          // Swallow teardown errors — graceful shutdown
        }
      }

      // Clean up the context
      const ctx = this.contexts.get(plugin.name)
      if (ctx) {
        ctx.cleanup()
        this.contexts.delete(plugin.name)
      }

      this.eventBus?.emit('plugin:unloaded', { name: plugin.name })
    }

    this._loaded.clear()
    this.loadOrder = []
  }
}
