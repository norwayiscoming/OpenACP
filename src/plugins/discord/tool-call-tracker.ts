import type { TextChannel, ThreadChannel, Message } from "discord.js";
import { createChildLogger } from "../../core/utils/log.js";
import { formatToolCall, formatToolUpdate } from "./formatting.js";
import { ToolCallTracker as SharedToolCallTracker } from "../../core/adapter-primitives/primitives/tool-call-tracker.js";
import type { SendQueue } from "../../core/adapter-primitives/primitives/send-queue.js";
import type {
  ToolCallMeta,
  DisplayVerbosity,
} from "../../core/adapter-primitives/format-types.js";

const log = createChildLogger({ module: "discord-tool-call-tracker" });

/** Discord-specific state that augments the shared tracker's data. */
interface DiscordToolState {
  message?: Message;
  ready: Promise<void>;
}

/**
 * Discord-specific tool call tracker that composes the shared ToolCallTracker
 * for state management, adding Discord send/edit via discord.js API on top.
 */
export class DiscordToolCallTracker {
  private tracker = new SharedToolCallTracker();
  /** Platform-specific ready-promise + message per tool call, keyed by `${sessionId}:${toolId}`. */
  private platformState = new Map<string, DiscordToolState>();

  constructor(private sendQueue: SendQueue) {}

  async trackNewCall(
    sessionId: string,
    thread: TextChannel | ThreadChannel,
    tool: ToolCallMeta,
    verbosity: DisplayVerbosity = "medium",
  ): Promise<void> {
    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => {
      resolveReady = r;
    });

    const key = `${sessionId}:${tool.id}`;
    this.platformState.set(key, { message: undefined, ready });

    // Track with placeholder messageId; we'll store real Message object in platformState
    this.tracker.track(sessionId, tool, "0");

    const content = formatToolCall(tool, verbosity);

    try {
      const msg = await this.sendQueue.enqueue(() => thread.send({ content }), {
        type: "other",
      });
      if (msg) {
        const state = this.platformState.get(key);
        if (state) state.message = msg;
      }
    } catch (err) {
      log.warn(
        { err, toolId: tool.id },
        "trackNewCall() send failed",
      );
    } finally {
      resolveReady();
    }
  }

  async updateCall(
    sessionId: string,
    update: ToolCallMeta & { status: string },
    verbosity: DisplayVerbosity = "medium",
  ): Promise<void> {
    const key = `${sessionId}:${update.id}`;
    const state = this.platformState.get(key);

    // Apply state update via shared tracker
    const tracked = this.tracker.update(sessionId, update.id, update.status, {
      viewerLinks: update.viewerLinks,
      viewerFilePath: update.viewerFilePath,
      name: update.name,
      kind: update.kind,
    });
    if (!tracked) return;

    // Only edit on terminal status — minimizes API calls to avoid rate limits
    const isTerminal =
      update.status === "completed" || update.status === "failed";
    if (!isTerminal) return;

    // Wait for initial send to complete before editing
    if (state) {
      await state.ready;
    }

    if (!state?.message) return;

    log.debug(
      {
        toolId: update.id,
        status: update.status,
        hasViewerLinks: !!tracked.viewerLinks,
        name: tracked.name,
        msgId: state.message.id,
      },
      "Tool completed, preparing edit",
    );

    const merged: ToolCallMeta & { status: string } = {
      id: update.id,
      name: tracked.name,
      kind: tracked.kind,
      rawInput: tracked.rawInput,
      viewerLinks: tracked.viewerLinks,
      viewerFilePath: tracked.viewerFilePath,
      displaySummary: tracked.displaySummary,
      displayTitle: tracked.displayTitle,
      displayKind: tracked.displayKind,
      status: update.status,
      content: update.content,
    };
    const content = formatToolUpdate(merged, verbosity);

    try {
      await this.sendQueue.enqueue(() => state.message!.edit({ content }), {
        type: "other",
      });
    } catch (err) {
      log.warn(
        {
          err,
          msgId: state.message.id,
          contentLen: content.length,
          hasViewerLinks: !!merged.viewerLinks,
        },
        "Tool update edit failed",
      );
    }
  }

  cleanup(sessionId: string): void {
    // Clean up platform state for this session
    const active = this.tracker.getActive(sessionId);
    for (const tool of active) {
      this.platformState.delete(`${sessionId}:${tool.id}`);
    }
    this.tracker.clear(sessionId);
  }
}
