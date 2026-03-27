import { readApiPort, removeStalePortFile, apiCall } from '../api-client.js'
import { wantsHelp } from './helpers.js'

function printApiHelp(): void {
  console.log(`
\x1b[1mopenacp api\x1b[0m — Interact with the running OpenACP daemon

\x1b[1mUsage:\x1b[0m
  openacp api <command> [options]

\x1b[1mRequires a running daemon.\x1b[0m Start with: openacp start

\x1b[1mSession Commands:\x1b[0m
  openacp api status                       Show active sessions
  openacp api session <id>                 Show session details
  openacp api new [agent] [workspace]      Create a new session
                                           [--channel <id>]
  openacp api send <id> <prompt>           Send prompt to session
  openacp api cancel <id>                  Cancel a session
  openacp api dangerous <id> on|off        Toggle dangerous mode

\x1b[1mTopic Commands:\x1b[0m
  openacp api topics [--status s1,s2]      List topics
  openacp api delete-topic <id> [--force]  Delete a topic
  openacp api cleanup [--status s1,s2]     Cleanup finished topics

\x1b[1mSystem Commands:\x1b[0m
  openacp api health                       Show system health
  openacp api agents                       List available agents
  openacp api adapters                     List registered adapters
  openacp api tunnel                       Show tunnel status
  openacp api config                       Show runtime config
  openacp api config set <key> <value>     Update config value
  openacp api notify <message>             Send notification to all channels
  openacp api restart                      Restart daemon
  openacp api version                      Show daemon version

\x1b[1mOptions:\x1b[0m
  -h, --help                               Show this help message
`)
}

export async function cmdApi(args: string[]): Promise<void> {
  const subCmd = args[1]

  if (wantsHelp(args) && (!subCmd || subCmd === '--help' || subCmd === '-h')) {
    printApiHelp()
    return
  }

  // Handle --help for individual api subcommands (before port check)
  if (wantsHelp(args) && subCmd) {
    const apiSubHelp: Record<string, string> = {
      'status': `
\x1b[1mopenacp api status\x1b[0m — Show active sessions

\x1b[1mUsage:\x1b[0m
  openacp api status

Lists all active sessions with their ID, agent, status, and name.
`,
      'session': `
\x1b[1mopenacp api session\x1b[0m — Show session details

\x1b[1mUsage:\x1b[0m
  openacp api session <id>

\x1b[1mArguments:\x1b[0m
  <id>            Session ID

Shows detailed info: agent, status, name, workspace, creation time,
dangerous mode, queue depth, and channel/thread IDs.
`,
      'new': `
\x1b[1mopenacp api new\x1b[0m — Create a new session

\x1b[1mUsage:\x1b[0m
  openacp api new [agent] [workspace]
  openacp api new [agent] --workspace <path> [--channel <id>]

\x1b[1mArguments:\x1b[0m
  [agent]         Agent name (uses default if omitted)
  [workspace]     Working directory for the session

\x1b[1mOptions:\x1b[0m
  --channel <id>  Target adapter (e.g. telegram, discord). Defaults to first registered adapter.

\x1b[1mExamples:\x1b[0m
  openacp api new
  openacp api new claude /path/to/project
  openacp api new claude /path/to/project --channel discord
`,
      'send': `
\x1b[1mopenacp api send\x1b[0m — Send prompt to a session

\x1b[1mUsage:\x1b[0m
  openacp api send <id> <prompt>

\x1b[1mArguments:\x1b[0m
  <id>            Session ID
  <prompt>        Prompt text (all remaining arguments are joined)

\x1b[1mExamples:\x1b[0m
  openacp api send abc123 "Fix the login bug"
  openacp api send abc123 refactor the auth module
`,
      'cancel': `
\x1b[1mopenacp api cancel\x1b[0m — Cancel a session

\x1b[1mUsage:\x1b[0m
  openacp api cancel <id>

\x1b[1mArguments:\x1b[0m
  <id>            Session ID to cancel
`,
      'dangerous': `
\x1b[1mopenacp api dangerous\x1b[0m — Toggle dangerous mode for a session

\x1b[1mUsage:\x1b[0m
  openacp api dangerous <id> on|off

\x1b[1mArguments:\x1b[0m
  <id>            Session ID
  on|off          Enable or disable dangerous mode

Dangerous mode allows the agent to run destructive commands
without confirmation prompts.
`,
      'topics': `
\x1b[1mopenacp api topics\x1b[0m — List topics

\x1b[1mUsage:\x1b[0m
  openacp api topics [--status <statuses>]

\x1b[1mOptions:\x1b[0m
  --status <s1,s2>  Filter by status (comma-separated)

\x1b[1mExamples:\x1b[0m
  openacp api topics
  openacp api topics --status active,finished
`,
      'delete-topic': `
\x1b[1mopenacp api delete-topic\x1b[0m — Delete a topic

\x1b[1mUsage:\x1b[0m
  openacp api delete-topic <id> [--force]

\x1b[1mArguments:\x1b[0m
  <id>            Session ID of the topic to delete

\x1b[1mOptions:\x1b[0m
  --force         Delete even if session is active
`,
      'cleanup': `
\x1b[1mopenacp api cleanup\x1b[0m — Cleanup finished topics

\x1b[1mUsage:\x1b[0m
  openacp api cleanup [--status <statuses>]

\x1b[1mOptions:\x1b[0m
  --status <s1,s2>  Filter by status (comma-separated, default: finished topics)

\x1b[1mExamples:\x1b[0m
  openacp api cleanup
  openacp api cleanup --status finished,error
`,
      'health': `
\x1b[1mopenacp api health\x1b[0m — Show system health

\x1b[1mUsage:\x1b[0m
  openacp api health

Shows status, uptime, version, memory usage, session counts,
registered adapters, and tunnel status.
`,
      'agents': `
\x1b[1mopenacp api agents\x1b[0m — List available agents from running daemon

\x1b[1mUsage:\x1b[0m
  openacp api agents

Lists agents configured in the running daemon with their names
and which one is the default.
`,
      'adapters': `
\x1b[1mopenacp api adapters\x1b[0m — List registered adapters

\x1b[1mUsage:\x1b[0m
  openacp api adapters

Shows all channel adapters registered with the running daemon.
`,
      'tunnel': `
\x1b[1mopenacp api tunnel\x1b[0m — Show tunnel status

\x1b[1mUsage:\x1b[0m
  openacp api tunnel

Shows whether a tunnel is enabled, the provider, and the URL.
`,
      'config': `
\x1b[1mopenacp api config\x1b[0m — Show or update runtime config

\x1b[1mUsage:\x1b[0m
  openacp api config                       Show current runtime config
  openacp api config set <key> <value>     Update a config value

\x1b[2mNote: Prefer 'openacp config' instead — it works whether daemon is running or not.\x1b[0m
`,
      'restart': `
\x1b[1mopenacp api restart\x1b[0m — Restart the daemon

\x1b[1mUsage:\x1b[0m
  openacp api restart

Sends a restart signal to the running daemon.
`,
      'notify': `
\x1b[1mopenacp api notify\x1b[0m — Send notification to all channels

\x1b[1mUsage:\x1b[0m
  openacp api notify <message>

\x1b[1mArguments:\x1b[0m
  <message>       Notification text (all remaining arguments are joined)

\x1b[1mExamples:\x1b[0m
  openacp api notify "Deployment complete"
`,
      'version': `
\x1b[1mopenacp api version\x1b[0m — Show daemon version

\x1b[1mUsage:\x1b[0m
  openacp api version

Shows the version of the currently running daemon process.
`,
    }
    const help = apiSubHelp[subCmd]
    if (help) {
      console.log(help)
      return
    }
    // Unknown subcommand with --help, show general help
    printApiHelp()
    return
  }

  const port = readApiPort()
  if (port === null) {
    console.error('OpenACP is not running. Start with `openacp start`')
    process.exit(1)
  }

  try {
    if (subCmd === 'new') {
      const agent = args[2]
      const workspaceIdx = args.indexOf('--workspace')
      const workspace = workspaceIdx !== -1 ? args[workspaceIdx + 1] : args[3]
      const channelIdx = args.indexOf('--channel')
      const channel = channelIdx !== -1 ? args[channelIdx + 1] : undefined
      const body: Record<string, string> = {}
      if (agent) body.agent = agent
      if (workspace) body.workspace = workspace
      if (channel) body.channel = channel

      const res = await apiCall(port, '/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log('Session created')
      console.log(`  ID        : ${data.sessionId}`)
      console.log(`  Agent     : ${data.agent}`)
      console.log(`  Workspace : ${data.workspace}`)
      console.log(`  Status    : ${data.status}`)

    } else if (subCmd === 'cancel') {
      const sessionId = args[2]
      if (!sessionId) {
        console.error('Usage: openacp api cancel <session-id>')
        process.exit(1)
      }
      const res = await apiCall(port, `/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log(`Session ${sessionId} cancelled`)

    } else if (subCmd === 'status') {
      const res = await apiCall(port, '/api/sessions')
      const data = await res.json() as { sessions: Array<{ id: string; agent: string; status: string; name: string | null }> }
      if (data.sessions.length === 0) {
        console.log('No active sessions.')
      } else {
        console.log(`Active sessions: ${data.sessions.length}\n`)
        for (const s of data.sessions) {
          const name = s.name ? `  "${s.name}"` : ''
          console.log(`  ${s.id}  ${s.agent}  ${s.status}${name}`)
        }
      }

    } else if (subCmd === 'agents') {
      const res = await apiCall(port, '/api/agents')
      const data = await res.json() as { agents: Array<{ name: string; command: string; args: string[] }>; default: string }
      console.log('Available agents:')
      for (const a of data.agents) {
        const isDefault = a.name === data.default ? ' (default)' : ''
        console.log(`  ${a.name}${isDefault}`)
      }

    } else if (subCmd === 'topics') {
      const statusIdx = args.indexOf('--status')
      const statusParam = statusIdx !== -1 ? args[statusIdx + 1] : undefined
      const query = statusParam ? `?status=${encodeURIComponent(statusParam)}` : ''
      const res = await apiCall(port, `/api/topics${query}`)
      const data = await res.json() as { topics: Array<{ sessionId: string; topicId: number | null; name: string | null; status: string; agentName: string; lastActiveAt: string }> }
      if (data.topics.length === 0) {
        console.log('No topics found.')
      } else {
        console.log(`Topics: ${data.topics.length}\n`)
        for (const t of data.topics) {
          const name = t.name ? `  "${t.name}"` : ''
          const topic = t.topicId ? `Topic #${t.topicId}` : 'headless'
          console.log(`  ${t.sessionId}  ${t.agentName}  ${t.status}${name}      ${topic}`)
        }
      }

    } else if (subCmd === 'delete-topic') {
      const sessionId = args[2]
      if (!sessionId) {
        console.error('Usage: openacp api delete-topic <session-id> [--force]')
        process.exit(1)
      }
      const force = args.includes('--force')
      const query = force ? '?force=true' : ''
      const res = await apiCall(port, `/api/topics/${encodeURIComponent(sessionId)}${query}`, { method: 'DELETE' })
      const data = await res.json() as Record<string, unknown>
      if (res.status === 409) {
        const session = data.session as Record<string, unknown> | undefined
        console.error(`Session "${sessionId}" is active (${session?.status}). Use --force to delete.`)
        process.exit(1)
      }
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      const topicLabel = data.topicId ? `Topic #${data.topicId}` : 'headless session'
      console.log(`${topicLabel} deleted (session ${sessionId})`)

    } else if (subCmd === 'cleanup') {
      const statusIdx = args.indexOf('--status')
      const statusParam = statusIdx !== -1 ? args[statusIdx + 1] : undefined
      const body: Record<string, unknown> = {}
      if (statusParam) body.statuses = statusParam.split(',')
      const res = await apiCall(port, '/api/topics/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { deleted: string[]; failed: Array<{ sessionId: string; error: string }> }
      if (data.deleted.length === 0 && data.failed.length === 0) {
        console.log('Nothing to clean up.')
      } else {
        console.log(`Cleaned up ${data.deleted.length} topics${data.deleted.length ? ': ' + data.deleted.join(', ') : ''} (${data.failed.length} failed)`)
        for (const f of data.failed) {
          console.error(`  Failed: ${f.sessionId} — ${f.error}`)
        }
      }

    } else if (subCmd === 'send') {
      const sessionId = args[2]
      if (!sessionId) {
        console.error('Usage: openacp api send <session-id> <prompt>')
        process.exit(1)
      }
      const prompt = args.slice(3).join(' ')
      if (!prompt) {
        console.error('Usage: openacp api send <session-id> <prompt>')
        process.exit(1)
      }
      const res = await apiCall(port, `/api/sessions/${encodeURIComponent(sessionId)}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log(`Prompt sent to session ${sessionId} (queue depth: ${data.queueDepth})`)

    } else if (subCmd === 'session') {
      const sessionId = args[2]
      if (!sessionId) {
        console.error('Usage: openacp api session <session-id>')
        process.exit(1)
      }
      const res = await apiCall(port, `/api/sessions/${encodeURIComponent(sessionId)}`)
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log(`Session details:`)
      console.log(`  ID             : ${data.id}`)
      console.log(`  Agent          : ${data.agent}`)
      console.log(`  Status         : ${data.status}`)
      console.log(`  Name           : ${data.name ?? '(none)'}`)
      console.log(`  Workspace      : ${data.workspace}`)
      console.log(`  Created        : ${data.createdAt}`)
      console.log(`  Dangerous      : ${data.dangerous}`)
      console.log(`  Queue depth    : ${data.queueDepth}`)
      console.log(`  Prompt active  : ${data.promptActive}`)
      console.log(`  Channel        : ${data.channelId ?? '(none)'}`)
      console.log(`  Thread         : ${data.threadId ?? '(none)'}`)

    } else if (subCmd === 'dangerous') {
      const sessionId = args[2]
      if (!sessionId) {
        console.error('Usage: openacp api dangerous <session-id> [on|off]')
        process.exit(1)
      }
      const toggle = args[3]
      if (!toggle || (toggle !== 'on' && toggle !== 'off')) {
        console.error('Usage: openacp api dangerous <session-id> [on|off]')
        process.exit(1)
      }
      const res = await apiCall(port, `/api/sessions/${encodeURIComponent(sessionId)}/dangerous`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: toggle === 'on' }),
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      const state = toggle === 'on' ? 'enabled' : 'disabled'
      console.log(`Dangerous mode ${state} for session ${sessionId}`)

    } else if (subCmd === 'health') {
      const res = await apiCall(port, '/api/health')
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      const uptimeSeconds = typeof data.uptimeSeconds === 'number' ? data.uptimeSeconds : 0
      const hours = Math.floor(uptimeSeconds / 3600)
      const minutes = Math.floor((uptimeSeconds % 3600) / 60)
      const memoryBytes = typeof data.memoryUsage === 'number' ? data.memoryUsage : 0
      const memoryMB = (memoryBytes / 1024 / 1024).toFixed(1)
      const sessions = data.sessions as Record<string, unknown> ?? {}
      console.log(`Status   : ${data.status}`)
      console.log(`Uptime   : ${hours}h ${minutes}m`)
      console.log(`Version  : ${data.version}`)
      console.log(`Memory   : ${memoryMB} MB`)
      console.log(`Sessions : ${sessions.active ?? 0} active / ${sessions.total ?? 0} total`)
      console.log(`Adapters : ${data.adapters}`)
      console.log(`Tunnel   : ${data.tunnel}`)

    } else if (subCmd === 'restart') {
      const res = await apiCall(port, '/api/restart', { method: 'POST' })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log('Restart signal sent. OpenACP is restarting...')

    } else if (subCmd === 'config') {
      console.warn('⚠️  Deprecated: use "openacp config" or "openacp config set" instead.')
      const subSubCmd = args[2]
      if (!subSubCmd) {
        const res = await apiCall(port, '/api/config')
        const data = await res.json() as Record<string, unknown>
        if (!res.ok) {
          console.error(`Error: ${data.error}`)
          process.exit(1)
        }
        console.log(JSON.stringify(data.config, null, 2))
      } else if (subSubCmd === 'set') {
        const configPath = args[3]
        const configValue = args[4]
        if (!configPath || configValue === undefined) {
          console.error('Usage: openacp api config set <path> <value>')
          process.exit(1)
        }
        let value: unknown = configValue
        try {
          value = JSON.parse(configValue)
        } catch {
          // keep as string
        }
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
        console.error(`Unknown config subcommand: ${subSubCmd}`)
        console.log('  openacp api config                       Show runtime config')
        console.log('  openacp api config set <key> <value>     Update config value')
        process.exit(1)
      }

    } else if (subCmd === 'adapters') {
      const res = await apiCall(port, '/api/adapters')
      const data = await res.json() as { adapters: Array<{ name: string; type: string }> }
      if (!res.ok) {
        console.error(`Error: ${(data as Record<string, unknown>).error}`)
        process.exit(1)
      }
      console.log('Registered adapters:')
      for (const a of data.adapters) {
        console.log(`  ${a.name}  (${a.type})`)
      }

    } else if (subCmd === 'tunnel') {
      const res = await apiCall(port, '/api/tunnel')
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      if (data.enabled) {
        console.log(`Tunnel provider : ${data.provider}`)
        console.log(`Tunnel URL      : ${data.url}`)
      } else {
        console.log('Tunnel: not enabled')
      }

    } else if (subCmd === 'notify') {
      const message = args.slice(2).join(' ')
      if (!message) {
        console.error('Usage: openacp api notify <message>')
        process.exit(1)
      }
      const res = await apiCall(port, '/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log('Notification sent to all channels.')

    } else if (subCmd === 'version') {
      const res = await apiCall(port, '/api/version')
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log(`Daemon version: ${data.version}`)

    } else {
      const { suggestMatch } = await import('../suggest.js')
      const apiSubcommands = [
        'new', 'cancel', 'status', 'agents', 'topics', 'delete-topic',
        'cleanup', 'send', 'session', 'dangerous', 'health', 'restart',
        'config', 'adapters', 'tunnel', 'notify', 'version',
      ]
      const suggestion = suggestMatch(subCmd ?? '', apiSubcommands)
      console.error(`Unknown api command: ${subCmd || '(none)'}\n`)
      if (suggestion) console.error(`Did you mean: ${suggestion}?\n`)
      printApiHelp()
      process.exit(1)
    }
  } catch (err) {
    if (err instanceof TypeError && (err.cause as Record<string, unknown> | undefined)?.code === 'ECONNREFUSED') {
      console.error('OpenACP is not running (stale port file)')
      removeStalePortFile()
      process.exit(1)
    }
    throw err
  }
}
