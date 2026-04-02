import { wantsHelp } from './helpers.js'
import { isJsonMode, jsonSuccess, jsonError, muteForJson, ErrorCodes } from '../output.js'
import path from 'node:path'
import os from 'node:os'

export async function cmdStop(args: string[] = [], instanceRoot?: string): Promise<void> {
  const json = isJsonMode(args)
  if (json) await muteForJson()

  const root = instanceRoot ?? path.join(os.homedir(), '.openacp')
  if (!json && wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp stop\x1b[0m — Stop the background daemon

\x1b[1mUsage:\x1b[0m
  openacp stop

Sends a stop signal to the running OpenACP daemon process.

\x1b[1mOptions:\x1b[0m
  --json          Output result as JSON
  -h, --help      Show this help message
`)
    return
  }
  const { stopDaemon, getPidPath } = await import('../daemon.js')
  const result = await stopDaemon(getPidPath(root), root)
  if (result.stopped) {
    if (json) jsonSuccess({ stopped: true, pid: result.pid })
    console.log(`OpenACP daemon stopped (was PID ${result.pid})`)
  } else {
    if (json) jsonError(ErrorCodes.DAEMON_NOT_RUNNING, result.error ?? 'Daemon is not running.')
    console.error(result.error)
    process.exit(1)
  }
}
