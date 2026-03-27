import type { Bot } from 'grammy'
import { markdownToTelegramHtml, splitMessage } from './formatting.js'
import type { SendQueue } from '../../core/adapter-primitives/primitives/send-queue.js'

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
    private sendQueue: SendQueue,
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

    // Try sending full buffer as a single message (most common case).
    // Only split if HTML exceeds Telegram's 4096 char limit.
    const fullHtml = markdownToTelegramHtml(this.buffer)
    if (fullHtml.length <= 4096) {
      // Single enqueue — no ordering issue possible
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
    //
    // CRITICAL: Enqueue ALL chunks in a tight synchronous loop (no await between
    // enqueues). This prevents concurrent event handlers (usage, session_end) from
    // slipping their messages between our chunks in the sendQueue.
    const mdChunks = splitMessage(this.buffer)
    const chunkPromises: Promise<void>[] = []

    for (let i = 0; i < mdChunks.length; i++) {
      const html = markdownToTelegramHtml(mdChunks[i])
      const isEdit = i === 0 && !!this.messageId
      const chunkMd = mdChunks[i]

      const fn = isEdit
        ? () => this.bot.api.editMessageText(this.chatId, this.messageId!, html, { parse_mode: 'HTML' }) as Promise<unknown>
        : () => this.bot.api.sendMessage(this.chatId, html, {
            message_thread_id: this.threadId,
            parse_mode: 'HTML',
            disable_notification: true,
          })
      const promise = this.sendQueue.enqueue(fn, { type: 'other' })
        .then((result) => {
          if (!isEdit && result && typeof result === 'object' && 'message_id' in (result as Record<string, unknown>)) {
            this.messageId = (result as { message_id: number }).message_id
          }
        })
        .catch(() => {
          // HTML failed — enqueue plain text fallback (goes after all chunks, acceptable)
          const fallbackFn = isEdit
            ? () => this.bot.api.editMessageText(this.chatId, this.messageId!, chunkMd.slice(0, 4096)) as Promise<unknown>
            : () => this.bot.api.sendMessage(this.chatId, chunkMd.slice(0, 4096), {
                message_thread_id: this.threadId,
                disable_notification: true,
              })
          return this.sendQueue.enqueue(fallbackFn, { type: 'other' })
            .then((result) => {
              if (!isEdit && result && typeof result === 'object' && 'message_id' in (result as Record<string, unknown>)) {
                this.messageId = (result as { message_id: number }).message_id
              }
            })
            .catch(() => {})
        })

      chunkPromises.push(promise)
    }

    // All chunks are now in the queue — any items enqueued by concurrent handlers
    // (usage, session_end) will go AFTER our chunks. Safe to await.
    await Promise.all(chunkPromises)

    return this.messageId
  }

  getMessageId(): number | undefined {
    return this.messageId
  }

  async stripPattern(pattern: RegExp): Promise<void> {
    if (!this.messageId || !this.buffer) return

    const stripped = this.buffer.replace(pattern, '').trim()
    if (stripped === this.buffer.trim()) return

    this.buffer = stripped
    this.lastSentBuffer = stripped

    const html = markdownToTelegramHtml(stripped)
    if (!html) return

    try {
      await this.sendQueue.enqueue(
        () => this.bot.api.editMessageText(this.chatId, this.messageId!, html, {
          parse_mode: 'HTML',
        }),
        { type: 'other' },
      )
    } catch {
      // Best effort — non-critical edit
    }
  }
}
