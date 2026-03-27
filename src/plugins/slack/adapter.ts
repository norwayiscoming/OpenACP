// src/adapters/slack/adapter.ts
import fs from "node:fs";
import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type { OpenACPCore } from "../../core/core.js";
import type {
  OutgoingMessage,
  PermissionRequest,
  NotificationMessage,
  Attachment,
} from "../../core/types.js";
import type { AdapterCapabilities } from "../../core/channel.js";
import type { FileServiceInterface } from "../../core/plugin/types.js";
import { createChildLogger } from "../../core/utils/log.js";
import { MessagingAdapter, type MessagingAdapterConfig } from "../../core/adapter-primitives/messaging-adapter.js";
import type { DisplayVerbosity } from "../../core/adapter-primitives/format-types.js";
import type { IRenderer } from "../../core/adapter-primitives/rendering/renderer.js";
import { SlackRenderer } from "./renderer.js";
const log = createChildLogger({ module: "slack" });

import type { SlackChannelConfig } from "./types.js";
import type { SlackSessionMeta, SlackFileInfo } from "./types.js";
import { SlackSendQueue } from "./send-queue.js";
import { SlackFormatter } from "./formatter.js";
import { SlackChannelManager } from "./channel-manager.js";
import { SlackPermissionHandler } from "./permission-handler.js";
import { SlackEventRouter } from "./event-router.js";
import { SlackTextBuffer } from "./text-buffer.js";
import { toSlug } from "./slug.js";
import { isAudioClip } from "./utils.js";

export class SlackAdapter extends MessagingAdapter {
  readonly name = 'slack';
  readonly renderer!: IRenderer;
  readonly capabilities: AdapterCapabilities = {
    streaming: true, richFormatting: true, threads: true,
    reactions: false, fileUpload: true, voice: true,
  };

  private core: OpenACPCore;
  private app!: App;
  private webClient!: WebClient;
  private queue!: SlackSendQueue;
  private formatter: SlackFormatter;
  private channelManager!: SlackChannelManager;
  private permissionHandler!: SlackPermissionHandler;
  private eventRouter!: SlackEventRouter;
  private sessions = new Map<string, SlackSessionMeta>();
  private textBuffers = new Map<string, SlackTextBuffer>();
  private botUserId = "";
  private slackConfig: SlackChannelConfig;
  private fileService!: FileServiceInterface;

  constructor(core: OpenACPCore, config: SlackChannelConfig) {
    super(
      { configManager: core.configManager },
      { ...config as Record<string, unknown>, maxMessageLength: 3000, enabled: config.enabled ?? true } as MessagingAdapterConfig,
    );
    this.core = core;
    this.slackConfig = config;
    this.formatter = new SlackFormatter();
    (this as { renderer: IRenderer }).renderer = new SlackRenderer(this.formatter);
  }

  async start(): Promise<void> {
    const { botToken, appToken, signingSecret } = this.slackConfig;

    if (!botToken || !appToken || !signingSecret) {
      throw new Error("Slack adapter requires botToken, appToken, and signingSecret");
    }

    this.app = new App({
      token: botToken,
      appToken,
      signingSecret,
      socketMode: true,
    });

    this.webClient = new WebClient(botToken);
    this.queue = new SlackSendQueue(this.webClient);
    this.fileService = this.core.fileService;

    // Resolve bot user ID — required to filter bot's own messages (prevent infinite loop)
    const authResult = await this.webClient.auth.test();
    if (!authResult.user_id) {
      throw new Error("Slack auth.test() did not return user_id — verify botToken is valid");
    }
    this.botUserId = authResult.user_id as string;
    log.info({ botUserId: this.botUserId }, "Slack bot authenticated");

    this.channelManager = new SlackChannelManager(this.queue, this.slackConfig);

    // Permission handler — resolve permission gate when user clicks a button
    this.permissionHandler = new SlackPermissionHandler(
      this.queue,
      (requestId, optionId) => {
        for (const [sessionId, _meta] of this.sessions) {
          const session = this.core.sessionManager.getSession(sessionId);
          if (session && session.permissionGate.requestId === requestId) {
            session.permissionGate.resolve(optionId);
            log.info({ sessionId, requestId, optionId }, "Permission resolved");
            return;
          }
        }
        log.warn({ requestId, optionId }, "No matching session found for permission response");
      },
    );
    this.permissionHandler.register(this.app);

    // Event router — dispatch incoming messages from session channels to core
    this.eventRouter = new SlackEventRouter(
      (slackChannelId) => {
        for (const meta of this.sessions.values()) {
          if (meta.channelId === slackChannelId) return meta;
        }
        return undefined;
      },
      (sessionChannelSlug, text, userId, files) => {
        const processFiles = async (): Promise<Attachment[] | undefined> => {
          if (!files?.length) return undefined;
          const audioFiles = files.filter((f) => isAudioClip(f));
          if (!audioFiles.length) return undefined;

          const attachments: Attachment[] = [];
          for (const file of audioFiles) {
            const buffer = await this.downloadSlackFile(file.url_private);
            if (!buffer) continue;
            const mimeType = file.mimetype === "video/mp4" ? "audio/mp4" : file.mimetype;
            const sessionId = this.core.sessionManager.getSessionByThread("slack", sessionChannelSlug)?.id;
            if (!sessionId) continue;
            const att = await this.fileService.saveFile(sessionId, file.name, buffer, mimeType);
            attachments.push(att);
          }
          return attachments.length > 0 ? attachments : undefined;
        };

        processFiles()
          .then((attachments) => {
            this.core
              .handleMessage({
                channelId: "slack",
                threadId: sessionChannelSlug,
                userId,
                text,
                attachments,
              })
              .catch((err) => log.error({ err }, "handleMessage error"));
          })
          .catch((err) => log.error({ err }, "Failed to process audio files"));
      },
      this.botUserId,
      this.slackConfig.notificationChannelId,
      // onNewSession: reply with guidance when user messages the notification channel
      async (_text, _userId) => {
        if (this.slackConfig.notificationChannelId) {
          await this.queue.enqueue("chat.postMessage", {
            channel: this.slackConfig.notificationChannelId,
            text: "💬 To start a new session, use the `/openacp-new` slash command in any channel.",
          }).catch((err: unknown) => log.warn({ err }, "Failed to send onNewSession reply"));
        }
      },
      this.slackConfig,
      this.core.configManager.get().security.allowedUserIds,
    );
    this.eventRouter.register(this.app);

    // Start Bolt (Socket Mode)
    await this.app.start();
    log.info("Slack adapter started (Socket Mode)");

    // Create startup session + channel (configurable — set autoCreateSession: false to skip)
    if (this.slackConfig.autoCreateSession !== false) {
      await this._createStartupSession();
    }
  }

  private async downloadSlackFile(url: string): Promise<Buffer | null> {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${this.slackConfig.botToken}` },
      });
      if (!resp.ok) {
        log.warn({ status: resp.status }, "Failed to download Slack file");
        return null;
      }
      // Slack returns 200 with HTML login page if bot lacks files:read scope
      const contentType = resp.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        log.warn("Slack file download returned HTML instead of binary — bot likely missing files:read scope. Reinstall the Slack app with files:read scope.");
        return null;
      }
      return Buffer.from(await resp.arrayBuffer());
    } catch (err) {
      log.error({ err }, "Error downloading Slack file");
      return null;
    }
  }

  private async uploadAudioFile(channelId: string, att: Attachment): Promise<void> {
    const fileBuffer = await fs.promises.readFile(att.filePath);
    await this.webClient.files.uploadV2({
      channel_id: channelId,
      file: fileBuffer,
      filename: att.fileName,
    });
  }

  private async _createStartupSession(): Promise<void> {
    try {
      let reuseChannelId = this.slackConfig.startupChannelId;

      // Try to reuse existing startup channel (Telegram ensureTopics pattern)
      if (reuseChannelId) {
        try {
          const info = await this.queue.enqueue<Record<string, unknown>>(
            "conversations.info", { channel: reuseChannelId },
          );
          const channel = (info as Record<string, unknown>)?.channel as Record<string, unknown> | undefined;
          if (!channel || typeof channel.is_archived !== "boolean") {
            log.warn({ reuseChannelId }, "Unexpected conversations.info response shape, creating new channel");
            reuseChannelId = undefined;
          } else if (channel.is_archived) {
            await this.queue.enqueue("conversations.unarchive", { channel: reuseChannelId });
            log.info({ channelId: reuseChannelId }, "Unarchived startup channel for reuse");
          }
        } catch {
          // Channel deleted or inaccessible — will create new
          reuseChannelId = undefined;
        }
      }

      if (reuseChannelId) {
        // Reuse existing channel — create session pointing to it
        let hasSession = false;
        for (const m of this.sessions.values()) {
          if (m.channelId === reuseChannelId) { hasSession = true; break; }
        }
        if (!hasSession) {
          const session = await this.core.handleNewSession("slack", undefined, undefined, { createThread: false });
          const slug = `startup-${session.id.slice(0, 8)}`;
          this.sessions.set(session.id, { channelId: reuseChannelId, channelSlug: slug });
          session.threadId = slug;
          // Persist slug to session store so session resume after restart can find it
          await this.core.sessionManager.patchRecord(session.id, {
            platform: { topicId: slug },
          });
          log.info({ sessionId: session.id, channelId: reuseChannelId }, "Reused startup channel");
        }
      } else {
        // Create new channel + session
        const session = await this.core.handleNewSession("slack", undefined, undefined, { createThread: true });
        if (!session.threadId) {
          log.error({ sessionId: session.id }, "Startup session created without threadId");
          return;
        }

        // Persist channel ID to config for reuse on next restart
        const meta = this.sessions.get(session.id);
        if (meta) {
          await this.core.configManager.save(
            { channels: { slack: { startupChannelId: meta.channelId } } },
          );
          log.info({ sessionId: session.id, channelId: meta.channelId }, "Saved startup channel to config");
        }
      }

      // Notify
      if (this.slackConfig.notificationChannelId) {
        const startupMeta = [...this.sessions.values()].find(m =>
          m.channelId === (reuseChannelId ?? this.slackConfig.startupChannelId)
        );
        if (startupMeta) {
          await this.queue.enqueue("chat.postMessage", {
            channel: this.slackConfig.notificationChannelId,
            text: `✅ OpenACP ready — chat with the agent in <#${startupMeta.channelId}>`,
          });
        }
      }
    } catch (err) {
      log.error({ err }, "Failed to create/reuse Slack startup session");
    }
  }

  async stop(): Promise<void> {
    // Flush all active text buffers before stopping to prevent data loss
    for (const [sessionId, buf] of this.textBuffers) {
      try {
        await buf.flush();
      } catch (err) {
        log.warn({ err, sessionId }, "Flush failed during stop");
      }
      buf.destroy();
    }
    this.textBuffers.clear();
    await this.app.stop();
    log.info("Slack adapter stopped");
  }

  // --- MessagingAdapter implementations ---

  async createSessionThread(sessionId: string, name: string): Promise<string> {
    const meta = await this.channelManager.createChannel(sessionId, name);
    this.sessions.set(sessionId, meta);
    log.info({ sessionId, channelId: meta.channelId, slug: meta.channelSlug }, "Session channel created");
    // Return the slug as the threadId so that lookups via getSessionByThread work
    return meta.channelSlug;
  }

  async renameSessionThread(sessionId: string, newName: string): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) return;

    const newSlug = toSlug(newName, this.slackConfig.channelPrefix ?? "openacp");

    try {
      await this.queue.enqueue("conversations.rename", {
        channel: meta.channelId,
        name: newSlug,
      });
      meta.channelSlug = newSlug;
      // Update session.threadId so getSessionByThread() keeps working after rename
      const session = this.core.sessionManager.getSession(sessionId);
      if (session) session.threadId = newSlug;
      const existingRecord = this.core.sessionManager.getSessionRecord(sessionId);
      await this.core.sessionManager.patchRecord(sessionId, {
        name: newName,
        platform: { ...(existingRecord?.platform ?? {}), topicId: newSlug },
      });
      log.info({ sessionId, newSlug }, "Session channel renamed");
    } catch (err) {
      log.warn({ err, sessionId }, "Failed to rename Slack channel");
    }
  }

  async deleteSessionThread(sessionId: string): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) return;

    try {
      await this.permissionHandler.cleanupSession(meta.channelId);
    } catch (err) {
      log.warn({ err, sessionId }, "Failed to clean up permission buttons");
    }

    try {
      await this.channelManager.archiveChannel(meta.channelId);
      log.info({ sessionId, channelId: meta.channelId }, "Session channel archived");
    } catch (err) {
      log.warn({ err, sessionId }, "Failed to archive Slack channel");
    }
    this.sessions.delete(sessionId);
    const buf = this.textBuffers.get(sessionId);
    if (buf) { buf.destroy(); this.textBuffers.delete(sessionId); }
  }

  private _sessionMetas = new Map<string, SlackSessionMeta>();

  private getSessionMeta(sessionId: string): SlackSessionMeta | undefined {
    return this._sessionMetas.get(sessionId);
  }

  private getTextBuffer(sessionId: string, channelId: string): SlackTextBuffer {
    let buf = this.textBuffers.get(sessionId);
    if (!buf) {
      buf = new SlackTextBuffer(channelId, sessionId, this.queue);
      this.textBuffers.set(sessionId, buf);
    }
    return buf;
  }

  async sendMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) {
      log.warn({ sessionId }, "No Slack channel for session, skipping message");
      return;
    }

    // Store meta per-session so concurrent calls for different sessions don't overwrite each other
    this._sessionMetas.set(sessionId, meta);
    try {
      await super.sendMessage(sessionId, content);
    } finally {
      this._sessionMetas.delete(sessionId);
    }
  }

  // --- Handler overrides (dispatched by base class) ---

  protected async handleText(sessionId: string, content: OutgoingMessage): Promise<void> {
    const meta = this.getSessionMeta(sessionId);
    if (!meta) return;
    // Text chunks are buffered and flushed as a single message after idle timeout
    const buf = this.getTextBuffer(sessionId, meta.channelId);
    buf.append(content.text ?? "");
  }

  protected async handleSessionEnd(sessionId: string, content: OutgoingMessage): Promise<void> {
    const meta = this.getSessionMeta(sessionId);
    if (!meta) return;
    // Flush any pending text first
    await this.flushTextBuffer(sessionId);

    const blocks = this.formatter.formatOutgoing(content);
    if (blocks.length === 0) return;

    try {
      await this.queue.enqueue("chat.postMessage", {
        channel: meta.channelId,
        text: content.text ?? content.type,
        blocks,
      });
    } catch (err) {
      log.error({ err, sessionId, type: content.type }, "Failed to post Slack message");
    }
  }

  protected async handleError(sessionId: string, content: OutgoingMessage): Promise<void> {
    const meta = this.getSessionMeta(sessionId);
    if (!meta) return;
    // Flush any pending text first
    await this.flushTextBuffer(sessionId);

    const blocks = this.formatter.formatOutgoing(content);
    if (blocks.length === 0) return;

    try {
      await this.queue.enqueue("chat.postMessage", {
        channel: meta.channelId,
        text: content.text ?? content.type,
        blocks,
      });
    } catch (err) {
      log.error({ err, sessionId, type: content.type }, "Failed to post Slack message");
    }
  }

  protected async handleAttachment(sessionId: string, content: OutgoingMessage): Promise<void> {
    const meta = this.getSessionMeta(sessionId);
    if (!meta || !content.attachment) return;
    if (content.attachment.type === "audio") {
      try {
        await this.uploadAudioFile(meta.channelId, content.attachment);
        const buf = this.textBuffers.get(sessionId);
        if (buf) await buf.stripTtsBlock();
      } catch (err) {
        log.error({ err, sessionId }, "Failed to upload audio to Slack");
      }
    }
  }

  protected async handleThought(sessionId: string, content: OutgoingMessage, _verbosity: DisplayVerbosity): Promise<void> {
    await this.postFormattedMessage(sessionId, content);
  }

  protected async handleToolCall(sessionId: string, content: OutgoingMessage, _verbosity: DisplayVerbosity): Promise<void> {
    await this.postFormattedMessage(sessionId, content);
  }

  protected async handleToolUpdate(sessionId: string, content: OutgoingMessage, _verbosity: DisplayVerbosity): Promise<void> {
    await this.postFormattedMessage(sessionId, content);
  }

  protected async handlePlan(sessionId: string, content: OutgoingMessage, _verbosity: DisplayVerbosity): Promise<void> {
    await this.postFormattedMessage(sessionId, content);
  }

  protected async handleUsage(sessionId: string, content: OutgoingMessage, _verbosity: DisplayVerbosity): Promise<void> {
    await this.postFormattedMessage(sessionId, content);
  }

  protected async handleSystem(sessionId: string, content: OutgoingMessage): Promise<void> {
    await this.postFormattedMessage(sessionId, content);
  }

  // --- Private helpers ---

  private async flushTextBuffer(sessionId: string): Promise<void> {
    const buf = this.textBuffers.get(sessionId);
    if (buf) {
      try {
        await buf.flush();
      } catch (err) {
        log.warn({ err, sessionId }, "Flush failed on session_end");
      }
      buf.destroy();
      this.textBuffers.delete(sessionId);
    }
  }

  private async postFormattedMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
    const meta = this.getSessionMeta(sessionId);
    if (!meta) return;
    const blocks = this.formatter.formatOutgoing(content);
    if (blocks.length === 0) return;

    try {
      await this.queue.enqueue("chat.postMessage", {
        channel: meta.channelId,
        text: content.text ?? content.type,
        blocks,
      });
    } catch (err) {
      log.error({ err, sessionId, type: content.type }, "Failed to post Slack message");
    }
  }

  // NOTE: Async flow — different from Telegram adapter.
  // Telegram: sendPermissionRequest awaits user response inline.
  // Slack: posts interactive buttons and returns immediately.
  // Resolution happens asynchronously via the Bolt action handler in
  // SlackPermissionHandler, which calls the PermissionResponseCallback
  // passed during construction. The callback iterates sessions to find
  // the matching permissionGate and resolves it.
  async sendPermissionRequest(
    sessionId: string,
    request: PermissionRequest,
  ): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) return;

    log.info({ sessionId, requestId: request.id }, "Sending Slack permission request");
    const blocks = this.formatter.formatPermissionRequest(request);

    try {
      const result = await this.queue.enqueue("chat.postMessage", {
        channel: meta.channelId,
        text: `Permission request: ${request.description}`,
        blocks,
      });
      const ts = (result as { ts?: string })?.ts;
      if (ts) {
        this.permissionHandler.trackPendingMessage(request.id, meta.channelId, ts);
      }
    } catch (err) {
      log.error({ err, sessionId }, "Failed to post Slack permission request");
    }
  }

  async sendNotification(notification: NotificationMessage): Promise<void> {
    if (!this.slackConfig.notificationChannelId) return;

    const emoji: Record<string, string> = {
      completed: "✅",
      error: "❌",
      permission: "🔐",
      input_required: "💬",
    };
    const icon = emoji[notification.type] ?? "ℹ️";
    const text = `${icon} *${notification.sessionName ?? "Session"}*\n${notification.summary}`;
    const blocks = this.formatter.formatNotification(text);

    try {
      await this.queue.enqueue("chat.postMessage", {
        channel: this.slackConfig.notificationChannelId,
        text,
        blocks,
      });
    } catch (err) {
      log.warn({ err, sessionId: notification.sessionId }, "Failed to send Slack notification");
    }
  }
}

export type { SlackChannelConfig } from "./types.js";
