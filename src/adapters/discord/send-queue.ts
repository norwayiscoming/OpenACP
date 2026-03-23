import { log } from '../../core/log.js'

export type QueueItemType = 'text' | 'other'

interface QueueItem<T = unknown> {
  fn: () => Promise<T>
  type: QueueItemType
  key?: string
  resolve: (value: T | undefined) => void
  reject: (err: unknown) => void
}

export class DiscordSendQueue {
  private items: QueueItem[] = []
  private processing = false
  private lastExec = 0
  private minInterval: number

  constructor(minInterval = 1000) {
    this.minInterval = minInterval
  }

  enqueue<T>(
    fn: () => Promise<T>,
    opts: { type: 'text' | 'other'; key?: string },
  ): Promise<T | undefined> {
    const type = opts.type
    const key = opts.key

    return new Promise<T | undefined>((resolve, reject) => {
      if (type === 'text' && key) {
        const idx = this.items.findIndex(
          (item) => item.type === 'text' && item.key === key,
        )
        if (idx !== -1) {
          // Resolve old pending item with undefined (dedup: replace with newer)
          this.items[idx].resolve(undefined)
          this.items[idx] = { fn, type, key, resolve, reject } as QueueItem
          this.scheduleProcess()
          return
        }
      }

      this.items.push({ fn, type, key, resolve, reject } as QueueItem)
      this.scheduleProcess()
    })
  }

  onRateLimited(): void {
    log.warn('[DiscordSendQueue] Rate limited — dropping queued text items')
    const remaining: QueueItem[] = []
    for (const item of this.items) {
      if (item.type === 'text') {
        item.resolve(undefined)
      } else {
        remaining.push(item)
      }
    }
    this.items = remaining
  }

  private scheduleProcess(): void {
    if (this.processing) return
    if (this.items.length === 0) return

    const elapsed = Date.now() - this.lastExec
    const delay = Math.max(0, this.minInterval - elapsed)

    this.processing = true
    setTimeout(() => void this.processNext(), delay)
  }

  private async processNext(): Promise<void> {
    const item = this.items.shift()
    if (!item) {
      this.processing = false
      return
    }

    try {
      const result = await item.fn()
      item.resolve(result)
    } catch (err) {
      item.reject(err)
    } finally {
      this.lastExec = Date.now()
      this.processing = false
      this.scheduleProcess()
    }
  }
}
