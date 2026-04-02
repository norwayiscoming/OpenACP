import { wantsHelp } from './helpers.js'
import { isJsonMode, jsonSuccess, jsonError, muteForJson, ErrorCodes } from '../output.js'
import { printInstanceHint } from '../instance-hint.js'
import path from 'node:path'
import os from 'node:os'
import { createInstanceContext, getGlobalRoot } from '../../core/instance/instance-context.js'

export async function cmdRestart(args: string[] = [], instanceRoot?: string): Promise<void> {
  const json = isJsonMode(args)
  if (json) await muteForJson()

  const root = instanceRoot ?? path.join(os.homedir(), '.openacp')
  if (!json && wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp restart\x1b[0m — Restart the background daemon

\x1b[1mUsage:\x1b[0m
  openacp restart
  openacp restart --foreground    Restart in foreground mode
  openacp restart --daemon        Restart as background daemon

Stops the running daemon (if any) and starts a new one.

\x1b[1mOptions:\x1b[0m
  --json          Output result as JSON
  -h, --help      Show this help message

\x1b[1mSee also:\x1b[0m
  openacp start       Start the daemon
  openacp stop        Stop the daemon
  openacp status      Check if daemon is running
`)
    return
  }

  const forceForeground = args.includes('--foreground')
  const forceDaemon = args.includes('--daemon')

  const { stopDaemon, startDaemon, getPidPath, markRunning } = await import('../daemon.js')
  const { ConfigManager } = await import('../../core/config/config.js')
  const { checkAndPromptUpdate } = await import('../version.js')

  await checkAndPromptUpdate()

  const pidPath = getPidPath(root)

  // Stop existing daemon (ignore errors — it may not be running)
  const stopResult = await stopDaemon(pidPath, root)
  if (stopResult.stopped) {
    console.log(`Stopped daemon (was PID ${stopResult.pid})`)
  }

  const cm = new ConfigManager()
  if (!(await cm.exists())) {
    if (json) jsonError(ErrorCodes.CONFIG_NOT_FOUND, 'No config found. Run "openacp" first to set up.')
    console.error('No config found. Run "openacp" first to set up.')
    process.exit(1)
  }

  await cm.load()
  const config = cm.get()

  // Determine mode: explicit flag > config; --json always uses daemon mode
  const useForeground = json ? false : (forceForeground || (!forceDaemon && config.runMode !== 'daemon'))

  if (useForeground) {
    markRunning(root)
    printInstanceHint(root)
    console.log('Starting in foreground mode...')
    const { startServer } = await import('../../main.js')
    const ctx = createInstanceContext({
      id: 'default',
      root,
      isGlobal: root === getGlobalRoot(),
    })
    await startServer({ instanceContext: ctx })
  } else {
    const result = startDaemon(pidPath, config.logging.logDir, root)
    if ('error' in result) {
      if (json) jsonError(ErrorCodes.DAEMON_NOT_RUNNING, result.error)
      console.error(result.error)
      process.exit(1)
    }
    if (json) jsonSuccess({ pid: result.pid, instanceId: path.basename(root), dir: root })
    printInstanceHint(root)
    console.log(`OpenACP daemon started (PID ${result.pid})`)
  }
}
