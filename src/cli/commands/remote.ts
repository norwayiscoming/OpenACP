import { readApiPort, readApiSecret, apiCall } from '../api-client.js'
import { InstanceRegistry } from '../../core/instance/instance-registry.js'
import path from 'node:path'
import os from 'node:os'
import qrcode from 'qrcode-terminal'

export async function cmdRemote(args: string[], instanceRoot?: string): Promise<void> {
  // Parse flags
  const role = extractFlag(args, '--role') ?? 'admin'
  const expire = extractFlag(args, '--expire') ?? '24h'
  const scopesRaw = extractFlag(args, '--scopes')
  const name = extractFlag(args, '--name')
  const instanceId = extractFlag(args, '--instance')
  const noTunnel = args.includes('--no-tunnel')
  const noQr = args.includes('--no-qr')

  const scopes = scopesRaw ? scopesRaw.split(',').map((s) => s.trim()) : undefined

  // Resolve instance root from --instance flag
  let resolvedInstanceRoot = instanceRoot
  if (instanceId) {
    const registryPath = path.join(os.homedir(), '.openacp', 'instances.json')
    const registry = new InstanceRegistry(registryPath)
    await registry.load()
    const entry = registry.get(instanceId)
    if (!entry) {
      console.error(`Workspace "${instanceId}" not found. Run "openacp status" to see workspaces.`)
      process.exit(1)
    }
    resolvedInstanceRoot = entry.root
  }

  // Check if API server is running
  const port = readApiPort(undefined, resolvedInstanceRoot)
  if (port === null) {
    console.error('OpenACP is not running. Start with `openacp start`')
    process.exit(1)
  }

  // Verify health
  try {
    const healthRes = await apiCall(port, '/api/v1/system/health', undefined, resolvedInstanceRoot)
    if (!healthRes.ok) {
      console.error('API server is not responding. Try restarting with `openacp restart`')
      process.exit(1)
    }
  } catch {
    console.error('Cannot connect to API server. Is OpenACP running?')
    process.exit(1)
  }

  // Read api-secret for auth
  const secret = readApiSecret(undefined, resolvedInstanceRoot)
  if (!secret) {
    console.error('Cannot read API secret. Make sure OpenACP is running with the API server enabled.')
    process.exit(1)
  }

  // Generate token name
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const yyyy = now.getFullYear()
  const tokenName = name ?? `remote-${hh}h${mm}-${dd}-${mo}-${yyyy}`

  // Generate token via API
  let tokenData: { tokenId: string; accessToken: string; expiresAt: string }
  try {
    const body: Record<string, unknown> = { role, name: tokenName, expire }
    if (scopes) body.scopes = scopes

    const res = await apiCall(port, '/api/v1/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, resolvedInstanceRoot)

    if (!res.ok) {
      const err = await res.json() as Record<string, unknown>
      console.error(`Failed to generate token: ${err.error ?? err.message ?? 'Unknown error'}`)
      process.exit(1)
    }

    tokenData = await res.json() as typeof tokenData
  } catch (err) {
    console.error(`Failed to generate token: ${(err as Error).message}`)
    process.exit(1)
  }

  // Try to get tunnel URL
  let tunnelUrl: string | null = null
  if (!noTunnel) {
    try {
      const tunnelRes = await apiCall(port, '/api/v1/tunnel', undefined, resolvedInstanceRoot)
      if (tunnelRes.ok) {
        const data = await tunnelRes.json() as { enabled: boolean; url?: string }
        if (data.enabled && data.url) {
          tunnelUrl = data.url
        }
      }
    } catch {
      // Tunnel not available, that's fine
    }
  }

  // Build URLs
  const localUrl = `http://127.0.0.1:${port}`
  const tokenParam = `token=${tokenData.accessToken}`

  const localLink = `${localUrl}?${tokenParam}`
  const tunnelLink = tunnelUrl ? `${tunnelUrl}?${tokenParam}` : null
  const appLink = tunnelUrl
    ? `openacp://connect?host=${encodeURIComponent(tunnelUrl)}&${tokenParam}&port=${port}`
    : `openacp://connect?host=${encodeURIComponent('127.0.0.1')}&${tokenParam}&port=${port}`

  // Display output
  const width = 64
  const border = '─'.repeat(width)

  console.log('')
  console.log(`  ┌${border}┐`)
  console.log(`  │${'  Remote Access'.padEnd(width)}│`)
  console.log(`  ├${border}┤`)
  console.log(`  │${''.padEnd(width)}│`)
  console.log(`  │${'  Token:'.padEnd(width)}│`)
  console.log(`  │${'  ' + tokenData.tokenId.padEnd(width - 2)}│`)
  console.log(`  │${'  Role: ' + role.padEnd(width - 8)}│`)
  console.log(`  │${'  Expires: ' + tokenData.expiresAt.padEnd(width - 11)}│`)
  console.log(`  │${''.padEnd(width)}│`)
  console.log(`  │${'  Local:'.padEnd(width)}│`)
  printWrapped(localLink, width)
  console.log(`  │${''.padEnd(width)}│`)

  if (tunnelLink) {
    console.log(`  │${'  Tunnel:'.padEnd(width)}│`)
    printWrapped(tunnelLink, width)
    console.log(`  │${''.padEnd(width)}│`)
  }

  console.log(`  │${'  App link:'.padEnd(width)}│`)
  printWrapped(appLink, width)
  console.log(`  │${''.padEnd(width)}│`)
  console.log(`  └${border}┘`)
  console.log('')

  // Show QR code
  if (!noQr) {
    const qrTarget = tunnelLink ?? appLink
    console.log('  Scan to connect:')
    console.log('')
    qrcode.generate(qrTarget, { small: true }, (code: string) => {
      // Indent each line of the QR code
      const lines = code.split('\n')
      for (const line of lines) {
        console.log(`    ${line}`)
      }
    })
    console.log('')
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  return args[idx + 1]
}

function printWrapped(text: string, width: number): void {
  const maxContent = width - 4 // 2 spaces indent + 2 padding
  let remaining = text
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, maxContent)
    remaining = remaining.slice(maxContent)
    console.log(`  │${'  ' + chunk.padEnd(width - 2)}│`)
  }
}
