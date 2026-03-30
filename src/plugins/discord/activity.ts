import type { TextChannel, ThreadChannel, Message } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { log } from "../../core/utils/log.js";
import type { PlanEntry } from "../../core/types.js";
import { formatUsage, formatPlan } from "./formatting.js";
import type { DisplayVerbosity } from "../../core/adapter-primitives/format-types.js";
import type { SendQueue } from "../../core/adapter-primitives/primitives/send-queue.js";

// ─── ThinkingIndicator ────────────────────────────────────────────────────────

const TYPING_REFRESH_MS = 8_000;

export class ThinkingIndicator {
  private dismissed = false;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(private channel: TextChannel | ThreadChannel) {}

  async show(): Promise<void> {
    if (this.dismissed) return;
    try {
      await this.channel.sendTyping();
      this.startRefreshTimer();
    } catch (err) {
      log.warn({ err }, "[ThinkingIndicator] sendTyping() failed");
    }
  }

  dismiss(): void {
    this.dismissed = true;
    this.stopRefreshTimer();
  }

  reset(): void {
    this.dismissed = false;
  }

  private startRefreshTimer(): void {
    this.stopRefreshTimer();
    this.refreshTimer = setInterval(() => {
      if (this.dismissed) {
        this.stopRefreshTimer();
        return;
      }
      this.channel.sendTyping().catch(() => {});
    }, TYPING_REFRESH_MS);
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}

// ─── UsageMessage ─────────────────────────────────────────────────────────────

export class UsageMessage {
  private message?: Message;

  constructor(
    private thread: TextChannel | ThreadChannel,
    private sendQueue: SendQueue,
  ) {}

  async send(
    usage: { tokensUsed?: number; contextSize?: number; cost?: number },
    verbosity: DisplayVerbosity = "medium",
  ): Promise<void> {
    const text = formatUsage(usage, verbosity);
    const embed = new EmbedBuilder().setDescription(text);
    try {
      if (this.message) {
        await this.sendQueue.enqueue(
          () => this.message!.edit({ embeds: [embed] }),
          { type: "other" },
        );
      } else {
        const result = await this.sendQueue.enqueue(
          () => this.thread.send({ embeds: [embed] }),
          { type: "other" },
        );
        if (result) this.message = result;
      }
    } catch (err) {
      log.warn({ err }, "[UsageMessage] send() failed");
    }
  }

  async delete(): Promise<void> {
    if (!this.message) return;
    const msg = this.message;
    this.message = undefined;
    try {
      await this.sendQueue.enqueue(() => msg.delete(), { type: "other" });
    } catch (err) {
      log.warn({ err }, "[UsageMessage] delete() failed");
    }
  }
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────

const PLAN_DEBOUNCE_MS = 3_500;

export class PlanCard {
  private message?: Message;
  private flushPromise: Promise<void> = Promise.resolve();
  private latestEntries?: PlanEntry[];
  private lastSentText?: string;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private verbosity: DisplayVerbosity = "medium";

  constructor(
    private thread: TextChannel | ThreadChannel,
    private sendQueue: SendQueue,
  ) {}

  setVerbosity(v: DisplayVerbosity): void {
    this.verbosity = v;
  }

  update(entries: PlanEntry[]): void {
    this.latestEntries = entries;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushPromise = this.flushPromise
        .then(() => this._flush())
        .catch(() => {});
    }, PLAN_DEBOUNCE_MS);
  }

  async finalize(): Promise<void> {
    if (!this.latestEntries) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.flushPromise;
    this.flushPromise = this.flushPromise
      .then(() => this._flush())
      .catch(() => {});
    await this.flushPromise;
  }

  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private async _flush(): Promise<void> {
    if (!this.latestEntries) return;
    const text = formatPlan(this.latestEntries, this.verbosity);
    if (this.message && text === this.lastSentText) return;
    this.lastSentText = text;
    const embed = new EmbedBuilder().setDescription(text);
    try {
      if (this.message) {
        await this.sendQueue.enqueue(
          () => this.message!.edit({ embeds: [embed] }),
          { type: "other" },
        );
      } else {
        const result = await this.sendQueue.enqueue(
          () => this.thread.send({ embeds: [embed] }),
          { type: "other" },
        );
        if (result) this.message = result;
      }
    } catch (err) {
      log.warn({ err }, "[PlanCard] flush failed");
    }
  }
}

// ─── ActivityTracker ──────────────────────────────────────────────────────────

export class ActivityTracker {
  private isFirstEvent = true;
  private hasPlanCard = false;
  private thinking: ThinkingIndicator;
  private planCard: PlanCard;
  private usage: UsageMessage;

  constructor(
    private thread: TextChannel | ThreadChannel,
    private sendQueue: SendQueue,
  ) {
    this.thinking = new ThinkingIndicator(thread);
    this.planCard = new PlanCard(thread, sendQueue);
    this.usage = new UsageMessage(thread, sendQueue);
  }

  async onNewPrompt(): Promise<void> {
    this.isFirstEvent = true;
    this.hasPlanCard = false;
    this.thinking.dismiss();
    this.thinking.reset();
  }

  async onThought(): Promise<void> {
    await this._firstEventGuard();
    await this.thinking.show();
  }

  async onTextStart(): Promise<void> {
    await this._firstEventGuard();
    this.thinking.dismiss();
  }

  async onToolCall(): Promise<void> {
    await this._firstEventGuard();
    this.thinking.dismiss();
    this.thinking.reset();
  }

  async onPlan(
    entries: PlanEntry[],
    verbosity?: DisplayVerbosity,
  ): Promise<void> {
    await this._firstEventGuard();
    this.thinking.dismiss();
    this.hasPlanCard = true;
    if (verbosity) this.planCard.setVerbosity(verbosity);
    this.planCard.update(entries);
  }

  async sendUsage(
    usage: { tokensUsed?: number; contextSize?: number; cost?: number },
    verbosity: DisplayVerbosity = "medium",
  ): Promise<void> {
    await this.usage.send(usage, verbosity);
  }

  async cleanup(): Promise<void> {
    this.thinking.dismiss();
    this.planCard.destroy();
    if (this.hasPlanCard) {
      await this.planCard.finalize();
    }
  }

  private async _firstEventGuard(): Promise<void> {
    if (!this.isFirstEvent) return;
    this.isFirstEvent = false;
    await this.usage.delete();
  }
}
