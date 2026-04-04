import { checkAndPromptUpdate } from '../version.js'
import { printHelp } from './help.js'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createInstanceContext, getGlobalRoot } from '../../core/instance/instance-context.js'
import { InstanceRegistry } from '../../core/instance/instance-registry.js'
import { randomUUID } from 'node:crypto'
import { printInstanceHint } from '../instance-hint.js'
import { isJsonMode, jsonSuccess, jsonError, muteForJson, ErrorCodes } from '../output.js'

export async function cmdDefault(command: string | undefined, instanceRoot?: string): Promise<void> {
  const args = command ? [command] : []
  const json = isJsonMode(args)
  if (json) await muteForJson()

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
      'attach',
    ]
    const suggestion = suggestMatch(command, topLevelCommands)
    console.error(`Unknown command: ${command}`)
    if (suggestion) console.error(`Did you mean: ${suggestion}?`)
    printHelp()
    process.exit(1)
  }

  await checkAndPromptUpdate()

  const { ConfigManager } = await import('../../core/config/config.js')
  const configPath = path.join(root, 'config.json')
  const cm = new ConfigManager(configPath)

  // If no config, run setup first
  if (!(await cm.exists())) {
    const { SettingsManager } = await import('../../core/plugin/settings-manager.js')
    const { PluginRegistry } = await import('../../core/plugin/plugin-registry.js')
    const settingsManager = new SettingsManager(pluginsDataDir)
    const pluginRegistry = new PluginRegistry(registryPath)
    await pluginRegistry.load()

    const { runSetup } = await import('../../core/setup/index.js')
    const shouldStart = await runSetup(cm, { settingsManager, pluginRegistry, instanceRoot: root })
    if (!shouldStart) process.exit(0)
  }

  await cm.load()
  const config = cm.get()

  // Check if daemon is already running before trying to start
  if (!forceForeground && config.runMode === 'daemon') {
    const { isProcessRunning, getPidPath, startDaemon } = await import('../daemon.js')
    const pidPath = getPidPath(root)

    if (isProcessRunning(pidPath)) {
      await showAlreadyRunningMenu(root)
      return
    }

    const result = startDaemon(pidPath, config.logging.logDir, root)
    if ('error' in result) {
      if (json) jsonError(ErrorCodes.DAEMON_NOT_RUNNING, result.error)
      console.error(result.error)
      process.exit(1)
    }
    if (json) {
      // Resolve instanceId from registry if available
      let instanceId: string = path.basename(root)
      try {
        const reg = new InstanceRegistry(path.join(getGlobalRoot(), 'instances.json'))
        reg.load()
        const entry = reg.getByRoot(root)
        if (entry) instanceId = entry.id
      } catch {}
      // Try to read actual port from api.port file written by the server after startup
      let port: number | null = null
      try {
        const portStr = fs.readFileSync(path.join(root, 'api.port'), 'utf-8').trim()
        port = parseInt(portStr) || null
      } catch {
        port = config.api.port ?? null
      }
      jsonSuccess({
        pid: result.pid,
        instanceId,
        name: config.instanceName ?? null,
        directory: path.dirname(root),
        dir: root,
        port,
      })
    }
    printInstanceHint(root)
    console.log(`OpenACP daemon started (PID ${result.pid})`)
    return
  }

  const { markRunning } = await import('../daemon.js')
  markRunning(root)
  printInstanceHint(root)
  const { startServer } = await import('../../main.js')
  const reg = new InstanceRegistry(path.join(getGlobalRoot(), 'instances.json'))
  reg.load()
  const existingEntry = reg.getByRoot(root)
  const instanceId = existingEntry?.id ?? randomUUID()
  const ctx = createInstanceContext({
    id: instanceId,
    root,
    isGlobal: root === getGlobalRoot(),
  })

  if (json) {
    // For foreground mode, output JSON before starting the server
    let port: number | null = null
    try {
      const portStr = fs.readFileSync(path.join(root, 'api.port'), 'utf-8').trim()
      port = parseInt(portStr) || null
    } catch {
      port = config.api.port ?? null
    }
    jsonSuccess({
      pid: process.pid,
      instanceId,
      name: config.instanceName ?? null,
      directory: path.dirname(root),
      dir: root,
      port,
    })
  }

  await startServer({ instanceContext: ctx })
}

async function showAlreadyRunningMenu(root: string): Promise<void> {
  const { formatInstanceStatus } = await import('./status.js')

  console.log('')
  console.log('\x1b[1mOpenACP is already running\x1b[0m')
  console.log('')

  const status = formatInstanceStatus(root)
  if (status) {
    for (const line of status.lines) {
      console.log(line)
    }
    console.log('')
  }

  // TTY: interactive menu
  const { showInteractiveMenu } = await import('../interactive-menu.js')

  // Options ordered for two-column layout: r/f, s/l, q
  const shown = await showInteractiveMenu([
    {
      key: 'r', label: 'Restart',
      action: async () => {
        const { cmdRestart } = await import('./restart.js')
        await cmdRestart([], root)
      },
    },
    {
      key: 's', label: 'Stop',
      action: async () => {
        const { cmdStop } = await import('./stop.js')
        await cmdStop([], root)
      },
    },
    {
      key: 'q', label: 'Quit',
      action: () => { /* exit naturally */ },
    },
    {
      key: 'f', label: 'Restart in foreground',
      action: async () => {
        const { cmdRestart } = await import('./restart.js')
        await cmdRestart(['--foreground'], root)
      },
    },
    {
      key: 'l', label: 'View logs',
      action: async () => {
        const { cmdLogs } = await import('./logs.js')
        await cmdLogs([], root)
      },
    },
  ])

  // Non-TTY: print suggestions and exit
  if (!shown) {
    console.log('  Use: openacp restart | openacp stop | openacp logs')
    console.log('')
  }
}
