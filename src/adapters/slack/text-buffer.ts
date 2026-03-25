// src/adapters/slack/text-buffer.ts
// Buffers streamed text chunks per session and flushes as a single Slack message.
// This prevents the "many tiny messages" problem from streaming AI responses.

import type { ISlackSendQueue } from "./send-queue.js";
import { markdownToMrkdwn } from "./formatter.js";
import { splitSafe } from "./utils.js";
import { createChildLogger } from "../../core/log.js";

const log = createChildLogger({ module: "slack-text-buffer" });

const FLUSH_IDLE_MS = 2000; // flush after 2s of no new chunks

export class SlackTextBuffer {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushPromise: Promise<void> | undefined;
  private lastMessageTs: string | undefined;
  private lastPostedText: string | undefined;

  constructor(
    private channelId: string,
    private sessionId: string,
    private queue: ISlackSendQueue,
  ) {}

  append(text: string): void {
    if (!text) return;
    this.buffer += text;
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush().catch((err) => log.error({ err, sessionId: this.sessionId }, "Text buffer flush error"));
    }, FLUSH_IDLE_MS);
  }

  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    const text = this.buffer.trim();
    if (!text) return;
    this.buffer = "";
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }

    this.flushPromise = (async () => {
      try {
        const converted = markdownToMrkdwn(text);
        const chunks = splitSafe(converted);
        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          const result = await this.queue.enqueue("chat.postMessage", {
            channel: this.channelId,
            text: chunk,
            blocks: [{ type: "section", text: { type: "mrkdwn", text: chunk } }],
          });
          // Track last posted message for potential TTS block editing
          this.lastMessageTs = (result as { ts?: string } | undefined)?.ts;
          this.lastPostedText = chunk;
        }
      } finally {
        this.flushPromise = undefined;
        // Re-flush if content arrived while we were flushing
        if (this.buffer.trim()) {
          await this.flush();
        }
      }
    })();

    return this.flushPromise;
  }

  destroy(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.buffer = "";
  }

  /** Remove [TTS]...[/TTS] blocks — from buffer if unflushed, or edit posted message */
  async stripTtsBlock(): Promise<void> {
    // Case 1: TTS block still in unflushed buffer
    if (/\[TTS\][\s\S]*?\[\/TTS\]/.test(this.buffer)) {
      this.buffer = this.buffer.replace(/\[TTS\][\s\S]*?\[\/TTS\]/g, "").replace(/\s{2,}/g, " ").trim();
      return;
    }

    // Case 2: Already flushed — edit the posted message via chat.update
    if (this.lastMessageTs && this.lastPostedText && /\[TTS\][\s\S]*?\[\/TTS\]/.test(this.lastPostedText)) {
      const cleaned = this.lastPostedText.replace(/\[TTS\][\s\S]*?\[\/TTS\]/g, "").replace(/\s{2,}/g, " ").trim();
      if (cleaned) {
        await this.queue.enqueue("chat.update", {
          channel: this.channelId,
          ts: this.lastMessageTs,
          text: cleaned,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: cleaned } }],
        });
      }
      this.lastPostedText = cleaned;
    }
  }
}
