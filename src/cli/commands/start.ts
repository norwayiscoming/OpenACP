import { checkAndPromptUpdate } from '../version.js'
import { wantsHelp } from './helpers.js'
import { isJsonMode, jsonSuccess, jsonError, muteForJson, ErrorCodes } from '../output.js'
import { printInstanceHint } from '../instance-hint.js'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

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
    if (json) {
      // Resolve instanceId from registry if available
      let instanceId: string = path.basename(root)
      try {
        const { getGlobalRoot } = await import('../../core/instance/instance-context.js')
        const { InstanceRegistry } = await import('../../core/instance/instance-registry.js')
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
        // Fall back to configured port
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
  } else {
    if (json) jsonError(ErrorCodes.CONFIG_NOT_FOUND, 'No config found. Run "openacp" first to set up.')
    console.error('No config found. Run "openacp" first to set up.')
    process.exit(1)
  }
}
