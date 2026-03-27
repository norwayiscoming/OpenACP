import type { Bot } from "grammy";
import { createChildLogger } from "../../core/utils/log.js";
import type { PlanEntry } from "../../core/types.js";
import type {
  ToolCallMeta,
  DisplayVerbosity,
  ViewerLinks,
} from "../../core/adapter-primitives/format-types.js";
import type { SendQueue } from "../../core/adapter-primitives/primitives/send-queue.js";
import { ToolCardState } from "../../core/adapter-primitives/primitives/tool-card-state.js";
import type { ToolCardSnapshot } from "../../core/adapter-primitives/primitives/tool-card-state.js";
import { renderToolCard } from "./formatting.js";

const log = createChildLogger({ module: "telegram:activity" });

// ─── ThinkingIndicator ────────────────────────────────────────────────────────

const THINKING_REFRESH_MS = 15_000;
const THINKING_MAX_MS = 3 * 60 * 1000;

export class ThinkingIndicator {
  private msgId?: number;
  private sending = false;
  private dismissed = false;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private showTime = 0;

  constructor(
    private api: Bot["api"],
    private chatId: number,
    private threadId: number,
    private sendQueue: SendQueue,
  ) {}

  async show(): Promise<void> {
    if (this.msgId || this.sending || this.dismissed) return;
    this.sending = true;
    this.showTime = Date.now();
    try {
      const result = await this.sendQueue.enqueue(() =>
        this.api.sendMessage(this.chatId, "💭 <i>Thinking...</i>", {
          message_thread_id: this.threadId,
          parse_mode: "HTML",
          disable_notification: true,
        }),
      );
      if (result && !this.dismissed) {
        this.msgId = result.message_id;
        this.startRefreshTimer();
      }
    } catch (err) {
      log.warn({ err }, "ThinkingIndicator.show() failed");
    } finally {
      this.sending = false;
    }
  }

  /** Clear state — stops refresh timer, no Telegram API call */
  dismiss(): void {
    this.dismissed = true;
    this.msgId = undefined;
    this.stopRefreshTimer();
  }

  /** Reset for a new prompt cycle */
  reset(): void {
    this.dismissed = false;
  }

  private startRefreshTimer(): void {
    this.stopRefreshTimer();
    this.refreshTimer = setInterval(() => {
      if (
        this.dismissed ||
        !this.msgId ||
        Date.now() - this.showTime >= THINKING_MAX_MS
      ) {
        this.stopRefreshTimer();
        return;
      }
      const elapsed = Math.round((Date.now() - this.showTime) / 1000);
      this.sendQueue
        .enqueue(() => {
          // Re-check after waiting in queue — dismiss may have been called
          if (this.dismissed || !this.msgId) return Promise.resolve(undefined);
          return this.api.editMessageText(
            this.chatId,
            this.msgId,
            `💭 <i>Still thinking... (${elapsed}s)</i>`,
            { parse_mode: "HTML" },
          );
        })
        .then(() => {})
        .catch(() => {});
    }, THINKING_REFRESH_MS);
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}

// ─── ToolCard ─────────────────────────────────────────────────────────────────

export class ToolCard {
  private state: ToolCardState;
  private msgId?: number;
  private lastSentText?: string;
  private flushPromise: Promise<void> = Promise.resolve();

  constructor(
    private api: Bot["api"],
    private chatId: number,
    private threadId: number,
    private sendQueue: SendQueue,
    verbosity: DisplayVerbosity,
  ) {
    this.state = new ToolCardState({
      verbosity,
      onFlush: (snapshot) => {
        this.flushPromise = this.flushPromise
          .then(() => this._sendOrEdit(snapshot))
          .catch(() => {});
      },
    });
  }

  addTool(meta: ToolCallMeta, kind: string, rawInput: unknown): void {
    this.state.addTool(meta, kind, rawInput);
  }

  updateTool(
    id: string,
    status: string,
    viewerLinks?: ViewerLinks,
    viewerFilePath?: string,
  ): void {
    this.state.updateTool(id, status, viewerLinks, viewerFilePath);
  }

  updatePlan(entries: PlanEntry[]): void {
    this.state.updatePlan(entries);
  }

  appendUsage(usage: {
    tokensUsed?: number;
    contextSize?: number;
    cost?: number;
  }): void {
    this.state.appendUsage(usage);
  }

  async finalize(): Promise<void> {
    this.state.finalize();
    await this.flushPromise;
  }

  destroy(): void {
    this.state.destroy();
  }

  hasContent(): boolean {
    return this.state.hasContent();
  }

  getMsgId(): number | undefined {
    return this.msgId;
  }

  private async _sendOrEdit(snapshot: ToolCardSnapshot): Promise<void> {
    const text = renderToolCard(snapshot);
    if (!text) return;
    if (this.msgId && text === this.lastSentText) return;
    this.lastSentText = text;
    try {
      if (this.msgId) {
        await this.sendQueue.enqueue(() =>
          this.api.editMessageText(this.chatId, this.msgId!, text, {
            parse_mode: "HTML",
          }),
        );
      } else {
        const result = await this.sendQueue.enqueue(() =>
          this.api.sendMessage(this.chatId, text, {
            message_thread_id: this.threadId,
            parse_mode: "HTML",
            disable_notification: true,
          }),
        );
        if (result) this.msgId = result.message_id;
      }
    } catch (err) {
      log.warn({ err }, "[ToolCard] send/edit failed");
    }
  }
}

// ─── ActivityTracker ──────────────────────────────────────────────────────────

export class ActivityTracker {
  private isFirstEvent = true;
  private thinking: ThinkingIndicator;
  private toolCard: ToolCard;

  constructor(
    private api: Bot["api"],
    private chatId: number,
    private threadId: number,
    private sendQueue: SendQueue,
    verbosity: DisplayVerbosity = "medium",
  ) {
    this.thinking = new ThinkingIndicator(api, chatId, threadId, sendQueue);
    this.toolCard = new ToolCard(api, chatId, threadId, sendQueue, verbosity);
  }

  async onNewPrompt(): Promise<void> {
    this.isFirstEvent = true;
    this.thinking.dismiss();
    this.thinking.reset();
  }

  async onThought(): Promise<void> {
    this.isFirstEvent = false;
    await this.thinking.show();
  }

  async onTextStart(): Promise<void> {
    this.isFirstEvent = false;
    this.thinking.dismiss();
  }

  async onToolCall(
    meta: ToolCallMeta,
    kind: string,
    rawInput: unknown,
  ): Promise<void> {
    this.isFirstEvent = false;
    this.thinking.dismiss();
    this.thinking.reset();
    this.toolCard.addTool(meta, kind, rawInput);
  }

  async onToolUpdate(
    id: string,
    status: string,
    viewerLinks?: ViewerLinks,
    viewerFilePath?: string,
  ): Promise<void> {
    this.toolCard.updateTool(id, status, viewerLinks, viewerFilePath);
  }

  async onPlan(entries: PlanEntry[]): Promise<void> {
    this.isFirstEvent = false;
    this.thinking.dismiss();
    this.toolCard.updatePlan(entries);
  }

  async sendUsage(usage: {
    tokensUsed?: number;
    contextSize?: number;
    cost?: number;
  }): Promise<void> {
    this.toolCard.appendUsage(usage);
  }

  getUsageMsgId(): number | undefined {
    return this.toolCard.getMsgId();
  }

  async cleanup(): Promise<void> {
    this.thinking.dismiss();
    await this.toolCard.finalize();
    this.toolCard.destroy();
  }

  destroy(): void {
    this.thinking.dismiss();
    this.toolCard.destroy();
  }
}
