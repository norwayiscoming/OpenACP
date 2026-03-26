import { serve } from '@hono/node-server'
import type { TunnelConfig } from '../../core/config/config.js'
import { createChildLogger } from '../../core/utils/log.js'
import { TunnelRegistry, type TunnelEntry } from './tunnel-registry.js'
import { ViewerStore } from './viewer-store.js'
import { createTunnelServer } from './server.js'

const log = createChildLogger({ module: 'tunnel' })

export class TunnelService {
  private registry: TunnelRegistry
  private store: ViewerStore
  private server: ReturnType<typeof serve> | null = null
  private config: TunnelConfig
  private systemPort = 0

  constructor(config: TunnelConfig) {
    this.config = config
    this.store = new ViewerStore(config.storeTtlMinutes)
    this.registry = new TunnelRegistry({
      maxUserTunnels: config.maxUserTunnels ?? 5,
      providerOptions: config.options,
    })
  }

  async start(): Promise<string> {
    // 1. Start HTTP viewer server — try configured port, then auto-increment
    const authToken = this.config.auth.enabled ? this.config.auth.token : undefined
    const app = createTunnelServer(this.store, authToken)

    let actualPort = this.config.port
    const maxRetries = 10

    for (let i = 0; i < maxRetries; i++) {
      const port = this.config.port + i
      const server = serve({ fetch: app.fetch, port })

      const ok = await new Promise<boolean>((resolve) => {
        server.on('listening', () => resolve(true))
        server.on('error', () => resolve(false))
      })

      if (ok) {
        this.server = server
        actualPort = port
        if (i > 0) {
          log.info({ configuredPort: this.config.port, actualPort }, 'Configured port in use, using next available')
        }
        log.info({ port: actualPort }, 'Tunnel HTTP server started')
        break
      }

      server.close()
    }

    if (!this.server) {
      log.warn({ port: this.config.port }, 'Could not find available port for tunnel HTTP server')
      return `http://localhost:${this.config.port}`
    }

    this.systemPort = actualPort

    // 2. Register system tunnel (file viewer)
    try {
      await this.registry.add(actualPort, {
        type: 'system',
        provider: this.config.provider,
        label: 'File Viewer',
      })
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'System tunnel failed, running on localhost')
    }

    // 3. Restore persisted user tunnels
    await this.registry.restore()

    const systemEntry = this.registry.getSystemEntry()
    return systemEntry?.publicUrl || `http://localhost:${actualPort}`
  }

  async stop(): Promise<void> {
    await this.registry.shutdown()
    this.registry.flush()
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.store.destroy()
    log.info('Tunnel service stopped')
  }

  // --- User tunnel management ---

  async addTunnel(port: number, opts?: { label?: string; sessionId?: string }): Promise<TunnelEntry> {
    return this.registry.add(port, {
      type: 'user',
      provider: this.config.provider,
      label: opts?.label,
      sessionId: opts?.sessionId,
    })
  }

  async stopTunnel(port: number): Promise<void> {
    return this.registry.stop(port)
  }

  async stopAllUser(): Promise<void> {
    return this.registry.stopAllUser()
  }

  async stopBySession(sessionId: string): Promise<TunnelEntry[]> {
    return this.registry.stopBySession(sessionId)
  }

  listTunnels(): TunnelEntry[] {
    return this.registry.list(false)  // user only
  }

  getTunnel(port: number): TunnelEntry | null {
    return this.registry.get(port)
  }

  // --- Viewer (system tunnel) ---

  getPublicUrl(): string {
    const system = this.registry.getSystemEntry()
    return system?.publicUrl || `http://localhost:${this.systemPort || this.config.port}`
  }

  getStore(): ViewerStore {
    return this.store
  }

  fileUrl(entryId: string): string {
    return `${this.getPublicUrl()}/view/${entryId}`
  }

  diffUrl(entryId: string): string {
    return `${this.getPublicUrl()}/diff/${entryId}`
  }
}
