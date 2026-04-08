export interface TunnelProvider {
  start(localPort: number): Promise<string>  // returns public URL
  /** Stop the tunnel. When force=true, skip graceful shutdown and SIGKILL immediately.
   *  When preserveState=true, keep tunnel alive on remote (don't delete from worker/storage) for reconnect on restart. */
  stop(force?: boolean, preserveState?: boolean): Promise<void>
  getPublicUrl(): string
  /** Register a callback invoked when the tunnel process exits unexpectedly after establishment. */
  onExit(callback: (code: number | null) => void): void
}
