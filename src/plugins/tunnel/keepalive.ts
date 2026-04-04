export class TunnelKeepAlive {
  private interval: NodeJS.Timeout | null = null
  private consecutiveFails = 0

  static readonly PING_INTERVAL = 30_000
  static readonly FAIL_THRESHOLD = 3
  static readonly PING_TIMEOUT = 5_000

  start(tunnelUrl: string, onDead: () => void): void {
    this.stop()

    this.interval = setInterval(async () => {
      try {
        const res = await fetch(`${tunnelUrl}/api/v1/system/health`, {
          signal: AbortSignal.timeout(TunnelKeepAlive.PING_TIMEOUT),
        })
        if (res.ok) {
          this.consecutiveFails = 0
        } else {
          this.consecutiveFails++
        }
      } catch {
        this.consecutiveFails++
      }

      if (this.consecutiveFails >= TunnelKeepAlive.FAIL_THRESHOLD) {
        this.stop()
        onDead()
      }
    }, TunnelKeepAlive.PING_INTERVAL)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.consecutiveFails = 0
  }
}
