import type { Bot } from 'grammy'
import { markdownToTelegramHtml, splitMessage } from './formatting.js'
import type { TelegramSendQueue } from './send-queue.js'

const FLUSH_INTERVAL = 5000

export class MessageDraft {
  private buffer: string = ''
  private messageId?: number
  private firstFlushPending = false
  private flushTimer?: ReturnType<typeof setTimeout>
  private flushPromise: Promise<void> = Promise.resolve()
  private lastSentBuffer: string = ''
  private displayTruncated = false

  constructor(
    private bot: Bot,
    private chatId: number,
    private threadId: number,
    private sendQueue: TelegramSendQueue,
    private sessionId: string,
  ) {}

  append(text: string): void {
    if (!text) return
    this.buffer += text
    this.scheduleFlush()
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

  private async flush(): Promise<void> {
    if (!this.buffer) return
    if (this.firstFlushPending) return

    // CRITICAL: Snapshot the buffer BEFORE any await.
    // append() can be called synchronously while we're awaiting sendQueue,
    // so this.buffer may change. We must track what was ACTUALLY sent.
    const snapshot = this.buffer

    let html = markdownToTelegramHtml(snapshot)
    if (!html) return
    let truncated = false
    if (html.length > 4096) {
      // Estimate markdown cut point proportionally, then find a line boundary
      const ratio = 4000 / html.length
      const targetLen = Math.floor(snapshot.length * ratio)
      let cutAt = snapshot.lastIndexOf('\n', targetLen)
      if (cutAt < targetLen * 0.5) cutAt = targetLen
      html = markdownToTelegramHtml(snapshot.slice(0, cutAt) + '\n…')
      truncated = true
      if (html.length > 4096) {
        html = html.slice(0, 4090) + '\n…'
      }
    }

    if (!this.messageId) {
      this.firstFlushPending = true
      try {
        const result = await this.sendQueue.enqueue(
          () => this.bot.api.sendMessage(this.chatId, html, {
            message_thread_id: this.threadId,
            parse_mode: 'HTML',
            disable_notification: true,
          }),
          { type: 'other' },
        )
        if (result) {
          this.messageId = result.message_id
          if (!truncated) {
            this.lastSentBuffer = snapshot
            this.displayTruncated = false
          } else {
            this.displayTruncated = true
          }
        }
      } catch {
        // sendMessage failed — next flush will retry
      } finally {
        this.firstFlushPending = false
      }
    } else {
      try {
        const result = await this.sendQueue.enqueue(
          () => this.bot.api.editMessageText(this.chatId, this.messageId!, html, {
            parse_mode: 'HTML',
          }),
          { type: 'text', key: this.sessionId },
        )
        // Only mark as sent if the edit was actually executed (not dropped by dedup/rate-limit)
        if (result !== undefined) {
          if (!truncated) {
            this.lastSentBuffer = snapshot
            this.displayTruncated = false
          } else {
            this.displayTruncated = true
          }
        }
      } catch {
        // Don't reset messageId — transient errors (rate limit, network) would cause
        // the next flush to sendMessage the full buffer as a NEW message, creating duplicates.
        // If the message was truly deleted, finalize() handles the fallback.
      }
    }
  }

  async finalize(): Promise<number | undefined> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    await this.flushPromise

    if (!this.buffer) return this.messageId

    // Skip if buffer was already fully sent by flush() and nothing new was appended.
    // Do NOT skip if flush() truncated the display — finalize must send the full content.
    if (this.messageId && this.buffer === this.lastSentBuffer && !this.displayTruncated) {
      return this.messageId
    }

    // Try sending full buffer as a single message first (most common case).
    // Only split if HTML exceeds Telegram's 4096 char limit.
    const fullHtml = markdownToTelegramHtml(this.buffer)
    if (fullHtml.length <= 4096) {
      try {
        if (this.messageId) {
          await this.sendQueue.enqueue(
            () => this.bot.api.editMessageText(this.chatId, this.messageId!, fullHtml, {
              parse_mode: 'HTML',
            }),
            { type: 'other' },
          )
        } else {
          const msg = await this.sendQueue.enqueue(
            () => this.bot.api.sendMessage(this.chatId, fullHtml, {
              message_thread_id: this.threadId,
              parse_mode: 'HTML',
              disable_notification: true,
            }),
            { type: 'other' },
          )
          if (msg) this.messageId = msg.message_id
        }
        return this.messageId
      } catch {
        // HTML send failed — fall through to split/fallback below
      }
    }

    // HTML > 4096 or single send failed — split markdown, convert each chunk separately.
    // This prevents breaking HTML tags (e.g. <pre><code>) at split boundaries.
    const mdChunks = splitMessage(this.buffer)

    for (let i = 0; i < mdChunks.length; i++) {
      const html = markdownToTelegramHtml(mdChunks[i])
      try {
        if (i === 0 && this.messageId) {
          await this.sendQueue.enqueue(
            () => this.bot.api.editMessageText(this.chatId, this.messageId!, html, {
              parse_mode: 'HTML',
            }),
            { type: 'other' },
          )
        } else {
          const msg = await this.sendQueue.enqueue(
            () => this.bot.api.sendMessage(this.chatId, html, {
              message_thread_id: this.threadId,
              parse_mode: 'HTML',
              disable_notification: true,
            }),
            { type: 'other' },
          )
          if (msg) {
            this.messageId = msg.message_id
          }
        }
      } catch {
        // HTML failed for this chunk — try plain text fallback
        try {
          if (i === 0 && this.messageId) {
            await this.sendQueue.enqueue(
              () => this.bot.api.editMessageText(this.chatId, this.messageId!, mdChunks[i].slice(0, 4096)),
              { type: 'other' },
            )
          } else {
            const msg = await this.sendQueue.enqueue(
              () => this.bot.api.sendMessage(this.chatId, mdChunks[i].slice(0, 4096), {
                message_thread_id: this.threadId,
                disable_notification: true,
              }),
              { type: 'other' },
            )
            if (msg) {
              this.messageId = msg.message_id
            }
          }
        } catch {
          // Give up on this chunk
        }
      }
    }

    return this.messageId
  }

  getMessageId(): number | undefined {
    return this.messageId
  }
}
