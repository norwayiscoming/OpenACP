import { wantsHelp } from './helpers.js'

export async function cmdLogs(args: string[] = [], instanceRoot?: string): Promise<void> {
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp logs\x1b[0m — Tail daemon log file

\x1b[1mUsage:\x1b[0m
  openacp logs

Streams the last 50 lines of the OpenACP log file and
follows new output (like tail -f). Press Ctrl+C to stop.

Log file location is configured in config (default: ~/.openacp/logs/).
`)
    return
  }
  const { spawn } = await import('node:child_process')
  const { ConfigManager, expandHome } = await import('../../core/config/config.js')
  const pathMod = await import('node:path')
  const configPath = instanceRoot ? pathMod.join(instanceRoot, 'config.json') : undefined
  const cm = new ConfigManager(configPath)
  let logDir = instanceRoot ? pathMod.join(instanceRoot, 'logs') : '~/.openacp/logs'
  if (await cm.exists()) {
    await cm.load()
    logDir = cm.get().logging.logDir
  }
  const logFile = pathMod.join(expandHome(logDir), 'openacp.log')
  const tail = spawn('tail', ['-f', '-n', '50', logFile], { stdio: 'inherit' })
  tail.on('error', (err: Error) => {
    console.error(`Cannot tail log file: ${err.message}`)
    process.exit(1)
  })
}
