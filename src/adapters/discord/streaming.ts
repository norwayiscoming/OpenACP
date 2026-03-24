import type { TextChannel, ThreadChannel, Message } from 'discord.js'
import { splitMessage } from './formatting.js'
import type { DiscordSendQueue } from './send-queue.js'

const FLUSH_INTERVAL = 5000
const MAX_DISPLAY_LENGTH = 1900

export class MessageDraft {
  private buffer: string = ''
  private message?: Message
  private flushTimer?: ReturnType<typeof setTimeout>
  private flushPromise: Promise<void> = Promise.resolve()
  private lastSentBuffer: string = ''
  private displayTruncated = false
  private firstFlushPending = false

  constructor(
    private thread: TextChannel | ThreadChannel,
    private sendQueue: DiscordSendQueue,
    private sessionId: string,
  ) {}

  append(text: string): void {
    if (!text) return
    this.buffer += text
    this.scheduleFlush()
  }

  getBuffer(): string {
    return this.buffer
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flushPromise = this.flushPromise
        .then(() => this.flush())
        .catch(() => {})
    }, FLUSH_INTERVAL)
  }

  async flush(): Promise<void> {
    if (!this.buffer) return
    if (this.firstFlushPending) return

    // Snapshot buffer before any await — append() can be called concurrently
    const snapshot = this.buffer

    let content = snapshot
    let truncated = false
    if (content.length > MAX_DISPLAY_LENGTH) {
      content = snapshot.slice(0, MAX_DISPLAY_LENGTH) + '…'
      truncated = true
    }

    if (!content) return

    if (!this.message) {
      this.firstFlushPending = true
      try {
        const result = await this.sendQueue.enqueue(
          () => this.thread.send({ content }),
          { type: 'other' },
        )
        if (result) {
          this.message = result
          if (!truncated) {
            this.lastSentBuffer = snapshot
            this.displayTruncated = false
          } else {
            this.displayTruncated = true
          }
        }
      } catch {
        // send failed — next flush will retry
      } finally {
        this.firstFlushPending = false
      }
    } else {
      // Skip if content hasn't changed since last send
      if (!truncated && snapshot === this.lastSentBuffer) return

      try {
        const result = await this.sendQueue.enqueue(
          () => this.message!.edit({ content }),
          { type: 'text', key: this.sessionId },
        )
        // Only mark as sent if the edit was actually executed (not deduped/dropped)
        if (result !== undefined) {
          if (!truncated) {
            this.lastSentBuffer = snapshot
            this.displayTruncated = false
          } else {
            this.displayTruncated = true
          }
        }
      } catch {
        // Don't reset message — transient errors should not cause duplicate sends
      }
    }
  }

  async finalize(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    // Wait for any in-progress flush to complete
    await this.flushPromise

    if (!this.buffer) return

    // Skip if buffer was already fully sent and nothing new appended
    if (this.message && this.buffer === this.lastSentBuffer && !this.displayTruncated) {
      return
    }

    // Try to send full buffer as a single message (most common case)
    if (this.buffer.length <= MAX_DISPLAY_LENGTH) {
      const content = this.buffer
      try {
        if (this.message) {
          await this.sendQueue.enqueue(
            () => this.message!.edit({ content }),
            { type: 'other' },
          )
        } else {
          await this.sendQueue.enqueue(
            () => this.thread.send({ content }),
            { type: 'other' },
          )
        }
        return
      } catch {
        // Fall through to split approach
      }
    }

    // Buffer exceeds limit or single send failed — split and send chunks
    const chunks = splitMessage(this.buffer, MAX_DISPLAY_LENGTH)

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i]
      try {
        if (i === 0 && this.message) {
          await this.sendQueue.enqueue(
            () => this.message!.edit({ content }),
            { type: 'other' },
          )
        } else {
          const msg = await this.sendQueue.enqueue(
            () => this.thread.send({ content }),
            { type: 'other' },
          )
          if (msg) {
            this.message = msg
          }
        }
      } catch {
        // Skip this chunk — best effort
      }
    }
  }
}
