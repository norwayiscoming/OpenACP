import { wantsHelp } from './helpers.js'
import path from 'node:path'
import os from 'node:os'

export async function cmdStop(args: string[] = [], instanceRoot?: string): Promise<void> {
  const root = instanceRoot ?? path.join(os.homedir(), '.openacp')
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp stop\x1b[0m — Stop the background daemon

\x1b[1mUsage:\x1b[0m
  openacp stop

Sends a stop signal to the running OpenACP daemon process.
`)
    return
  }
  const { stopDaemon, getPidPath } = await import('../daemon.js')
  const result = await stopDaemon(getPidPath(root), root)
  if (result.stopped) {
    console.log(`OpenACP daemon stopped (was PID ${result.pid})`)
  } else {
    console.error(result.error)
    process.exit(1)
  }
}
