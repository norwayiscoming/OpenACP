import type { Bot } from "grammy";
import type { SendQueue } from "../../core/adapter-primitives/primitives/send-queue.js";
import { ToolCallTracker as SharedToolCallTracker } from "../../core/adapter-primitives/primitives/tool-call-tracker.js";
import { formatToolCall, formatToolUpdate } from "./formatting.js";
import { createChildLogger } from "../../core/utils/log.js";
import type {
  ToolCallMeta,
  DisplayVerbosity,
} from "../../core/adapter-primitives/format-types.js";

const log = createChildLogger({ module: "tool-call-tracker" });

/** Telegram-specific state that augments the shared tracker's data. */
interface TelegramToolState {
  ready: Promise<void>;
}

/**
 * Telegram-specific tool call tracker that composes the shared ToolCallTracker
 * for state management, adding Telegram send/edit via grammY API on top.
 */
export class TelegramToolCallTracker {
  private tracker = new SharedToolCallTracker();
  /** Platform-specific ready-promise per tool call, keyed by `${sessionId}:${toolId}`. */
  private readyMap = new Map<string, TelegramToolState>();

  constructor(
    private bot: Bot,
    private chatId: number,
    private sendQueue: SendQueue,
  ) {}

  async trackNewCall(
    sessionId: string,
    threadId: number,
    meta: ToolCallMeta,
    verbosity: DisplayVerbosity = "medium",
  ): Promise<void> {
    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => {
      resolveReady = r;
    });

    const key = `${sessionId}:${meta.id}`;
    this.readyMap.set(key, { ready });

    // Track with placeholder messageId; we'll update after send
    this.tracker.track(sessionId, meta, "0");

    try {
      const msg = await this.sendQueue.enqueue(() =>
        this.bot.api.sendMessage(this.chatId, formatToolCall(meta, verbosity), {
          message_thread_id: threadId,
          parse_mode: "HTML",
          disable_notification: true,
        }),
      );

      // Update the tracked tool's messageId with the real one
      const tracked = this.tracker.update(sessionId, meta.id, meta.status ?? "running");
      if (tracked) {
        tracked.messageId = String(msg!.message_id);
      }
    } finally {
      resolveReady();
    }
  }

  async updateCall(
    sessionId: string,
    meta: ToolCallMeta & { status: string },
    verbosity: DisplayVerbosity = "medium",
  ): Promise<void> {
    const key = `${sessionId}:${meta.id}`;
    const readyState = this.readyMap.get(key);

    // Apply state update via shared tracker
    const tracked = this.tracker.update(sessionId, meta.id, meta.status, {
      viewerLinks: meta.viewerLinks,
      viewerFilePath: meta.viewerFilePath,
      name: meta.name,
      kind: meta.kind,
    });
    if (!tracked) return;

    // Only edit on terminal status — minimizes API calls to avoid rate limits
    const isTerminal = meta.status === "completed" || meta.status === "failed";
    if (!isTerminal) return;

    // Wait for the initial send to complete before editing
    if (readyState) {
      await readyState.ready;
    }

    const msgId = Number(tracked.messageId);

    log.debug(
      {
        toolId: meta.id,
        status: meta.status,
        hasViewerLinks: !!tracked.viewerLinks,
        viewerLinks: tracked.viewerLinks,
        name: tracked.name,
        msgId,
      },
      "Tool completed, preparing edit",
    );

    const merged: ToolCallMeta & { status: string } = {
      id: meta.id,
      name: tracked.name,
      kind: tracked.kind,
      rawInput: tracked.rawInput,
      viewerLinks: tracked.viewerLinks,
      viewerFilePath: tracked.viewerFilePath,
      displaySummary: tracked.displaySummary,
      displayTitle: tracked.displayTitle,
      displayKind: tracked.displayKind,
      status: meta.status,
      content: meta.content,
    };
    const formattedText = formatToolUpdate(merged, verbosity);

    try {
      await this.sendQueue.enqueue(() =>
        this.bot.api.editMessageText(
          this.chatId,
          msgId,
          formattedText,
          { parse_mode: "HTML" },
        ),
      );
    } catch (err) {
      log.warn(
        {
          err,
          msgId,
          textLen: formattedText.length,
          hasViewerLinks: !!merged.viewerLinks,
        },
        "Tool update edit failed",
      );
    }
  }

  cleanup(sessionId: string): void {
    // Clean up ready promises for this session
    const active = this.tracker.getActive(sessionId);
    for (const tool of active) {
      this.readyMap.delete(`${sessionId}:${tool.id}`);
    }
    this.tracker.clear(sessionId);
  }
}
