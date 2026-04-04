import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createChildLogger } from '../../core/utils/log.js'
import type { TunnelProvider } from './provider.js'
import { TunnelKeepAlive } from './keepalive.js'
import { CloudflareTunnelProvider } from './providers/cloudflare.js'
import { NgrokTunnelProvider } from './providers/ngrok.js'
import { BoreTunnelProvider } from './providers/bore.js'
import { TailscaleTunnelProvider } from './providers/tailscale.js'
import type { PluginStorage } from '../../core/plugin/types.js'
import { OpenACPTunnelProvider } from './providers/openacp.js'

const log = createChildLogger({ module: 'tunnel-registry' })

export const MAX_RETRIES = 5
const BASE_RETRY_DELAY_MS = 2_000

export interface TunnelEntry {
  port: number
  type: 'system' | 'user'
  provider: string
  label?: string
  publicUrl?: string
  sessionId?: string
  status: 'stopped' | 'starting' | 'active' | 'failed'
  retryCount: number
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
  retryTimer: ReturnType<typeof setTimeout> | null
}

export class TunnelRegistry {
  private entries: Map<number, LiveEntry> = new Map()
  private saveTimeout: ReturnType<typeof setTimeout> | null = null
  private maxUserTunnels: number
  private keepalive = new TunnelKeepAlive()
  private providerOptions: Record<string, unknown>
  private registryPath: string
  private shuttingDown = false

  private binDir: string | undefined
  private storage: PluginStorage | null

  constructor(opts: { maxUserTunnels?: number; providerOptions?: Record<string, unknown>; registryPath?: string; binDir?: string; storage?: PluginStorage } = {}) {
    this.maxUserTunnels = opts.maxUserTunnels ?? 5
    this.providerOptions = opts.providerOptions ?? {}
    this.registryPath = opts.registryPath ?? path.join(os.homedir(), '.openacp', 'tunnels.json')
    this.binDir = opts.binDir
    this.storage = opts.storage ?? null
  }

  async add(port: number, opts: {
    type: 'system' | 'user'
    provider: string
    label?: string
    sessionId?: string
  }, _autoRetry = true): Promise<TunnelEntry> {
    // Check if port already registered
    if (this.entries.has(port)) {
      const existing = this.entries.get(port)!
      if (existing.entry.status === 'active' || existing.entry.status === 'starting') {
        throw new Error(`Port ${port} is already tunneled → ${existing.entry.publicUrl || 'starting...'}`)
      }
      // Stopped/failed entry — clean up retry timer and re-add
      if (existing.retryTimer) clearTimeout(existing.retryTimer)
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
      retryCount: 0,
      createdAt: new Date().toISOString(),
    }

    const provider = this.createProvider(opts.provider)

    // Wire up post-establishment crash detection with auto-retry
    provider.onExit((code) => {
      if (this.shuttingDown) return
      const live = this.entries.get(port)
      if (!live) return

      if (entry.type === 'system') {
        this.keepalive.stop()
      }

      live.entry.status = 'failed'
      live.process = null
      this.scheduleSave()

      if (live.entry.retryCount < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, live.entry.retryCount)
        log.warn({ port, code, retry: live.entry.retryCount + 1, maxRetries: MAX_RETRIES, delayMs: delay },
          'Tunnel crashed, scheduling retry')
        live.retryTimer = setTimeout(() => this.retry(port, opts), delay)
      } else {
        log.error({ port, code }, `Tunnel crashed and exhausted all ${MAX_RETRIES} retries`)
      }
    })

    const spawnPromise = provider.start(port).then(url => {
      entry.publicUrl = url
      entry.status = 'active'
      log.info({ port, url, label: opts.label }, 'Tunnel active')
      this.scheduleSave()
      if (opts.type === 'system' && entry.publicUrl) {
        const live = this.entries.get(port)
        this.keepalive.start(entry.publicUrl, () => {
          log.warn('Tunnel keepalive detected dead tunnel, restarting...')
          // Clear publicUrl so getPublicUrl() falls back to localhost
          entry.publicUrl = undefined
          entry.status = 'failed'
          // Kill process to trigger onExit → retry
          if (live) live.process?.stop()
        })
      }
      return url
    }).catch(err => {
      entry.status = 'failed'
      log.error({ port, err: (err as Error).message }, 'Tunnel failed to start')
      this.scheduleSave()

      // Schedule retry for initial start failures (e.g. rate limiting, transient errors)
      // Skip when called from retry() — it manages its own retry scheduling
      const live = this.entries.get(port)
      if (_autoRetry && live && !this.shuttingDown && live.entry.retryCount < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, live.entry.retryCount)
        log.warn({ port, retry: live.entry.retryCount + 1, maxRetries: MAX_RETRIES, delayMs: delay },
          'Scheduling retry after initial start failure')
        live.retryTimer = setTimeout(() => this.retry(port, opts), delay)
      }

      throw err
    })

    this.entries.set(port, { entry, process: provider, spawnPromise, retryTimer: null })
    this.scheduleSave()

    // Await spawn — caller gets the URL or error
    await spawnPromise
    return entry
  }

  private async retry(port: number, opts: {
    type: 'system' | 'user'
    provider: string
    label?: string
    sessionId?: string
  }): Promise<void> {
    if (this.shuttingDown) return
    const live = this.entries.get(port)
    if (!live) return

    const retryCount = live.entry.retryCount + 1
    log.info({ port, retry: retryCount, maxRetries: MAX_RETRIES }, 'Retrying tunnel')

    // Remove old entry so add() doesn't reject
    if (live.retryTimer) clearTimeout(live.retryTimer)
    this.entries.delete(port)

    try {
      const entry = await this.add(port, opts, false)
      entry.retryCount = retryCount
    } catch (err) {
      if (this.shuttingDown) return

      log.error({ port, err: (err as Error).message, retry: retryCount }, 'Tunnel retry failed')

      // Re-insert as failed with incremented retry count for next onExit cycle
      const failedEntry: TunnelEntry = {
        port,
        type: opts.type,
        provider: opts.provider,
        label: opts.label,
        sessionId: opts.sessionId,
        status: 'failed',
        retryCount,
        createdAt: live.entry.createdAt,
      }

      if (retryCount < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount)
        const retryTimer = setTimeout(() => this.retry(port, opts), delay)
        this.entries.set(port, { entry: failedEntry, process: null, spawnPromise: null, retryTimer })
        log.warn({ port, retry: retryCount + 1, delayMs: delay }, 'Scheduling next retry')
      } else {
        this.entries.set(port, { entry: failedEntry, process: null, spawnPromise: null, retryTimer: null })
        log.error({ port }, `Tunnel exhausted all ${MAX_RETRIES} retries`)
      }
      this.scheduleSave()
    }
  }

  async stop(port: number): Promise<void> {
    const live = this.entries.get(port)
    if (!live) return

    if (live.entry.type === 'system') {
      throw new Error('Cannot stop system tunnel')
    }

    // Cancel any pending retry
    if (live.retryTimer) clearTimeout(live.retryTimer)

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
    this.keepalive.stop()
    this.shuttingDown = true

    const stopPromises: Promise<void>[] = []
    for (const [, live] of this.entries) {
      if (live.retryTimer) clearTimeout(live.retryTimer)
      if (live.process) {
        stopPromises.push(live.process.stop(true).catch(() => { /* ignore */ }))
      }
    }
    await Promise.all(stopPromises)
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
    if (!fs.existsSync(this.registryPath)) return

    try {
      const raw = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8')) as PersistedEntry[]
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
      case 'openacp': {
        if (!this.storage) {
          throw new Error('OpenACPTunnelProvider requires storage — ensure tunnel plugin has storage:read and storage:write permissions')
        }
        return new OpenACPTunnelProvider(this.providerOptions, this.binDir ?? '', this.storage)
      }
      case 'cloudflare':
        return new CloudflareTunnelProvider(this.providerOptions, this.binDir)
      case 'ngrok':
        return new NgrokTunnelProvider(this.providerOptions)
      case 'bore':
        return new BoreTunnelProvider(this.providerOptions)
      case 'tailscale':
        return new TailscaleTunnelProvider(this.providerOptions)
      default:
        log.warn({ provider: name }, 'Unknown provider, falling back to openacp')
        if (!this.storage) {
          log.warn('No storage available for openacp fallback, using cloudflare quick tunnel')
          return new CloudflareTunnelProvider(this.providerOptions, this.binDir)
        }
        return new OpenACPTunnelProvider(this.providerOptions, this.binDir ?? '', this.storage)
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
      const dir = path.dirname(this.registryPath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.registryPath, JSON.stringify(data, null, 2))
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
