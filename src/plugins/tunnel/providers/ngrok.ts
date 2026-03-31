import { spawn, type ChildProcess } from 'node:child_process'
import { createChildLogger } from '../../../core/utils/log.js'
import type { TunnelProvider } from '../provider.js'

const log = createChildLogger({ module: 'ngrok-tunnel' })

const SIGKILL_TIMEOUT_MS = 5_000

export class NgrokTunnelProvider implements TunnelProvider {
  private child: ChildProcess | null = null
  private publicUrl = ''
  private options: Record<string, unknown>
  private exitCallback: ((code: number | null) => void) | null = null

  constructor(options: Record<string, unknown> = {}) {
    this.options = options
  }

  onExit(callback: (code: number | null) => void): void {
    this.exitCallback = callback
  }

  async start(localPort: number): Promise<string> {
    const args = ['http', String(localPort), '--log', 'stdout', '--log-format', 'json']
    if (this.options.authtoken) {
      args.push('--authtoken', String(this.options.authtoken))
    }
    if (this.options.domain) {
      args.push('--domain', String(this.options.domain))
    }
    if (this.options.region) {
      args.push('--region', String(this.options.region))
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn() } }

      const timeout = setTimeout(() => {
        this.stop()
        settle(() => reject(new Error('ngrok tunnel timed out after 30s. Is ngrok installed?')))
      }, 30_000)

      try {
        this.child = spawn('ngrok', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch {
        clearTimeout(timeout)
        settle(() => reject(new Error(
          'Failed to start ngrok. Install it from https://ngrok.com/download'
        )))
        return
      }

      // Match both v2 (*.ngrok.io) and v3 (*.ngrok-free.app, *.ngrok.app) domains
      const urlPattern = /https:\/\/[a-zA-Z0-9-]+\.(?:ngrok(?:-free)?\.app|ngrok\.io)/

      const onData = (data: Buffer) => {
        const line = data.toString()
        log.debug(line.trim())
        const match = line.match(urlPattern)
        if (match) {
          clearTimeout(timeout)
          this.publicUrl = match[0]
          log.info({ url: this.publicUrl }, 'ngrok tunnel ready')
          settle(() => resolve(this.publicUrl))
        }
      }

      this.child.stdout?.on('data', onData)
      this.child.stderr?.on('data', onData)

      this.child.on('error', (err) => {
        clearTimeout(timeout)
        settle(() => reject(new Error(
          `ngrok failed to start: ${err.message}. Install it from https://ngrok.com/download`
        )))
      })

      this.child.on('exit', (code) => {
        if (!this.publicUrl) {
          clearTimeout(timeout)
          settle(() => reject(new Error(`ngrok exited with code ${code} before establishing tunnel`)))
        } else {
          log.error({ code }, 'ngrok exited unexpectedly after establishment')
          this.child = null
          this.exitCallback?.(code)
        }
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.child = null

    child.kill('SIGTERM')

    const exited = await Promise.race([
      new Promise<boolean>((resolve) => child.on('exit', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SIGKILL_TIMEOUT_MS)),
    ])

    if (!exited) {
      log.warn('ngrok did not exit after SIGTERM, sending SIGKILL')
      child.kill('SIGKILL')
    }

    log.info('ngrok tunnel stopped')
  }

  getPublicUrl(): string {
    return this.publicUrl
  }
}
