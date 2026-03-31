import { wantsHelp } from './helpers.js'
import path from 'node:path'
import os from 'node:os'

export async function cmdRestart(args: string[] = [], instanceRoot?: string): Promise<void> {
  const root = instanceRoot ?? path.join(os.homedir(), '.openacp')
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp restart\x1b[0m — Restart the background daemon

\x1b[1mUsage:\x1b[0m
  openacp restart

Stops the running daemon (if any) and starts a new one.

\x1b[1mSee also:\x1b[0m
  openacp start       Start the daemon
  openacp stop        Stop the daemon
  openacp status      Check if daemon is running
`)
    return
  }

  const { stopDaemon, startDaemon, getPidPath } = await import('../daemon.js')
  const { ConfigManager } = await import('../../core/config/config.js')
  const { checkAndPromptUpdate } = await import('../version.js')

  await checkAndPromptUpdate()

  const pidPath = getPidPath(root)

  // Stop existing daemon (ignore errors — it may not be running)
  const stopResult = await stopDaemon(pidPath, root)
  if (stopResult.stopped) {
    console.log(`Stopped daemon (was PID ${stopResult.pid})`)
  }

  // Start new daemon
  const cm = new ConfigManager()
  if (await cm.exists()) {
    await cm.load()
    const config = cm.get()
    const result = startDaemon(pidPath, config.logging.logDir, root)
    if ('error' in result) {
      console.error(result.error)
      process.exit(1)
    }
    console.log(`OpenACP daemon started (PID ${result.pid})`)
  } else {
    console.error('No config found. Run "openacp" first to set up.')
    process.exit(1)
  }
}
