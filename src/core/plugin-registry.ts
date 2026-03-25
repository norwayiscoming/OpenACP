import { createChildLogger } from "./log.js";
import type {
  CorePlugin,
  PluginAPI,
  PluginCommand,
  PluginAdapterCommand,
  PluginContext,
  PromptPayload,
  SessionRecord,
} from "./plugin-types.js";
import type { OpenACPCore } from "./core.js";
import type { Session } from "./session.js";
import { loadCorePlugin } from "./plugin-manager.js";
import { listPlugins } from "./plugin-manager.js";

const log = createChildLogger({ module: "plugin-registry" });

interface RegisteredPlugin {
  plugin: CorePlugin;
  api: PluginAPI;
}

export class PluginRegistry {
  private plugins: Map<string, RegisteredPlugin> = new Map();
  private loadOrder: string[] = [];

  /** Load all core plugins from ~/.openacp/plugins/ and register them */
  async loadAll(core: OpenACPCore): Promise<void> {
    const installed = listPlugins();
    const discovered: CorePlugin[] = [];

    for (const packageName of Object.keys(installed)) {
      const plugin = await loadCorePlugin(packageName);
      if (plugin) {
        discovered.push(plugin);
      }
    }

    if (discovered.length === 0) {
      log.debug("No core plugins found");
      return;
    }

    // Topological sort by dependencies
    const sorted = this.topologicalSort(discovered);

    // Register in order
    for (const plugin of sorted) {
      try {
        await this.register(plugin, core);
      } catch (err) {
        log.error({ plugin: plugin.name, err }, "Failed to register plugin, skipping");
      }
    }
  }

  /** Register a single core plugin */
  async register(plugin: CorePlugin, core: OpenACPCore): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      log.warn({ plugin: plugin.name }, "Plugin already registered, skipping");
      return;
    }

    // Check dependencies
    for (const dep of plugin.dependencies ?? []) {
      if (!this.plugins.has(dep)) {
        throw new Error(
          `Plugin '${plugin.name}' requires '${dep}' which is not loaded`,
        );
      }
    }

    // Validate plugin config if schema provided
    let pluginConfig: unknown = undefined;
    if (plugin.configSchema) {
      const rawConfig = (core.configManager.get() as Record<string, unknown>)[
        plugin.name
      ];
      const result = plugin.configSchema.safeParse(rawConfig ?? {});
      if (!result.success) {
        log.error(
          { plugin: plugin.name, errors: result.error.issues },
          "Plugin config validation failed",
        );
        throw new Error(
          `Config validation failed for plugin '${plugin.name}': ${result.error.message}`,
        );
      }
      pluginConfig = result.data;
    }

    // Build PluginAPI
    const pluginLog = createChildLogger({ module: `plugin:${plugin.name}` });
    const api: PluginAPI = {
      core,
      config: pluginConfig,
      log: pluginLog,
      sessionManager: core.sessionManager,
      adapters: core.adapters,
      configManager: core.configManager,
      eventBus: core.eventBus,
      createSession: core.createSession.bind(core),
      resolveWorkspace: (p?: string) => core.configManager.resolveWorkspace(p),
      agentCatalog: core.agentCatalog,
    };

    // Call register
    await plugin.register(api);

    this.plugins.set(plugin.name, { plugin, api });
    this.loadOrder.push(plugin.name);
    log.info(
      { plugin: plugin.name, version: plugin.version },
      "Core plugin loaded",
    );
  }

  /** Unregister all plugins in reverse load order */
  async unregisterAll(): Promise<void> {
    const reversed = [...this.loadOrder].reverse();
    for (const name of reversed) {
      const entry = this.plugins.get(name);
      if (entry?.plugin.unregister) {
        try {
          await entry.plugin.unregister();
          log.info({ plugin: name }, "Plugin unregistered");
        } catch (err) {
          log.error({ plugin: name, err }, "Error unregistering plugin");
        }
      }
    }
    this.plugins.clear();
    this.loadOrder = [];
  }

  /** Get a registered plugin by name */
  get(name: string): CorePlugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  /** List all registered plugin names */
  list(): string[] {
    return [...this.loadOrder];
  }

  // --- Hook Dispatch ---

  async dispatchSessionCreated(session: Session): Promise<void> {
    for (const name of this.loadOrder) {
      const entry = this.plugins.get(name)!;
      const hook = entry.plugin.sessionHooks?.onSessionCreated;
      if (hook) {
        try {
          await hook(session, this.buildContext(entry));
        } catch (err) {
          log.error({ plugin: name, sessionId: session.id, err }, "onSessionCreated hook error");
        }
      }
    }
  }

  async dispatchSessionResumed(
    session: Session,
    record: SessionRecord,
  ): Promise<void> {
    for (const name of this.loadOrder) {
      const entry = this.plugins.get(name)!;
      const hook = entry.plugin.sessionHooks?.onSessionResumed;
      if (hook) {
        try {
          await hook(session, record, this.buildContext(entry));
        } catch (err) {
          log.error({ plugin: name, sessionId: session.id, err }, "onSessionResumed hook error");
        }
      }
    }
  }

  async dispatchBeforePrompt(
    session: Session,
    payload: PromptPayload,
  ): Promise<PromptPayload> {
    let current = payload;
    for (const name of this.loadOrder) {
      const entry = this.plugins.get(name)!;
      const hook = entry.plugin.sessionHooks?.onBeforePrompt;
      if (hook) {
        try {
          current = await hook(session, current, this.buildContext(entry));
        } catch (err) {
          log.error({ plugin: name, sessionId: session.id, err }, "onBeforePrompt hook error");
        }
      }
    }
    return current;
  }

  async dispatchAfterPrompt(session: Session): Promise<void> {
    for (const name of this.loadOrder) {
      const entry = this.plugins.get(name)!;
      const hook = entry.plugin.sessionHooks?.onAfterPrompt;
      if (hook) {
        try {
          await hook(session, this.buildContext(entry));
        } catch (err) {
          log.error({ plugin: name, sessionId: session.id, err }, "onAfterPrompt hook error");
        }
      }
    }
  }

  async dispatchSessionEnd(session: Session, reason: string): Promise<void> {
    for (const name of this.loadOrder) {
      const entry = this.plugins.get(name)!;
      const hook = entry.plugin.sessionHooks?.onSessionEnd;
      if (hook) {
        try {
          await hook(session, reason, this.buildContext(entry));
        } catch (err) {
          log.error({ plugin: name, sessionId: session.id, err }, "onSessionEnd hook error");
        }
      }
    }
  }

  // --- Command Lookup ---

  /** Get all generic commands across all plugins */
  getAllCommands(): PluginCommand[] {
    const commands: PluginCommand[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.plugin.commands) {
        commands.push(...entry.plugin.commands);
      }
    }
    return commands;
  }

  /** Get adapter-specific commands for a given channel name */
  getAdapterCommands(channelName: string): PluginAdapterCommand[] {
    const commands: PluginAdapterCommand[] = [];
    for (const entry of this.plugins.values()) {
      const adapterCmds = entry.plugin.adapterCommands?.[channelName];
      if (adapterCmds) {
        commands.push(...adapterCmds);
      }
    }
    return commands;
  }

  // --- Internals ---

  private buildContext(entry: RegisteredPlugin): PluginContext {
    return {
      pluginName: entry.plugin.name,
      log: entry.api.log,
    };
  }

  private topologicalSort(plugins: CorePlugin[]): CorePlugin[] {
    const byName = new Map(plugins.map((p) => [p.name, p]));
    const visited = new Set<string>();
    const result: CorePlugin[] = [];

    const visit = (name: string, stack: Set<string>) => {
      if (visited.has(name)) return;
      if (stack.has(name)) {
        throw new Error(
          `Circular plugin dependency detected: ${[...stack, name].join(" → ")}`,
        );
      }

      const plugin = byName.get(name);
      if (!plugin) return; // dependency not in discovered set — will fail at register time

      stack.add(name);
      for (const dep of plugin.dependencies ?? []) {
        visit(dep, stack);
      }
      stack.delete(name);

      visited.add(name);
      result.push(plugin);
    };

    for (const plugin of plugins) {
      visit(plugin.name, new Set());
    }

    return result;
  }
}
