import { wantsHelp } from './helpers.js'

export async function cmdPlugins(args: string[] = []): Promise<void> {
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp plugins\x1b[0m — List installed plugins

\x1b[1mUsage:\x1b[0m
  openacp plugins

Shows all plugins registered in the plugin registry.
`)
    return
  }

  const os = await import('node:os')
  const path = await import('node:path')
  const { PluginRegistry } = await import('../../core/plugin/plugin-registry.js')

  const registryPath = path.join(os.homedir(), '.openacp', 'plugins.json')
  const registry = new PluginRegistry(registryPath)
  await registry.load()

  const plugins = registry.list()
  if (plugins.size === 0) {
    console.log("No plugins installed.")
  } else {
    console.log("Installed plugins:")
    for (const [name, entry] of plugins) {
      const status = entry.enabled ? '' : ' (disabled)'
      console.log(`  ${name}@${entry.version}${status}`)
    }
  }
}

/**
 * `openacp plugin <subcommand>` — Extended plugin management.
 *
 * Subcommands:
 *   list                — List all plugins with status (same as `openacp plugins`)
 *   add|install <pkg>   — Install a plugin package
 *   remove|uninstall    — Remove a plugin package (--purge to delete data)
 *   enable <name>       — Enable a plugin
 *   disable <name>      — Disable a plugin
 *   configure <name>    — Run interactive configuration for a plugin
 */
export async function cmdPlugin(args: string[] = []): Promise<void> {
  const subcommand = args[1] // args[0] is 'plugin'

  if (wantsHelp(args) || !subcommand) {
    console.log(`
\x1b[1mopenacp plugin\x1b[0m — Plugin management

\x1b[1mUsage:\x1b[0m
  openacp plugin list                    List all plugins with status
  openacp plugin search <query>          Search the plugin registry
  openacp plugin add <package>           Install a plugin package
  openacp plugin install <package>       Alias for add
  openacp plugin remove <package>        Remove a plugin package
  openacp plugin uninstall <package>     Alias for remove (--purge to delete data)
  openacp plugin enable <name>           Enable a plugin
  openacp plugin disable <name>          Disable a plugin
  openacp plugin configure <name>        Run interactive configuration
  openacp plugin create                  Scaffold a new plugin project

\x1b[1mExamples:\x1b[0m
  openacp plugin list
  openacp plugin search telegram
  openacp plugin add @openacp/adapter-discord
  openacp plugin enable @openacp/adapter-discord
  openacp plugin configure @openacp/adapter-discord
  openacp plugin remove @openacp/adapter-discord --purge
`)
    return
  }

  switch (subcommand) {
    case 'list':
      return cmdPlugins(args.slice(1))

    case 'search': {
      const { cmdPluginSearch } = await import('./plugin-search.js')
      await cmdPluginSearch(args.slice(2))
      return
    }

    case 'add':
    case 'install': {
      const pkg = args[2]
      if (!pkg) {
        console.error('Error: missing package name. Usage: openacp plugin add <package>')
        process.exit(1)
      }
      await installPlugin(pkg)
      return
    }

    case 'remove':
    case 'uninstall': {
      const pkg = args[2]
      if (!pkg) {
        console.error('Error: missing package name. Usage: openacp plugin remove <package> [--purge]')
        process.exit(1)
      }
      const purge = args.includes('--purge')
      await uninstallPlugin(pkg, purge)
      return
    }

    case 'enable': {
      const name = args[2]
      if (!name) {
        console.error('Error: missing plugin name. Usage: openacp plugin enable <name>')
        process.exit(1)
      }
      await setPluginEnabled(name, true)
      return
    }

    case 'disable': {
      const name = args[2]
      if (!name) {
        console.error('Error: missing plugin name. Usage: openacp plugin disable <name>')
        process.exit(1)
      }
      await setPluginEnabled(name, false)
      return
    }

    case 'configure': {
      const name = args[2]
      if (!name) {
        console.error('Error: missing plugin name. Usage: openacp plugin configure <name>')
        process.exit(1)
      }
      await configurePlugin(name)
      return
    }

    case 'create': {
      const { cmdPluginCreate } = await import('./plugin-create.js')
      await cmdPluginCreate()
      return
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`)
      console.error('Run "openacp plugin --help" for usage.')
      process.exit(1)
  }
}

async function setPluginEnabled(name: string, enabled: boolean): Promise<void> {
  const os = await import('node:os')
  const path = await import('node:path')
  const { PluginRegistry } = await import('../../core/plugin/plugin-registry.js')

  const registryPath = path.join(os.homedir(), '.openacp', 'plugins.json')
  const registry = new PluginRegistry(registryPath)
  await registry.load()

  const entry = registry.get(name)
  if (!entry) {
    console.error(`Plugin "${name}" not found. Run "openacp plugin list" to see installed plugins.`)
    process.exit(1)
  }

  registry.setEnabled(name, enabled)
  await registry.save()
  console.log(`Plugin ${name} ${enabled ? 'enabled' : 'disabled'}. Restart to apply.`)
}

async function configurePlugin(name: string): Promise<void> {
  const os = await import('node:os')
  const path = await import('node:path')
  const { corePlugins } = await import('../../plugins/core-plugins.js')
  const { SettingsManager } = await import('../../core/plugin/settings-manager.js')
  const { createInstallContext } = await import('../../core/plugin/install-context.js')

  const plugin = corePlugins.find(p => p.name === name)
  if (!plugin) {
    console.error(`Plugin "${name}" not found.`)
    process.exit(1)
  }

  const basePath = path.join(os.homedir(), '.openacp', 'plugins')
  const settingsManager = new SettingsManager(basePath)
  const ctx = createInstallContext({ pluginName: name, settingsManager, basePath })

  if (plugin.configure) {
    await plugin.configure(ctx)
  } else if (plugin.install) {
    await plugin.install(ctx)
  } else {
    console.log(`Plugin ${name} has no configure or install hook.`)
  }
}

async function installPlugin(pkg: string): Promise<void> {
  console.log(`Installing ${pkg}...`)

  // Try resolve from registry
  const { RegistryClient } = await import('../../core/plugin/registry-client.js')
  const client = new RegistryClient()
  try {
    const npmName = await client.resolve(pkg)
    if (npmName) {
      console.log(`Resolved from registry: ${pkg} → ${npmName}`)
      pkg = npmName  // use resolved npm name
    }
  } catch {
    // Registry unavailable, continue with original name
  }

  // Check if plugin is verified
  try {
    const registry = await client.getRegistry()
    const regPlugin = registry.plugins.find(p => p.npm === pkg || p.name === pkg)
    if (regPlugin && !regPlugin.verified) {
      console.log('⚠️  This plugin is not verified by the OpenACP team.')
    }
  } catch { /* ignore */ }

  // Check if it's a built-in plugin
  const { corePlugins } = await import('../../plugins/core-plugins.js')
  const plugin = corePlugins.find(p => p.name === pkg)

  if (!plugin) {
    console.error(`Plugin "${pkg}" not found. Community plugin install coming soon.`)
    return
  }

  if (plugin.install) {
    const os = await import('node:os')
    const path = await import('node:path')
    const { SettingsManager } = await import('../../core/plugin/settings-manager.js')
    const { createInstallContext } = await import('../../core/plugin/install-context.js')
    const { PluginRegistry } = await import('../../core/plugin/plugin-registry.js')

    const basePath = path.join(os.homedir(), '.openacp', 'plugins')
    const settingsManager = new SettingsManager(basePath)
    const registryPath = path.join(os.homedir(), '.openacp', 'plugins.json')
    const registry = new PluginRegistry(registryPath)
    await registry.load()

    const ctx = createInstallContext({ pluginName: plugin.name, settingsManager, basePath })
    await plugin.install(ctx)

    registry.register(plugin.name, {
      version: plugin.version,
      source: 'builtin',
      enabled: true,
      settingsPath: settingsManager.getSettingsPath(plugin.name),
      description: plugin.description,
    })
    await registry.save()

    console.log(`Plugin ${plugin.name} installed! Restart to activate.`)
  } else {
    console.log(`Plugin ${plugin.name} has no install hook. Nothing to do.`)
  }
}

async function uninstallPlugin(name: string, purge: boolean): Promise<void> {
  const os = await import('node:os')
  const path = await import('node:path')
  const fs = await import('node:fs')
  const { PluginRegistry } = await import('../../core/plugin/plugin-registry.js')

  const registryPath = path.join(os.homedir(), '.openacp', 'plugins.json')
  const registry = new PluginRegistry(registryPath)
  await registry.load()

  const entry = registry.get(name)
  if (!entry) {
    console.error(`Plugin "${name}" not installed.`)
    process.exit(1)
  }

  if (entry.source === 'builtin') {
    console.error(`Cannot uninstall built-in plugin. Use "openacp plugin disable ${name}" instead.`)
    process.exit(1)
  }

  // Try to call uninstall hook
  try {
    const { corePlugins } = await import('../../plugins/core-plugins.js')
    const plugin = corePlugins.find(p => p.name === name)
    if (plugin?.uninstall) {
      const { SettingsManager } = await import('../../core/plugin/settings-manager.js')
      const { createInstallContext } = await import('../../core/plugin/install-context.js')
      const basePath = path.join(os.homedir(), '.openacp', 'plugins')
      const settingsManager = new SettingsManager(basePath)
      const ctx = createInstallContext({ pluginName: name, settingsManager, basePath })
      await plugin.uninstall(ctx, { purge })
    }
  } catch {
    // Plugin module might not be loadable, continue
  }

  if (purge) {
    const pluginDir = path.join(os.homedir(), '.openacp', 'plugins', name)
    fs.rmSync(pluginDir, { recursive: true, force: true })
  }

  registry.remove(name)
  await registry.save()
  console.log(`Plugin ${name} uninstalled${purge ? ' (purged)' : ''}.`)
}
