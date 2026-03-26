import type { TextChannel, ThreadChannel, Message } from "discord.js";
import { log } from "../../core/log.js";
import { formatToolCall, formatToolUpdate } from "./formatting.js";
import type { DiscordSendQueue } from "./send-queue.js";
import type {
  ToolCallMeta,
  ViewerLinks,
  DisplayVerbosity,
} from "../shared/format-types.js";

interface ToolCallState {
  message?: Message;
  name: string;
  kind?: string;
  rawInput?: unknown;
  viewerLinks?: ViewerLinks;
  viewerFilePath?: string;
  ready: Promise<void>;
}

export class ToolCallTracker {
  sessions: Map<string, Map<string, ToolCallState>> = new Map();

  constructor(private sendQueue: DiscordSendQueue) {}

  async trackNewCall(
    sessionId: string,
    thread: TextChannel | ThreadChannel,
    tool: ToolCallMeta,
    verbosity: DisplayVerbosity = "medium",
  ): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map());
    }

    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => {
      resolveReady = r;
    });

    const state: ToolCallState = {
      message: undefined,
      name: tool.name,
      kind: tool.kind,
      rawInput: tool.rawInput,
      viewerLinks: tool.viewerLinks,
      viewerFilePath: tool.viewerFilePath,
      ready,
    };

    this.sessions.get(sessionId)!.set(tool.id, state);

    const content = formatToolCall(tool, verbosity);

    try {
      const msg = await this.sendQueue.enqueue(() => thread.send({ content }), {
        type: "other",
      });
      if (msg) state.message = msg;
    } catch (err) {
      log.warn(
        { err, toolId: tool.id },
        "[ToolCallTracker] trackNewCall() send failed",
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
    const toolState = this.sessions.get(sessionId)?.get(update.id);
    if (!toolState) return;

    // Accumulate fields from intermediate updates
    if (update.viewerLinks) toolState.viewerLinks = update.viewerLinks;
    if (update.viewerFilePath) toolState.viewerFilePath = update.viewerFilePath;
    if (update.name) toolState.name = update.name;
    if (update.kind) toolState.kind = update.kind;

    // Only edit on terminal status — minimizes API calls to avoid rate limits
    const isTerminal =
      update.status === "completed" || update.status === "failed";
    if (!isTerminal) return;

    // Wait for initial send to complete before editing
    await toolState.ready;

    if (!toolState.message) return;

    log.debug(
      {
        toolId: update.id,
        status: update.status,
        hasViewerLinks: !!toolState.viewerLinks,
        name: toolState.name,
        msgId: toolState.message.id,
      },
      "[ToolCallTracker] Tool completed, preparing edit",
    );

    const merged = {
      ...update,
      name: toolState.name,
      kind: toolState.kind,
      rawInput: toolState.rawInput,
      viewerLinks: toolState.viewerLinks,
      viewerFilePath: toolState.viewerFilePath,
    };
    const content = formatToolUpdate(merged, verbosity);

    try {
      await this.sendQueue.enqueue(() => toolState.message!.edit({ content }), {
        type: "other",
      });
    } catch (err) {
      log.warn(
        {
          err,
          msgId: toolState.message.id,
          contentLen: content.length,
          hasViewerLinks: !!merged.viewerLinks,
        },
        "[ToolCallTracker] Tool update edit failed",
      );
    }
  }

  cleanup(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
