// src/adapters/slack/index.ts
import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import {
  ChannelAdapter,
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

export class SlackAdapter extends ChannelAdapter<OpenACPCore> {
  private app!: App;
  private webClient!: WebClient;
  private queue!: SlackSendQueue;
  private formatter: SlackFormatter;
  private channelManager!: SlackChannelManager;
  private permissionHandler!: SlackPermissionHandler;
  private eventRouter!: SlackEventRouter;
  private sessions = new Map<string, SlackSessionMeta>();
  private botUserId = "";
  private slackConfig: SlackChannelConfig;

  constructor(core: OpenACPCore, config: SlackChannelConfig) {
    super(core, config as never);
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
    this.channelManager = new SlackChannelManager(this.queue, this.slackConfig);

    // Resolve bot user ID
    try {
      const authResult = await this.webClient.auth.test();
      this.botUserId = (authResult.user_id as string) ?? "";
      log.info({ botUserId: this.botUserId }, "Slack bot authenticated");
    } catch (err) {
      log.warn({ err }, "Failed to resolve Slack bot user ID");
    }

    // Permission handler — resolve permission gate when user clicks a button
    this.permissionHandler = new SlackPermissionHandler(
      this.queue,
      (requestId, optionId) => {
        // Find the session whose pending permission request matches requestId
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
        // Find session meta by Slack channel ID
        for (const meta of this.sessions.values()) {
          if (meta.channelId === slackChannelId) return meta;
        }
        return undefined;
      },
      (sessionChannelSlug, text, userId) => {
        // Find session by slug (channelSlug == threadId stored in session)
        const session = this.core.sessionManager.getSessionByThread("slack", sessionChannelSlug);
        if (!session) {
          log.warn({ sessionChannelSlug }, "No session found for incoming Slack message");
          return;
        }
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
    );
    this.eventRouter.register(this.app);

    // Start Bolt (Socket Mode)
    await this.app.start();
    log.info("Slack adapter started (Socket Mode)");
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

    const newSlug = newName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60);

    try {
      await this.queue.enqueue("conversations.rename", {
        channel: meta.channelId,
        name: newSlug,
      });
      meta.channelSlug = newSlug;
      await this.core.sessionManager.patchRecord(sessionId, { name: newName });
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
  }

  async sendMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) {
      log.warn({ sessionId }, "No Slack channel for session, skipping message");
      return;
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
