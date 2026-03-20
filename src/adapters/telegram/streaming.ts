import type { Bot } from 'grammy'
import { createChildLogger } from '../../core/log.js'
import { markdownToTelegramHtml, splitMessage } from './formatting.js'
import type { TelegramSendQueue } from './send-queue.js'

const log = createChildLogger({ module: 'streaming' })

let nextDraftId = 1

export type ChatType = 'private' | 'group' | 'supergroup' | 'channel'

export class MessageDraft {
  // Once sendMessageDraft fails for a chat, skip it for all future drafts
  private static draftUnsupportedChats = new Set<number>()

  private draftId: number
  private buffer: string = ''
  private lastFlush: number = 0
  private flushTimer?: ReturnType<typeof setTimeout>
  private flushPromise: Promise<void> = Promise.resolve()
  private minInterval: number
  private useFallback: boolean
  private messageId?: number  // Only set in fallback mode (sendMessageDraft returns true, not Message)

  constructor(
    private bot: Bot,
    private chatId: number,
    private threadId: number,
    throttleMs = 200,
    private sendQueue?: TelegramSendQueue,
    chatType?: ChatType,
  ) {
    this.draftId = nextDraftId++
    // sendMessageDraft only works in private chats (Telegram Bot API limitation)
    const draftSupported = chatType === 'private' && !MessageDraft.draftUnsupportedChats.has(chatId)
    this.useFallback = !draftSupported
    this.minInterval = this.useFallback ? Math.max(throttleMs, 1000) : throttleMs
  }

  append(text: string): void {
    this.buffer += text
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    const now = Date.now()
    const elapsed = now - this.lastFlush

    if (elapsed >= this.minInterval) {
      this.flushPromise = this.flushPromise.then(() => this.flush()).catch(() => {})
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined
        this.flushPromise = this.flushPromise.then(() => this.flush()).catch(() => {})
      }, this.minInterval - elapsed)
    }
  }

  private async flush(): Promise<void> {
    if (!this.buffer) return
    this.lastFlush = Date.now()

    const html = markdownToTelegramHtml(this.buffer)
    const truncated = html.length > 4096 ? html.slice(0, 4090) + '\n...' : html
    if (!truncated) return

    if (this.useFallback) {
      await this.flushFallback(truncated)
      return
    }

    try {
      await this.bot.api.sendMessageDraft(this.chatId, this.draftId, truncated, {
        message_thread_id: this.threadId,
        parse_mode: 'HTML',
      })
    } catch (err) {
      // sendMessageDraft not supported for this chat (e.g. forum supergroups) — use editMessageText for all future drafts
      log.info({ err, chatId: this.chatId }, 'sendMessageDraft unsupported, using editMessageText fallback')
      MessageDraft.draftUnsupportedChats.add(this.chatId)
      this.useFallback = true
      this.minInterval = 1000  // Slower interval for editMessageText
      await this.flushFallback(truncated)
    }
  }

  private async flushFallback(html: string): Promise<void> {
    // Route through send queue when available (fallback uses editMessageText which shares rate limits)
    const exec = this.sendQueue
      ? <T>(fn: () => Promise<T>) => this.sendQueue!.enqueue(fn)
      : <T>(fn: () => Promise<T>) => fn()

    try {
      if (!this.messageId) {
        const msg = await exec(() =>
          this.bot.api.sendMessage(this.chatId, html, {
            message_thread_id: this.threadId,
            parse_mode: 'HTML',
            disable_notification: true,
          }),
        )
        this.messageId = msg!.message_id
      } else {
        await exec(() =>
          this.bot.api.editMessageText(this.chatId, this.messageId!, html, {
            parse_mode: 'HTML',
          }),
        )
      }
    } catch {
      try {
        if (!this.messageId) {
          const msg = await exec(() =>
            this.bot.api.sendMessage(this.chatId, this.buffer.slice(0, 4096), {
              message_thread_id: this.threadId,
              disable_notification: true,
            }),
          )
          this.messageId = msg!.message_id
        }
      } catch {
        // Give up on this flush
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

    const html = markdownToTelegramHtml(this.buffer)
    const chunks = splitMessage(html)

    const exec = this.sendQueue
      ? <T>(fn: () => Promise<T>) => this.sendQueue!.enqueue(fn)
      : <T>(fn: () => Promise<T>) => fn()

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        if (i === 0 && this.messageId) {
          // Fallback mode only: messageId is only set when using sendMessage+editMessageText
          await exec(() =>
            this.bot.api.editMessageText(this.chatId, this.messageId!, chunk, {
              parse_mode: 'HTML',
            }),
          )
        } else {
          // sendMessage replaces the draft (non-fallback) or creates new message (fallback/splits)
          const msg = await exec(() =>
            this.bot.api.sendMessage(this.chatId, chunk, {
              message_thread_id: this.threadId,
              parse_mode: 'HTML',
              disable_notification: true,
            }),
          )
          this.messageId = msg!.message_id
        }
      }
    } catch {
      try {
        await exec(() =>
          this.bot.api.sendMessage(this.chatId, this.buffer.slice(0, 4096), {
            message_thread_id: this.threadId,
            disable_notification: true,
          }),
        )
      } catch {
        // Give up
      }
    }

    return this.messageId
  }

  getMessageId(): number | undefined {
    return this.messageId
  }
}
