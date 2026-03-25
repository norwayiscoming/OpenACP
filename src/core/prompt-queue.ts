import type { Attachment } from './types.js'

/**
 * Serial prompt queue — ensures prompts are processed one at a time.
 */
export class PromptQueue {
  private queue: Array<{ text: string; attachments?: Attachment[]; resolve: () => void }> = []
  private processing = false
  private abortController: AbortController | null = null

  constructor(
    private processor: (text: string, attachments?: Attachment[]) => Promise<void>,
    private onError?: (err: unknown) => void,
  ) {}

  async enqueue(text: string, attachments?: Attachment[]): Promise<void> {
    if (this.processing) {
      return new Promise<void>((resolve) => {
        this.queue.push({ text, attachments, resolve })
      })
    }
    await this.process(text, attachments)
  }

  private async process(text: string, attachments?: Attachment[]): Promise<void> {
    this.processing = true
    this.abortController = new AbortController()
    const { signal } = this.abortController
    try {
      await Promise.race([
        this.processor(text, attachments),
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Prompt aborted')), { once: true })
        }),
      ])
    } catch (err) {
      // Only forward non-abort errors to onError handler
      if (!(err instanceof Error && err.message === 'Prompt aborted')) {
        this.onError?.(err)
      }
    } finally {
      this.abortController = null
      this.processing = false
      this.drainNext()
    }
  }

  private drainNext(): void {
    const next = this.queue.shift()
    if (next) {
      this.process(next.text, next.attachments).then(next.resolve)
    }
  }

  clear(): void {
    // Abort the currently running prompt so the queue can drain
    if (this.abortController) {
      this.abortController.abort()
    }
    // Resolve pending promises so callers don't hang
    for (const item of this.queue) {
      item.resolve()
    }
    this.queue = []
  }

  get pending(): number {
    return this.queue.length
  }

  get isProcessing(): boolean {
    return this.processing
  }
}
