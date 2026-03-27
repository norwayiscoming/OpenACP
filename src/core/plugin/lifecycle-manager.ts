import { resolveLoadOrder } from './plugin-loader.js'
import { ServiceRegistry } from './service-registry.js'
import { MiddlewareChain } from './middleware-chain.js'
import { ErrorTracker } from './error-tracker.js'
import { createPluginContext } from './plugin-context.js'
import type { OpenACPPlugin, EventBus, Logger, MigrateContext } from './types.js'
import type { SettingsManager } from './settings-manager.js'
import type { PluginRegistry } from './plugin-registry.js'

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

function resolvePluginConfig(pluginName: string, configManager: unknown): Record<string, unknown> {
  try {
    const allConfig = (configManager as any)?.get?.() ?? {}
    // Try new format: plugins.builtin['@openacp/speech'].config
    const pluginEntry = allConfig.plugins?.builtin?.[pluginName]
    if (pluginEntry?.config && Object.keys(pluginEntry.config).length > 0) {
      return pluginEntry.config
    }
    // @deprecated Legacy config path mapping — kept for backward compat with pre-plugin configs.
    // New plugins should use plugins.builtin['<name>'].config format. Remove when all users have migrated.
    const legacyMap: Record<string, string> = {
      '@openacp/security': 'security',
      '@openacp/speech': 'speech',
      '@openacp/tunnel': 'tunnel',
      '@openacp/usage': 'usage',
      '@openacp/file-service': 'files',
      '@openacp/api-server': 'api',
      '@openacp/telegram': 'channels.telegram',
      '@openacp/discord': 'channels.discord',
      '@openacp/adapter-discord': 'channels.discord',
      '@openacp/plugin-discord': 'channels.discord', // alias for old name
      '@openacp/slack': 'channels.slack',
    }
    const legacyKey = legacyMap[pluginName]
    if (legacyKey) {
      const parts = legacyKey.split('.')
      let obj: any = allConfig
      for (const p of parts) obj = obj?.[p]
      if (obj && typeof obj === 'object') return { ...obj }
    }
  } catch {
    // Gracefully degrade — return empty config
  }
  return {}
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
  core?: unknown
  log?: Logger
  settingsManager?: SettingsManager
  pluginRegistry?: PluginRegistry
}

export class LifecycleManager {
  readonly serviceRegistry: ServiceRegistry
  readonly middlewareChain: MiddlewareChain
  readonly errorTracker: ErrorTracker

  private eventBus: LifecycleManagerOpts['eventBus']
  private storagePath: string
  private sessions: unknown
  private config: unknown
  private core: unknown
  private log: Logger | undefined
  private settingsManager: SettingsManager | undefined
  private pluginRegistry: PluginRegistry | undefined

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
    this.core = opts?.core
    this.log = opts?.log
    this.settingsManager = opts?.settingsManager
    this.pluginRegistry = opts?.pluginRegistry
  }

  private getPluginLogger(pluginName: string): Logger {
    if (this.log && typeof (this.log as any).child === 'function') {
      return (this.log as any).child({ plugin: pluginName })
    }
    return this.log ?? { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this } } as Logger
  }

  async boot(plugins: OpenACPPlugin[]): Promise<void> {
    // Resolve load order via topological sort.
    // resolveLoadOrder will skip plugins whose dependencies are missing entirely
    // (not present in the input list). But we also need to handle runtime setup failures.
    // Include already-loaded plugins so dependency checks pass for late-booted plugins
    // (e.g., dev plugins booted after core plugins).
    const newNames = new Set(plugins.map(p => p.name))
    const allForResolution = [...this.loadOrder.filter(p => !newNames.has(p.name)), ...plugins]

    let sorted: OpenACPPlugin[]
    try {
      sorted = resolveLoadOrder(allForResolution)
    } catch (err) {
      // Circular dependency or other fatal error in resolution
      // Mark all as failed
      for (const p of plugins) {
        this._failed.add(p.name)
      }
      return
    }

    // Only boot new plugins (already-loaded ones were included just for dependency resolution)
    sorted = sorted.filter(p => newNames.has(p.name))

    // Append to existing loadOrder (don't overwrite — hot-reload boots single plugins)
    for (const p of sorted) {
      if (!this.loadOrder.some(existing => existing.name === p.name)) {
        this.loadOrder.push(p)
      } else {
        // Replace in-place (hot-reload case: plugin was unloaded then re-booted)
        const idx = this.loadOrder.findIndex(existing => existing.name === p.name)
        this.loadOrder[idx] = p
      }
    }

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

      // Check if disabled in registry
      const registryEntry = this.pluginRegistry?.get(plugin.name)
      if (registryEntry && registryEntry.enabled === false) {
        this.eventBus?.emit('plugin:disabled', { name: plugin.name })
        continue
      }

      // Check version mismatch → migrate
      if (registryEntry && plugin.migrate && registryEntry.version !== plugin.version && this.settingsManager) {
        try {
          const oldSettings = await this.settingsManager.loadSettings(plugin.name)
          const pluginLog = this.getPluginLogger(plugin.name)
          const migrateCtx: MigrateContext = {
            pluginName: plugin.name,
            settings: this.settingsManager.createAPI(plugin.name),
            log: pluginLog,
          }
          const newSettings = await plugin.migrate(migrateCtx, oldSettings, registryEntry.version)
          if (newSettings && typeof newSettings === 'object') {
            await migrateCtx.settings.setAll(newSettings as Record<string, unknown>)
          }
          this.pluginRegistry!.updateVersion(plugin.name, plugin.version)
          await this.pluginRegistry!.save()
        } catch (err) {
          this.getPluginLogger(plugin.name).warn(`Migration failed, continuing with old settings: ${err}`)
        }
      }

      // Resolve config: prefer settings.json, fallback to legacy
      let pluginConfig: Record<string, unknown>
      if (this.settingsManager) {
        pluginConfig = await this.settingsManager.loadSettings(plugin.name)
        if (Object.keys(pluginConfig).length === 0) {
          pluginConfig = resolvePluginConfig(plugin.name, this.config)
        }
      } else {
        pluginConfig = resolvePluginConfig(plugin.name, this.config)
      }

      // Create context for this plugin
      const ctx = createPluginContext({
        pluginName: plugin.name,
        pluginConfig,
        permissions: plugin.permissions ?? [],
        serviceRegistry: this.serviceRegistry,
        middlewareChain: this.middlewareChain,
        errorTracker: this.errorTracker,
        eventBus: this.eventBus!,
        storagePath: `${this.storagePath}/${plugin.name}`,
        sessions: this.sessions,
        config: this.config,
        core: this.core,
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
        this.getPluginLogger(plugin.name).error(`setup() failed: ${err}`)
        this.eventBus?.emit('plugin:failed', { name: plugin.name, error: String(err) })
      }
    }
  }

  async unloadPlugin(name: string): Promise<void> {
    if (!this._loaded.has(name)) return

    const plugin = this.loadOrder.find(p => p.name === name)

    if (plugin?.teardown) {
      try {
        await withTimeout(plugin.teardown(), TEARDOWN_TIMEOUT_MS, `${name}.teardown()`)
      } catch {
        // Swallow teardown errors
      }
    }

    const ctx = this.contexts.get(name)
    if (ctx) {
      ctx.cleanup()
      this.contexts.delete(name)
    }

    this._loaded.delete(name)
    this._failed.delete(name)
    this.loadOrder = this.loadOrder.filter(p => p.name !== name)

    this.eventBus?.emit('plugin:unloaded', { name })
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
