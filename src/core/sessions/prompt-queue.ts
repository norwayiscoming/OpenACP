import type { Attachment } from '../types.js'
import type { TurnRouting } from './turn-context.js'

/**
 * Serial prompt queue — ensures prompts are processed one at a time.
 *
 * Agents are stateful (each prompt builds on prior context), so concurrent
 * prompts would corrupt the conversation. This queue guarantees that only
 * one prompt is processed at a time; additional prompts are buffered and
 * drained sequentially after the current one completes.
 */
export class PromptQueue {
  private queue: Array<{ text: string; attachments?: Attachment[]; routing?: TurnRouting; turnId?: string; resolve: () => void }> = []
  private processing = false
  private abortController: AbortController | null = null
  /** Set when abort is triggered; drainNext waits for the current processor to settle before starting the next item. */
  private processorSettled: Promise<void> | null = null

  constructor(
    private processor: (text: string, attachments?: Attachment[], routing?: TurnRouting, turnId?: string) => Promise<void>,
    private onError?: (err: unknown) => void,
  ) {}

  /**
   * Add a prompt to the queue. If no prompt is currently processing, it runs
   * immediately. Otherwise, it's buffered and the returned promise resolves
   * only after the prompt finishes processing.
   */
  async enqueue(text: string, attachments?: Attachment[], routing?: TurnRouting, turnId?: string): Promise<void> {
    if (this.processing) {
      return new Promise<void>((resolve) => {
        this.queue.push({ text, attachments, routing, turnId, resolve })
      })
    }
    await this.process(text, attachments, routing, turnId)
  }

  /** Run a single prompt through the processor, then drain the next queued item. */
  private async process(text: string, attachments?: Attachment[], routing?: TurnRouting, turnId?: string): Promise<void> {
    this.processing = true
    this.abortController = new AbortController()
    const { signal } = this.abortController
    let settledResolve: () => void
    this.processorSettled = new Promise<void>((r) => { settledResolve = r })
    try {
      await Promise.race([
        this.processor(text, attachments, routing, turnId),
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
      settledResolve!()
      this.processorSettled = null
      this.drainNext()
    }
  }

  /** Dequeue and process the next pending prompt, if any. Called after each prompt completes. */
  private drainNext(): void {
    const next = this.queue.shift()
    if (next) {
      this.process(next.text, next.attachments, next.routing, next.turnId).then(next.resolve)
    }
  }

  /**
   * Abort the in-flight prompt and discard all queued prompts.
   * Pending promises are resolved (not rejected) so callers don't see unhandled rejections.
   */
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
