export interface TunnelProvider {
  start(localPort: number): Promise<string>  // returns public URL
  /** Stop the tunnel. When force=true, skip graceful shutdown and SIGKILL immediately. */
  stop(force?: boolean): Promise<void>
  getPublicUrl(): string
  /** Register a callback invoked when the tunnel process exits unexpectedly after establishment. */
  onExit(callback: (code: number | null) => void): void
}
