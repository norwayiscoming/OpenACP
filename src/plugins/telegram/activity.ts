import type { Bot } from "grammy";
import { createChildLogger } from "../../core/utils/log.js";
import type { PlanEntry } from "../../core/types.js";
import type { ToolCallMeta, ViewerLinks } from "../../core/adapter-primitives/format-types.js";
import type { SendQueue } from "../../core/adapter-primitives/primitives/send-queue.js";
import type { DebugTracer } from "../../core/utils/debug-tracer.js";
import { ToolCardState } from "../../core/adapter-primitives/primitives/tool-card-state.js";
import type { ToolCardSnapshot } from "../../core/adapter-primitives/primitives/tool-card-state.js";
import { renderToolCard, splitToolCardText } from "./formatting.js";
import { ToolStateMap } from "../../core/adapter-primitives/stream-accumulator.js";
import { ThoughtBuffer } from "../../core/adapter-primitives/stream-accumulator.js";
import { DisplaySpecBuilder } from "../../core/adapter-primitives/display-spec-builder.js";
import type { ToolDisplaySpec } from "../../core/adapter-primitives/display-spec-builder.js";
import type { OutputMode } from "../../core/adapter-primitives/format-types.js";
import type { TunnelServiceInterface } from "../../core/plugin/types.js";

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
  private tracer: DebugTracer | null;

  constructor(
    private api: Bot["api"],
    private chatId: number,
    private threadId: number,
    private sendQueue: SendQueue,
    private sessionId: string = "",
    tracer: DebugTracer | null = null,
  ) {
    this.tracer = tracer;
  }

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
      if (result) {
        this.tracer?.log("telegram", { action: "thinking:show", sessionId: this.sessionId, msgId: result.message_id });
        if (this.dismissed) {
          // dismissed during queue wait — message stays in chat (no delete to save API calls)
        } else {
          this.msgId = result.message_id;
          this.startRefreshTimer();
        }
      }
    } catch (err) {
      log.warn({ err }, "ThinkingIndicator.show() failed");
    } finally {
      this.sending = false;
    }
  }

  /** Dismiss indicator: stops refresh timer. Message is left in chat to reduce API calls. */
  async dismiss(): Promise<void> {
    if (this.dismissed) return;
    this.dismissed = true;
    this.tracer?.log("telegram", { action: "thinking:dismiss", sessionId: this.sessionId });
    this.stopRefreshTimer();
    this.msgId = undefined;
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
  private overflowMsgIds: number[] = [];
  private tracer: DebugTracer | null;
  private sessionId: string;

  constructor(
    private api: Bot["api"],
    private chatId: number,
    private threadId: number,
    private sendQueue: SendQueue,
    sessionId: string = "",
    tracer: DebugTracer | null = null,
  ) {
    this.tracer = tracer;
    this.sessionId = sessionId;
    this.state = new ToolCardState({
      onFlush: (snapshot) => {
        this.flushPromise = this.flushPromise
          .then(() => this._sendOrEdit(snapshot))
          .catch(() => {});
      },
    });
  }

  updateFromSpec(spec: ToolDisplaySpec): void {
    this.state.updateFromSpec(spec);
  }

  updatePlan(entries: PlanEntry[]): void {
    this.state.updatePlan(entries);
  }

  appendUsage(usage: { tokensUsed?: number; contextSize?: number; cost?: number }): void {
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
    // Overflow strip: if full render exceeds Telegram limit, strip inline outputContent
    let snapshotToRender = snapshot;
    let fullText = renderToolCard(snapshotToRender);
    if (fullText.length > 4096) {
      snapshotToRender = {
        ...snapshot,
        specs: snapshot.specs.map((s) =>
          s.outputContent ? { ...s, outputContent: null } : s
        ),
      };
      fullText = renderToolCard(snapshotToRender);
    }

    if (!fullText) return;
    if (this.msgId && fullText === this.lastSentText) return;
    this.lastSentText = fullText;

    const chunks = splitToolCardText(fullText);
    this.tracer?.log("telegram", { action: "toolCard:render", sessionId: this.sessionId, chunks: chunks.length, total: snapshot.totalVisible, completed: snapshot.completedVisible, allComplete: snapshot.allComplete, msgId: this.msgId });

    try {
      const firstChunk = chunks[0];
      if (this.msgId) {
        await this.sendQueue.enqueue(() =>
          this.api.editMessageText(this.chatId, this.msgId!, firstChunk, { parse_mode: "HTML" }),
        );
        this.tracer?.log("telegram", { action: "telegram:edit", sessionId: this.sessionId, msgId: this.msgId });
      } else {
        const result = await this.sendQueue.enqueue(() =>
          this.api.sendMessage(this.chatId, firstChunk, {
            message_thread_id: this.threadId,
            parse_mode: "HTML",
            disable_notification: true,
          }),
        );
        if (result) this.msgId = result.message_id;
        this.tracer?.log("telegram", { action: "telegram:send", sessionId: this.sessionId, msgId: result?.message_id });
      }

      for (let i = 1; i < chunks.length; i++) {
        const overflowIdx = i - 1;
        if (overflowIdx < this.overflowMsgIds.length) {
          await this.sendQueue.enqueue(() =>
            this.api.editMessageText(this.chatId, this.overflowMsgIds[overflowIdx], chunks[i], { parse_mode: "HTML" }),
          );
          this.tracer?.log("telegram", { action: "telegram:edit:overflow", sessionId: this.sessionId, msgId: this.overflowMsgIds[overflowIdx] });
        } else {
          const result = await this.sendQueue.enqueue(() =>
            this.api.sendMessage(this.chatId, chunks[i], {
              message_thread_id: this.threadId,
              parse_mode: "HTML",
              disable_notification: true,
            }),
          );
          if (result) this.overflowMsgIds.push(result.message_id);
          this.tracer?.log("telegram", { action: "telegram:send:overflow", sessionId: this.sessionId, msgId: result?.message_id });
        }
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
  private previousToolCard?: ToolCard;
  private toolStateMap: ToolStateMap;
  private previousToolStateMap?: ToolStateMap;
  private specBuilder: DisplaySpecBuilder;
  private thoughtBuffer: ThoughtBuffer;
  private outputMode: OutputMode;
  private tracer: DebugTracer | null;
  private sessionId: string;

  constructor(
    private api: Bot["api"],
    private chatId: number,
    private threadId: number,
    private sendQueue: SendQueue,
    outputMode: OutputMode = "medium",
    sessionId: string = "",
    tracer: DebugTracer | null = null,
    _tunnelService?: TunnelServiceInterface,
  ) {
    this.outputMode = outputMode;
    this.tracer = tracer;
    this.sessionId = sessionId;
    this.specBuilder = new DisplaySpecBuilder();
    this.toolStateMap = new ToolStateMap();
    this.thoughtBuffer = new ThoughtBuffer();
    this.thinking = new ThinkingIndicator(api, chatId, threadId, sendQueue, sessionId, tracer);
    this.toolCard = new ToolCard(api, chatId, threadId, sendQueue, sessionId, tracer);
  }

  async onNewPrompt(): Promise<void> {
    this.tracer?.log("telegram", { action: "tracker:newPrompt", sessionId: this.sessionId });
    this.isFirstEvent = true;
    this.thoughtBuffer.reset();
    await this.thinking.dismiss();
    this.thinking.reset();
    await this.toolCard.finalize();
    this.toolStateMap.clear();
    this.toolCard = new ToolCard(this.api, this.chatId, this.threadId, this.sendQueue, this.sessionId, this.tracer);
  }

  async onThought(text: string): Promise<void> {
    this.tracer?.log("telegram", { action: "tracker:thought", sessionId: this.sessionId });
    this.isFirstEvent = false;
    if (!this.thoughtBuffer.isSealed()) this.thoughtBuffer.append(text);
    await this.sealToolCardIfNeeded();
    await this.thinking.show();
  }

  async onTextStart(): Promise<void> {
    this.tracer?.log("telegram", { action: "tracker:textStart", sessionId: this.sessionId });
    this.isFirstEvent = false;
    this.thoughtBuffer.seal();
    await this.thinking.dismiss();
    await this.sealToolCardIfNeeded();
  }

  async onToolCall(
    meta: ToolCallMeta,
    kind: string,
    rawInput: unknown,
  ): Promise<void> {
    this.tracer?.log("telegram", { action: "tracker:toolCall", sessionId: this.sessionId, toolId: meta.id, toolName: meta.name, status: meta.status });
    this.isFirstEvent = false;
    await this.thinking.dismiss();
    this.thinking.reset();

    const entry = this.toolStateMap.upsert(meta, kind, rawInput);
    const spec = this.specBuilder.buildToolSpec(entry, this.outputMode);
    this.toolCard.updateFromSpec(spec);
  }

  async onToolUpdate(
    id: string,
    status: string,
    viewerLinks?: ViewerLinks,
    viewerFilePath?: string,
    content?: string | null,
    rawInput?: unknown,
    diffStats?: { added: number; removed: number },
  ): Promise<void> {
    this.tracer?.log("telegram", { action: "tracker:toolUpdate", sessionId: this.sessionId, toolId: id, status, hasPrevCard: !!this.previousToolCard });

    const existed = !!this.toolStateMap.get(id);
    const entry = this.toolStateMap.merge(id, status, rawInput, content, viewerLinks, diffStats);
    // Skip spec build for out-of-order updates — buffered in pendingUpdates
    if (!existed || !entry) return;

    const spec = this.specBuilder.buildToolSpec(entry, this.outputMode);
    this.toolCard.updateFromSpec(spec);
    this.previousToolCard?.updateFromSpec(spec);
    // Forward to previous state map so re-builds use latest data
    this.previousToolStateMap?.merge(id, status, rawInput, content, viewerLinks, diffStats);
  }

  async onPlan(entries: PlanEntry[]): Promise<void> {
    this.tracer?.log("telegram", { action: "tracker:plan", sessionId: this.sessionId, entryCount: entries.length });
    this.isFirstEvent = false;
    await this.thinking.dismiss();
    this.toolCard.updatePlan(entries);
  }

  /** @deprecated Usage is now sent as a separate message by the adapter */
  async sendUsage(_usage: {
    tokensUsed?: number;
    contextSize?: number;
    cost?: number;
  }): Promise<void> {
    // no-op — adapter sends usage as a standalone message
  }

  getToolCardMsgId(): number | undefined {
    return this.toolCard.getMsgId();
  }

  async cleanup(): Promise<void> {
    await this.thinking.dismiss();
    await this.toolCard.finalize();
    this.toolCard.destroy();
  }

  destroy(): void {
    void this.thinking.dismiss();
    this.toolCard.destroy();
  }

  private async sealToolCardIfNeeded(): Promise<void> {
    if (!this.toolCard.hasContent()) return;
    this.tracer?.log("telegram", { action: "tracker:seal", sessionId: this.sessionId });
    await this.toolCard.finalize();
    this.previousToolCard = this.toolCard;
    this.previousToolStateMap = this.toolStateMap;
    this.toolStateMap = new ToolStateMap();
    this.toolCard = new ToolCard(this.api, this.chatId, this.threadId, this.sendQueue, this.sessionId, this.tracer);
  }
}
