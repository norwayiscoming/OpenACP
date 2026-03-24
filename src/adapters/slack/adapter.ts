// src/adapters/slack/adapter.ts
import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import {
  ChannelAdapter,
  type ChannelConfig,
  type OpenACPCore,
  type OutgoingMessage,
  type PermissionRequest,
  type NotificationMessage,
} from "../../core/index.js";
import { createChildLogger } from "../../core/log.js";
const log = createChildLogger({ module: "slack" });

import type { SlackChannelConfig } from "./types.js";
import type { SlackSessionMeta } from "./types.js";
import { SlackSendQueue } from "./send-queue.js";
import { SlackFormatter } from "./formatter.js";
import { SlackChannelManager } from "./channel-manager.js";
import { SlackPermissionHandler } from "./permission-handler.js";
import { SlackEventRouter } from "./event-router.js";
import { SlackTextBuffer } from "./text-buffer.js";
import { toSlug } from "./slug.js";

export class SlackAdapter extends ChannelAdapter<OpenACPCore> {
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

  constructor(core: OpenACPCore, config: SlackChannelConfig) {
    super(core, config as unknown as ChannelConfig);
    this.slackConfig = config;
    this.formatter = new SlackFormatter();
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
      (sessionChannelSlug, text, userId) => {
        this.core
          .handleMessage({
            channelId: "slack",
            threadId: sessionChannelSlug,
            userId,
            text,
          })
          .catch((err) => log.error({ err }, "handleMessage error"));
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

  private async _createStartupSession(): Promise<void> {
    try {
      const session = await this.core.handleNewSession("slack", undefined, undefined, { createThread: true });
      if (!session.threadId) {
        log.error({ sessionId: session.id }, "Startup session created without threadId");
        return;
      }
      log.info({ sessionId: session.id, threadId: session.threadId }, "Slack startup session ready");

      // Notify the notification channel so the user knows which channel to use
      if (this.slackConfig.notificationChannelId) {
        const meta = this.sessions.get(session.id);
        if (meta) {
          await this.queue.enqueue("chat.postMessage", {
            channel: this.slackConfig.notificationChannelId,
            text: `✅ OpenACP ready — chat with the agent in <#${meta.channelId}>`,
          });
        }
      }
    } catch (err) {
      log.error({ err }, "Failed to create Slack startup session");
    }
  }

  async stop(): Promise<void> {
    await this.app.stop();
    log.info("Slack adapter stopped");
  }

  // --- ChannelAdapter implementations ---

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
      await this.channelManager.archiveChannel(meta.channelId);
      log.info({ sessionId, channelId: meta.channelId }, "Session channel archived");
    } catch (err) {
      log.warn({ err, sessionId }, "Failed to archive Slack channel");
    }
    this.sessions.delete(sessionId);
    const buf = this.textBuffers.get(sessionId);
    if (buf) { buf.destroy(); this.textBuffers.delete(sessionId); }
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

    // Text chunks are buffered and flushed as a single message after idle timeout
    if (content.type === "text") {
      const buf = this.getTextBuffer(sessionId, meta.channelId);
      buf.append(content.text ?? "");
      return;
    }

    // For session_end / error: flush any pending text first, then send the event
    if (content.type === "session_end" || content.type === "error") {
      const buf = this.textBuffers.get(sessionId);
      if (buf) {
        await buf.flush();
        buf.destroy();
        this.textBuffers.delete(sessionId);
      }
    }

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

    const session = this.core.sessionManager.getSession(sessionId);
    if (!session) return;

    // Auto-approve openacp CLI commands
    if (request.description.includes("openacp")) {
      const allowOption = request.options.find((o) => o.isAllow);
      if (allowOption && session.permissionGate.requestId === request.id) {
        log.info({ sessionId, requestId: request.id }, "Auto-approving openacp command");
        session.permissionGate.resolve(allowOption.id);
      }
      return;
    }

    // Dangerous mode: auto-approve
    if (session.dangerousMode) {
      const allowOption = request.options.find((o) => o.isAllow);
      if (allowOption && session.permissionGate.requestId === request.id) {
        log.info({ sessionId, requestId: request.id }, "Dangerous mode: auto-approving");
        session.permissionGate.resolve(allowOption.id);
      }
      return;
    }

    log.info({ sessionId, requestId: request.id }, "Sending Slack permission request");
    const blocks = this.formatter.formatPermissionRequest(request);

    try {
      await this.queue.enqueue("chat.postMessage", {
        channel: meta.channelId,
        text: `Permission request: ${request.description}`,
        blocks,
      });
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
