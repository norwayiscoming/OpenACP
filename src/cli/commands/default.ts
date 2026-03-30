import { checkAndPromptUpdate } from '../version.js'
import { printHelp } from './help.js'
import path from 'node:path'
import os from 'node:os'
import { createInstanceContext, getGlobalRoot } from '../../core/instance-context.js'

export async function cmdDefault(command: string | undefined, instanceRoot?: string): Promise<void> {
  const root = instanceRoot ?? path.join(os.homedir(), '.openacp')
  const pluginsDataDir = path.join(root, 'plugins', 'data')
  const registryPath = path.join(root, 'plugins.json')
  const forceForeground = command === '--foreground'

  // Reject unknown commands
  if (command && !command.startsWith('-')) {
    const { suggestMatch } = await import('../suggest.js')
    const topLevelCommands = [
      'start', 'stop', 'status', 'logs', 'config', 'reset', 'update',
      'install', 'uninstall', 'plugins', 'plugin', 'api', 'adopt', 'integrate', 'doctor', 'agents', 'onboard',
    ]
    const suggestion = suggestMatch(command, topLevelCommands)
    console.error(`Unknown command: ${command}`)
    if (suggestion) console.error(`Did you mean: ${suggestion}?`)
    printHelp()
    process.exit(1)
  }

  await checkAndPromptUpdate()

  const { ConfigManager } = await import('../../core/config/config.js')
  const cm = new ConfigManager()

  // If no config, run setup first
  if (!(await cm.exists())) {
    const { SettingsManager } = await import('../../core/plugin/settings-manager.js')
    const { PluginRegistry } = await import('../../core/plugin/plugin-registry.js')
    const settingsManager = new SettingsManager(pluginsDataDir)
    const pluginRegistry = new PluginRegistry(registryPath)
    await pluginRegistry.load()

    const { runSetup } = await import('../../core/setup/index.js')
    const shouldStart = await runSetup(cm, { settingsManager, pluginRegistry })
    if (!shouldStart) process.exit(0)
  }

  await cm.load()
  const config = cm.get()

  if (!forceForeground && config.runMode === 'daemon') {
    const { startDaemon, getPidPath } = await import('../daemon.js')
    const result = startDaemon(getPidPath(root), config.logging.logDir, root)
    if ('error' in result) {
      console.error(result.error)
      process.exit(1)
    }
    console.log(`OpenACP daemon started (PID ${result.pid})`)
    return
  }

  const { markRunning } = await import('../daemon.js')
  markRunning(root)
  const { startServer } = await import('../../main.js')
  const ctx = createInstanceContext({
    id: 'default',
    root,
    isGlobal: root === getGlobalRoot(),
  })
  await startServer({ instanceContext: ctx })
}
