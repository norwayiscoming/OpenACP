import { readApiPort, apiCall } from '../api-client.js'

export async function cmdTunnel(args: string[], instanceRoot?: string): Promise<void> {
  const subCmd = args[0]
  const port = readApiPort(undefined, instanceRoot)
  if (port === null) {
    console.error('OpenACP is not running. Start with `openacp start`')
    process.exit(1)
  }

  const call = (urlPath: string, options?: RequestInit) => apiCall(port, urlPath, options, instanceRoot)

  try {
    if (subCmd === 'add') {
      const tunnelPort = args[1]
      if (!tunnelPort) {
        console.error('Usage: openacp tunnel add <port> [--label name] [--session id]')
        process.exit(1)
      }
      const labelIdx = args.indexOf('--label')
      const label = labelIdx !== -1 ? args[labelIdx + 1] : undefined
      const sessionIdx = args.indexOf('--session')
      const sessionId = sessionIdx !== -1 ? args[sessionIdx + 1] : undefined

      const body: Record<string, unknown> = { port: parseInt(tunnelPort, 10) }
      if (label) body.label = label
      if (sessionId) body.sessionId = sessionId

      const res = await call('/api/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log(`Tunnel active: port ${data.port} → ${data.publicUrl}`)

    } else if (subCmd === 'list') {
      const res = await call('/api/tunnel/list')
      const data = await res.json() as Array<Record<string, unknown>>
      if (data.length === 0) {
        console.log('No active tunnels.')
        return
      }
      console.log('Active tunnels:\n')
      for (const t of data) {
        const label = t.label ? ` (${t.label})` : ''
        const status = t.status === 'active' ? '✅' : t.status === 'starting' ? '⏳' : '❌'
        console.log(`  ${status} Port ${t.port}${label}`)
        if (t.publicUrl) console.log(`     → ${t.publicUrl}`)
      }

    } else if (subCmd === 'stop') {
      const tunnelPort = args[1]
      if (!tunnelPort) {
        console.error('Usage: openacp tunnel stop <port>')
        process.exit(1)
      }
      const res = await call(`/api/tunnel/${tunnelPort}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json() as Record<string, unknown>
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log(`Tunnel stopped: port ${tunnelPort}`)

    } else if (subCmd === 'stop-all') {
      const res = await call('/api/tunnel', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json() as Record<string, unknown>
        console.error(`Error: ${data.error}`)
        process.exit(1)
      }
      console.log('All user tunnels stopped.')

    } else {
      console.log(`
Tunnel Management:
  openacp tunnel add <port> [--label name] [--session id]
  openacp tunnel list
  openacp tunnel stop <port>
  openacp tunnel stop-all
`)
    }
  } catch (err) {
    console.error(`Failed to connect to daemon: ${(err as Error).message}`)
    process.exit(1)
  }
}
