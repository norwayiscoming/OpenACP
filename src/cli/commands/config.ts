import { readApiPort, apiCall } from '../api-client.js'
import { wantsHelp, buildNestedUpdateFromPath } from './helpers.js'

export async function cmdConfig(args: string[] = []): Promise<void> {
  const subCmd = args[1] // 'set' or undefined

  if (wantsHelp(args) && subCmd === 'set') {
    console.log(`
\x1b[1mopenacp config set\x1b[0m — Set a config value directly

\x1b[1mUsage:\x1b[0m
  openacp config set <key> <value>

\x1b[1mArguments:\x1b[0m
  <key>           Dot-notation config path (e.g. telegram.botToken)
  <value>         New value (JSON-parsed if possible, otherwise string)

\x1b[1mOptions:\x1b[0m
  -h, --help      Show this help message

Works with both running and stopped daemon. When running, uses
the API for live updates. When stopped, edits config file directly.

\x1b[1mExamples:\x1b[0m
  openacp config set defaultAgent claude
  openacp config set security.maxConcurrentSessions 5
  openacp config set telegram.botToken "123:ABC"
`)
    return
  }

  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp config\x1b[0m — View and edit configuration

\x1b[1mUsage:\x1b[0m
  openacp config                       Open interactive config editor
  openacp config set <key> <value>     Set a config value directly

\x1b[1mOptions:\x1b[0m
  -h, --help                           Show this help message

Works with both running and stopped daemon. When running, uses
the API for live updates. When stopped, edits config file directly.

\x1b[1mExamples:\x1b[0m
  openacp config
  openacp config set defaultAgent claude

\x1b[2mRun 'openacp config set --help' for more info on the set subcommand.\x1b[0m
`)
    return
  }

  if (subCmd === 'set') {
    // Non-interactive: openacp config set <key> <value>
    const configPath = args[2]
    const configValue = args[3]
    if (!configPath || configValue === undefined) {
      console.error('Usage: openacp config set <path> <value>')
      process.exit(1)
    }

    // Validate top-level config key
    const { ConfigSchema } = await import('../../core/config/config.js')
    const topLevelKey = configPath.split('.')[0]
    const validConfigKeys = Object.keys(ConfigSchema.shape)
    if (!validConfigKeys.includes(topLevelKey)) {
      const { suggestMatch } = await import('../suggest.js')
      const suggestion = suggestMatch(topLevelKey, validConfigKeys)
      console.error(`Unknown config key: ${topLevelKey}`)
      if (suggestion) console.error(`Did you mean: ${suggestion}?`)
      process.exit(1)
    }

    let value: unknown = configValue
    try { value = JSON.parse(configValue) } catch { /* keep as string */ }

    const port = readApiPort()
    if (port !== null) {
      // Server running — use API
      const res = await apiCall(port, '/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: configPath, value }),
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log(`Config updated: ${configPath} = ${JSON.stringify(value)}`)
      if (data.needsRestart) {
        console.log('Note: restart required for this change to take effect.')
      }
    } else {
      // Server not running — update file directly
      const { ConfigManager } = await import('../../core/config/config.js')
      const cm = new ConfigManager()
      if (!(await cm.exists())) {
        console.error('No config found. Run "openacp" first to set up.')
        process.exit(1)
      }
      await cm.load()
      const updates = buildNestedUpdateFromPath(configPath, value)
      await cm.save(updates)
      console.log(`Config updated: ${configPath} = ${JSON.stringify(value)}`)
    }
    return
  }

  // Interactive editor
  const { runConfigEditor } = await import('../../core/config/config-editor.js')
  const { ConfigManager } = await import('../../core/config/config.js')
  const cm = new ConfigManager()
  if (!(await cm.exists())) {
    console.error('No config found. Run "openacp" first to set up.')
    process.exit(1)
  }

  const port = readApiPort()
  if (port !== null) {
    await runConfigEditor(cm, 'api', port)
  } else {
    await runConfigEditor(cm, 'file')
  }
}
