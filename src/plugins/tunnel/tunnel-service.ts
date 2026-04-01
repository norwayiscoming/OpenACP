import type { TunnelConfig } from '../../core/config/config.js'
import { createChildLogger } from '../../core/utils/log.js'
import { TunnelRegistry, type TunnelEntry } from './tunnel-registry.js'
import { ViewerStore } from './viewer-store.js'

const log = createChildLogger({ module: 'tunnel' })

export class TunnelService {
  private registry: TunnelRegistry
  private store: ViewerStore
  private config: TunnelConfig
  private apiPort: number = 0
  private startError: string | undefined

  constructor(config: TunnelConfig, registryPath?: string, binDir?: string) {
    this.config = config
    this.store = new ViewerStore(config.storeTtlMinutes)
    this.registry = new TunnelRegistry({
      maxUserTunnels: config.maxUserTunnels ?? 5,
      providerOptions: config.options,
      registryPath,
      binDir,
    })
  }

  async start(apiPort: number): Promise<string> {
    this.apiPort = apiPort

    // ViewerStore already initialized in constructor — no change needed there

    // Restore persisted user tunnels
    await this.registry.restore()

    // Register system tunnel pointing to API server port
    if (this.config.provider) {
      try {
        const entry = await this.registry.add(apiPort, {
          type: 'system',
          provider: this.config.provider,
          label: 'system',
        })
        return entry.publicUrl || `http://localhost:${apiPort}`
      } catch (err) {
        this.startError = (err as Error).message
        return `http://localhost:${apiPort}`
      }
    }

    return `http://localhost:${apiPort}`
  }

  async stop(): Promise<void> {
    await this.registry.shutdown()
    this.registry.flush()
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
    if (!this.apiPort) return ''
    const system = this.registry.getSystemEntry()
    return system?.publicUrl || `http://localhost:${this.apiPort}`
  }

  getStartError(): string | undefined {
    return this.startError
  }

  getStore(): ViewerStore {
    return this.store
  }

  fileUrl(entryId: string): string {
    const base = this.getPublicUrl()
    return base ? `${base}/view/${entryId}` : ''
  }

  diffUrl(entryId: string): string {
    const base = this.getPublicUrl()
    return base ? `${base}/diff/${entryId}` : ''
  }

  outputUrl(entryId: string): string {
    const base = this.getPublicUrl()
    return base ? `${base}/output/${entryId}` : ''
  }
}
