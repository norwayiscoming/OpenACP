import { checkAndPromptUpdate } from '../version.js'
import { wantsHelp } from './helpers.js'
import { isJsonMode, jsonSuccess, jsonError, muteForJson, ErrorCodes } from '../output.js'
import { printInstanceHint } from '../instance-hint.js'
import { resolveInstanceId } from '../resolve-instance-id.js'
import path from 'node:path'

export async function cmdStart(args: string[] = [], instanceRoot?: string): Promise<void> {
  const json = isJsonMode(args)
  if (json) await muteForJson()

  const root = instanceRoot!
  if (!json && wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp start\x1b[0m — Start OpenACP as a background daemon

\x1b[1mUsage:\x1b[0m
  openacp start

Starts the server as a background process (daemon mode).
Requires an existing config — run 'openacp' first to set up.

\x1b[1mOptions:\x1b[0m
  --json          Output result as JSON
  -h, --help      Show this help message

\x1b[1mSee also:\x1b[0m
  openacp stop       Stop the daemon
  openacp restart    Restart the daemon
  openacp status     Check if daemon is running
  openacp logs       Tail daemon log file
`)
    return
  }
  await checkAndPromptUpdate()
  const { startDaemon, getPidPath, isProcessRunning } = await import('../daemon.js')
  const { ConfigManager } = await import('../../core/config/config.js')
  const cm = new ConfigManager(path.join(root, 'config.json'))
  if (await cm.exists()) {
    await cm.load()
    const config = cm.get()
    const pidPath = getPidPath(root)
    if (isProcessRunning(pidPath)) {
      if (json) jsonError(ErrorCodes.DAEMON_NOT_RUNNING, 'Daemon is already running. Use "openacp restart" to restart it.')
      console.error('OpenACP daemon is already running. Use "openacp restart" to restart it.')
      process.exit(1)
    }
    const result = startDaemon(pidPath, config.logging.logDir, root)
    if ('error' in result) {
      if (json) jsonError(ErrorCodes.DAEMON_NOT_RUNNING, result.error)
      console.error(result.error)
      process.exit(1)
    }
    // Install autostart before JSON output (jsonSuccess exits)
    const instanceId = resolveInstanceId(root)
    try {
      const { installAutoStart } = await import('../autostart.js')
      const autoResult = installAutoStart(config.logging.logDir, root, instanceId)
      if (!autoResult.success) console.warn(`Warning: auto-start not enabled: ${autoResult.error}`)
    } catch (e) { console.warn(`Warning: auto-start not enabled: ${(e as Error).message}`) }

    if (json) {
      // Wait for the daemon to write api.port (up to 5 seconds)
      const { waitForPortFile } = await import('../api-client.js')
      const port = await waitForPortFile(path.join(root, 'api.port')) ?? 21420
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
  } else {
    if (json) jsonError(ErrorCodes.CONFIG_NOT_FOUND, 'No config found. Run "openacp" first to set up.')
    console.error('No config found. Run "openacp" first to set up.')
    process.exit(1)
  }
}
