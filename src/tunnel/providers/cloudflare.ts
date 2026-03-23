import { spawn, type ChildProcess } from 'node:child_process'
import { createChildLogger } from '../../core/log.js'
import type { TunnelProvider } from '../provider.js'
import { ensureCloudflared } from './install-cloudflared.js'

const log = createChildLogger({ module: 'cloudflare-tunnel' })

export class CloudflareTunnelProvider implements TunnelProvider {
  private child: ChildProcess | null = null
  private publicUrl = ''
  private options: Record<string, unknown>

  constructor(options: Record<string, unknown> = {}) {
    this.options = options
  }

  async start(localPort: number): Promise<string> {
    // Auto-install cloudflared if not present
    const binaryPath = await ensureCloudflared()

    const args = ['tunnel', '--url', `http://localhost:${localPort}`]
    if (this.options.domain) {
      args.push('--hostname', String(this.options.domain))
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop()
        reject(new Error('Cloudflare tunnel timed out after 30s'))
      }, 30_000)

      try {
        this.child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch {
        clearTimeout(timeout)
        reject(new Error(`Failed to start cloudflared at ${binaryPath}`))
        return
      }

      const urlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/

      const onData = (data: Buffer) => {
        const line = data.toString()
        log.debug(line.trim())
        const match = line.match(urlPattern)
        if (match) {
          clearTimeout(timeout)
          this.publicUrl = match[0]
          log.info({ url: this.publicUrl }, 'Cloudflare tunnel ready')
          resolve(this.publicUrl)
        }
      }

      this.child.stdout?.on('data', onData)
      this.child.stderr?.on('data', onData)

      this.child.on('error', (err) => {
        clearTimeout(timeout)
        reject(new Error(`cloudflared failed to start: ${err.message}`))
      })

      this.child.on('exit', (code) => {
        if (!this.publicUrl) {
          clearTimeout(timeout)
          reject(new Error(`cloudflared exited with code ${code} before establishing tunnel`))
        }
      })
    })
  }

  async stop(): Promise<void> {
    if (this.child) {
      this.child.kill('SIGTERM')
      this.child = null
      log.info('Cloudflare tunnel stopped')
    }
  }

  getPublicUrl(): string {
    return this.publicUrl
  }
}
