import { checkAndPromptUpdate } from '../version.js'
import { wantsHelp } from './helpers.js'
import { isJsonMode, jsonSuccess, jsonError, muteForJson, ErrorCodes } from '../output.js'
import { printInstanceHint } from '../instance-hint.js'
import path from 'node:path'
import os from 'node:os'

export async function cmdStart(args: string[] = [], instanceRoot?: string): Promise<void> {
  const json = isJsonMode(args)
  if (json) await muteForJson()

  const root = instanceRoot ?? path.join(os.homedir(), '.openacp')
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
  const { startDaemon, getPidPath } = await import('../daemon.js')
  const { ConfigManager } = await import('../../core/config/config.js')
  const cm = new ConfigManager(path.join(root, 'config.json'))
  if (await cm.exists()) {
    await cm.load()
    const config = cm.get()
    const result = startDaemon(getPidPath(root), config.logging.logDir, root)
    if ('error' in result) {
      if (json) jsonError(ErrorCodes.DAEMON_NOT_RUNNING, result.error)
      console.error(result.error)
      process.exit(1)
    }
    if (json) jsonSuccess({ pid: result.pid, instanceId: path.basename(root), dir: root })
    printInstanceHint(root)
    console.log(`OpenACP daemon started (PID ${result.pid})`)
  } else {
    if (json) jsonError(ErrorCodes.CONFIG_NOT_FOUND, 'No config found. Run "openacp" first to set up.')
    console.error('No config found. Run "openacp" first to set up.')
    process.exit(1)
  }
}
