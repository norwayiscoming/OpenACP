import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createChildLogger } from '../../core/utils/log.js'
import type { TunnelProvider } from './provider.js'
import { CloudflareTunnelProvider } from './providers/cloudflare.js'
import { NgrokTunnelProvider } from './providers/ngrok.js'
import { BoreTunnelProvider } from './providers/bore.js'
import { TailscaleTunnelProvider } from './providers/tailscale.js'

const log = createChildLogger({ module: 'tunnel-registry' })

export interface TunnelEntry {
  port: number
  type: 'system' | 'user'
  provider: string
  label?: string
  publicUrl?: string
  sessionId?: string
  status: 'stopped' | 'starting' | 'active' | 'failed'
  createdAt: string
}

interface PersistedEntry {
  port: number
  type: 'system' | 'user'
  provider: string
  label?: string
  sessionId?: string
  createdAt: string
}

interface LiveEntry {
  entry: TunnelEntry
  process: TunnelProvider | null
  spawnPromise: Promise<string> | null
}

const REGISTRY_PATH = path.join(os.homedir(), '.openacp', 'tunnels.json')

export class TunnelRegistry {
  private entries: Map<number, LiveEntry> = new Map()
  private saveTimeout: ReturnType<typeof setTimeout> | null = null
  private maxUserTunnels: number
  private providerOptions: Record<string, unknown>

  constructor(opts: { maxUserTunnels?: number; providerOptions?: Record<string, unknown> } = {}) {
    this.maxUserTunnels = opts.maxUserTunnels ?? 5
    this.providerOptions = opts.providerOptions ?? {}
  }

  async add(port: number, opts: {
    type: 'system' | 'user'
    provider: string
    label?: string
    sessionId?: string
  }): Promise<TunnelEntry> {
    // Check if port already registered
    if (this.entries.has(port)) {
      const existing = this.entries.get(port)!
      if (existing.entry.status === 'active' || existing.entry.status === 'starting') {
        throw new Error(`Port ${port} is already tunneled → ${existing.entry.publicUrl || 'starting...'}`)
      }
      // Stopped/failed entry — remove and re-add
      this.entries.delete(port)
    }

    // Check max user tunnels
    if (opts.type === 'user') {
      const userCount = this.list(false).filter(e => e.status === 'active' || e.status === 'starting').length
      if (userCount >= this.maxUserTunnels) {
        throw new Error(`Max user tunnels (${this.maxUserTunnels}) reached. Stop a tunnel first.`)
      }
    }

    const entry: TunnelEntry = {
      port,
      type: opts.type,
      provider: opts.provider,
      label: opts.label,
      sessionId: opts.sessionId,
      status: 'starting',
      createdAt: new Date().toISOString(),
    }

    const provider = this.createProvider(opts.provider)
    const spawnPromise = provider.start(port).then(url => {
      entry.publicUrl = url
      entry.status = 'active'
      log.info({ port, url, label: opts.label }, 'Tunnel active')
      this.scheduleSave()
      return url
    }).catch(err => {
      entry.status = 'failed'
      log.error({ port, err: (err as Error).message }, 'Tunnel failed to start')
      this.scheduleSave()
      throw err
    })

    this.entries.set(port, { entry, process: provider, spawnPromise })
    this.scheduleSave()

    // Await spawn — caller gets the URL or error
    await spawnPromise
    return entry
  }

  async stop(port: number): Promise<void> {
    const live = this.entries.get(port)
    if (!live) return

    if (live.entry.type === 'system') {
      throw new Error('Cannot stop system tunnel')
    }

    // Wait for spawn to finish if still starting
    if (live.spawnPromise) {
      try { await live.spawnPromise } catch { /* ignore spawn error */ }
    }

    if (live.process) {
      await live.process.stop()
    }

    this.entries.delete(port)
    this.scheduleSave()
    log.info({ port, label: live.entry.label }, 'Tunnel stopped')
  }

  async stopBySession(sessionId: string): Promise<TunnelEntry[]> {
    const stopped: TunnelEntry[] = []
    const toStop = this.getBySession(sessionId)
    for (const entry of toStop) {
      try {
        await this.stop(entry.port)
        stopped.push(entry)
      } catch { /* ignore */ }
    }
    return stopped
  }

  async stopAllUser(): Promise<void> {
    const userEntries = this.list(false)
    for (const entry of userEntries) {
      try { await this.stop(entry.port) } catch { /* ignore */ }
    }
  }

  async shutdown(): Promise<void> {
    for (const [, live] of this.entries) {
      if (live.spawnPromise) {
        try { await live.spawnPromise } catch { /* ignore */ }
      }
      if (live.process) {
        await live.process.stop()
      }
    }
    this.entries.clear()
    this.scheduleSave()
  }

  list(includeSystem = false): TunnelEntry[] {
    const entries = Array.from(this.entries.values()).map(l => l.entry)
    if (includeSystem) return entries
    return entries.filter(e => e.type === 'user')
  }

  get(port: number): TunnelEntry | null {
    return this.entries.get(port)?.entry ?? null
  }

  getBySession(sessionId: string): TunnelEntry[] {
    return this.list(false).filter(e => e.sessionId === sessionId)
  }

  getSystemEntry(): TunnelEntry | null {
    for (const live of this.entries.values()) {
      if (live.entry.type === 'system') return live.entry
    }
    return null
  }

  async restore(): Promise<void> {
    if (!fs.existsSync(REGISTRY_PATH)) return

    try {
      const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')) as PersistedEntry[]
      log.info({ count: raw.length }, 'Restoring tunnels')

      // Only restore user tunnels — system tunnel is registered separately by TunnelService.start()
      const userEntries = raw.filter(e => e.type === 'user')
      for (const persisted of userEntries) {
        try {
          await this.add(persisted.port, {
            type: persisted.type,
            provider: persisted.provider,
            label: persisted.label,
            sessionId: persisted.sessionId,
          })
        } catch (err) {
          log.warn({ port: persisted.port, err: (err as Error).message }, 'Failed to restore tunnel')
        }
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'Failed to read tunnels.json')
    }
  }

  private createProvider(name: string): TunnelProvider {
    switch (name) {
      case 'cloudflare':
        return new CloudflareTunnelProvider(this.providerOptions)
      case 'ngrok':
        return new NgrokTunnelProvider(this.providerOptions)
      case 'bore':
        return new BoreTunnelProvider(this.providerOptions)
      case 'tailscale':
        return new TailscaleTunnelProvider(this.providerOptions)
      default:
        log.warn({ provider: name }, 'Unknown provider, falling back to cloudflare')
        return new CloudflareTunnelProvider(this.providerOptions)
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => this.save(), 2000)
  }

  private save(): void {
    const data: PersistedEntry[] = Array.from(this.entries.values()).map(l => ({
      port: l.entry.port,
      type: l.entry.type,
      provider: l.entry.provider,
      label: l.entry.label,
      sessionId: l.entry.sessionId,
      createdAt: l.entry.createdAt,
    }))

    try {
      const dir = path.dirname(REGISTRY_PATH)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2))
    } catch (err) {
      log.error({ err: (err as Error).message }, 'Failed to save tunnels.json')
    }
  }

  flush(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
      this.saveTimeout = null
    }
    this.save()
  }
}
