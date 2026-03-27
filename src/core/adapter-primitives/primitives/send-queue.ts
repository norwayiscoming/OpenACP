export type QueueItemType = 'text' | 'other'

export interface SendQueueConfig {
  minInterval: number
  categoryIntervals?: Record<string, number>
  onRateLimited?: () => void
  onError?: (error: Error) => void
}

export interface EnqueueOptions {
  type?: QueueItemType
  key?: string
  category?: string
}

interface QueueItem<T = unknown> {
  fn: () => Promise<T>
  type: QueueItemType
  key?: string
  category?: string
  resolve: (value: T | undefined) => void
  reject: (err: unknown) => void
  promise: Promise<T | undefined>
}

export class SendQueue {
  private items: QueueItem[] = []
  private processing = false
  private lastExec = 0
  private lastCategoryExec = new Map<string, number>()

  constructor(private config: SendQueueConfig) {}

  get pending(): number {
    return this.items.length
  }

  enqueue<T>(
    fn: () => Promise<T>,
    opts?: EnqueueOptions,
  ): Promise<T | undefined> {
    const type = opts?.type ?? 'other'
    const key = opts?.key
    const category = opts?.category

    let resolve!: (value: T | undefined) => void
    let reject!: (err: unknown) => void
    const promise = new Promise<T | undefined>((res, rej) => {
      resolve = res
      reject = rej
    })
    // Suppress unhandled rejection — callers are expected to handle via .catch or await
    promise.catch(() => {})

    if (type === 'text' && key) {
      const idx = this.items.findIndex(
        (item) => item.type === 'text' && item.key === key,
      )
      if (idx !== -1) {
        this.items[idx].resolve(undefined)
        this.items[idx] = { fn, type, key, category, resolve, reject, promise } as QueueItem
        this.scheduleProcess()
        return promise
      }
    }

    this.items.push({ fn, type, key, category, resolve, reject, promise } as QueueItem)
    this.scheduleProcess()
    return promise
  }

  onRateLimited(): void {
    this.config.onRateLimited?.()
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

  clear(): void {
    for (const item of this.items) {
      item.resolve(undefined)
    }
    this.items = []
  }

  private scheduleProcess(): void {
    if (this.processing) return
    if (this.items.length === 0) return

    const item = this.items[0]
    const interval = this.getInterval(item.category)
    const lastExec = item.category
      ? this.lastCategoryExec.get(item.category) ?? 0
      : this.lastExec
    const elapsed = Date.now() - lastExec
    const delay = Math.max(0, interval - elapsed)

    this.processing = true
    setTimeout(() => void this.processNext(), delay)
  }

  private getInterval(category?: string): number {
    if (category && this.config.categoryIntervals?.[category] != null) {
      return this.config.categoryIntervals[category]
    }
    return this.config.minInterval
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
      this.config.onError?.(err instanceof Error ? err : new Error(String(err)))
      item.reject(err)
    } finally {
      const now = Date.now()
      this.lastExec = now
      if (item.category) {
        this.lastCategoryExec.set(item.category, now)
      }
      this.processing = false
      this.scheduleProcess()
    }
  }
}
