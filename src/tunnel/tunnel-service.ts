import { serve } from '@hono/node-server'
import type { TunnelConfig } from '../core/config.js'
import { createChildLogger } from '../core/log.js'
import type { TunnelProvider } from './provider.js'
import { CloudflareTunnelProvider } from './providers/cloudflare.js'
import { NgrokTunnelProvider } from './providers/ngrok.js'
import { BoreTunnelProvider } from './providers/bore.js'
import { TailscaleTunnelProvider } from './providers/tailscale.js'
import { ViewerStore } from './viewer-store.js'
import { createTunnelServer } from './server.js'

const log = createChildLogger({ module: 'tunnel' })

export class TunnelService {
  private provider: TunnelProvider
  private store: ViewerStore
  private server: ReturnType<typeof serve> | null = null
  private publicUrl = ''
  private config: TunnelConfig

  constructor(config: TunnelConfig) {
    this.config = config
    this.store = new ViewerStore(config.storeTtlMinutes)
    this.provider = this.createProvider(config.provider, config.options)
  }

  async start(): Promise<string> {
    // 1. Start HTTP server — try configured port, then auto-increment up to 10 times
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
      this.publicUrl = `http://localhost:${this.config.port}`
      return this.publicUrl
    }

    // 2. Start tunnel provider
    try {
      this.publicUrl = await this.provider.start(actualPort)
      log.info({ url: this.publicUrl }, 'Tunnel public URL ready')
    } catch (err) {
      log.warn({ err }, 'Tunnel provider failed to start, running without public URL')
      this.publicUrl = `http://localhost:${actualPort}`
    }

    return this.publicUrl
  }

  async stop(): Promise<void> {
    await this.provider.stop()
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.store.destroy()
    log.info('Tunnel service stopped')
  }

  getPublicUrl(): string {
    return this.publicUrl
  }

  getStore(): ViewerStore {
    return this.store
  }

  fileUrl(entryId: string): string {
    return `${this.publicUrl}/view/${entryId}`
  }

  diffUrl(entryId: string): string {
    return `${this.publicUrl}/diff/${entryId}`
  }

  private createProvider(name: string, options: Record<string, unknown>): TunnelProvider {
    switch (name) {
      case 'cloudflare':
        return new CloudflareTunnelProvider(options)
      case 'ngrok':
        return new NgrokTunnelProvider(options)
      case 'bore':
        return new BoreTunnelProvider(options)
      case 'tailscale':
        return new TailscaleTunnelProvider(options)
      default:
        log.warn({ provider: name }, 'Unknown tunnel provider, falling back to cloudflare')
        return new CloudflareTunnelProvider(options)
    }
  }
}
