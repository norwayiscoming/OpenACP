import { Bot } from "grammy";
import {
  ChannelAdapter,
  type OpenACPCore,
  type OutgoingMessage,
  type PermissionRequest,
  type NotificationMessage,
  type Session,
  log,
} from "@openacp/core";
import type { TelegramChannelConfig } from "./types.js";
import { MessageDraft } from "./streaming.js";
import {
  ensureTopics,
  createSessionTopic,
  renameSessionTopic,
} from "./topics.js";
import {
  setupCommands,
  setupMenuCallbacks,
  buildMenuKeyboard,
} from "./commands.js";
import { PermissionHandler } from "./permissions.js";
import {
  spawnAssistant,
  handleAssistantMessage,
  redirectToAssistant,
} from "./assistant.js";
import {
  escapeHtml,
  formatToolCall,
  formatToolUpdate,
  formatPlan,
  formatUsage,
} from "./formatting.js";

export class TelegramAdapter extends ChannelAdapter {
  private bot!: Bot;
  private telegramConfig: TelegramChannelConfig;
  private sessionDrafts: Map<string, MessageDraft> = new Map();
  private toolCallMessages: Map<string, Map<string, number>> = new Map(); // sessionId → (toolCallId → msgId)
  private permissionHandler!: PermissionHandler;
  private assistantSession: Session | null = null;
  private notificationTopicId!: number;
  private assistantTopicId!: number;

  constructor(core: OpenACPCore, config: TelegramChannelConfig) {
    super(core, config as never);
    this.telegramConfig = config;
  }

  async start(): Promise<void> {
    this.bot = new Bot(this.telegramConfig.botToken, {
      client: { fetch },
    });

    // Global error handler — prevent bot from crashing on unhandled errors
    this.bot.catch((err) => log.error("Bot error:", err.message));

    // Middleware: only accept messages from configured chatId
    this.bot.use((ctx, next) => {
      if (ctx.chat?.id !== this.telegramConfig.chatId) return;
      return next();
    });

    // Ensure system topics exist
    const topics = await ensureTopics(
      this.bot,
      this.telegramConfig.chatId,
      this.telegramConfig,
      async (updates) => {
        // Save topic IDs to config
        await (this.core as OpenACPCore).configManager.save({
          channels: { telegram: updates },
        });
      },
    );
    this.notificationTopicId = topics.notificationTopicId;
    this.assistantTopicId = topics.assistantTopicId;

    // Setup permission handler
    this.permissionHandler = new PermissionHandler(
      this.bot,
      this.telegramConfig.chatId,
      (sessionId) =>
        (this.core as OpenACPCore).sessionManager.getSession(sessionId),
      (notification) => this.sendNotification(notification),
    );
    this.permissionHandler.setupCallbackHandler();

    // Setup commands and menu callbacks
    setupCommands(
      this.bot,
      this.core as OpenACPCore,
      this.telegramConfig.chatId,
    );
    setupMenuCallbacks(
      this.bot,
      this.core as OpenACPCore,
      this.telegramConfig.chatId,
    );

    // Setup message routing
    this.setupRoutes();

    // Start bot polling — spawn assistant and send welcome only after bot is ready
    this.bot.start({
      allowed_updates: ["message", "callback_query"],
      onStart: () => {
        log.info("Telegram bot started");
        this.onBotReady().catch((err) => log.error("onBotReady error:", err));
      },
    });
  }

  private async onBotReady(): Promise<void> {
    // Spawn assistant session
    try {
      this.assistantSession = await spawnAssistant(
        this.core as OpenACPCore,
        this,
        this.assistantTopicId,
      );
    } catch (err) {
      log.error("Failed to spawn assistant:", err);
    }

    // Send welcome message with menu to assistant topic
    try {
      const config = (this.core as OpenACPCore).configManager.get();
      const agents = (
        this.core as OpenACPCore
      ).agentManager.getAvailableAgents();
      const agentList = agents
        .map(
          (a) =>
            `${escapeHtml(a.name)}${a.name === config.defaultAgent ? " (mặc định)" : ""}`,
        )
        .join(", ");
      const workspace = escapeHtml(config.workspace.baseDir);

      const welcomeText =
        `Xin chào! Tôi là <b>OpenACP Assistant</b> — trợ lý quản lý phiên coding AI của bạn.\n\n` +
        `Agents có sẵn: ${agentList}\n` +
        `Workspace: <code>${workspace}</code>\n\n` +
        `<b>Chọn một hành động:</b>`;

      await this.bot.api.sendMessage(this.telegramConfig.chatId, welcomeText, {
        message_thread_id: this.assistantTopicId,
        parse_mode: "HTML",
        reply_markup: buildMenuKeyboard(),
      });
    } catch (err) {
      log.warn("Failed to send welcome message:", err);
    }
  }

  async stop(): Promise<void> {
    if (this.assistantSession) {
      await this.assistantSession.destroy();
    }
    await this.bot.stop();
  }

  private setupRoutes(): void {
    this.bot.on("message:text", async (ctx) => {
      const threadId = ctx.message.message_thread_id;

      // General topic or no thread → redirect to assistant
      if (!threadId) {
        const html = redirectToAssistant(
          this.telegramConfig.chatId,
          this.assistantTopicId,
        );
        await ctx.reply(html, { parse_mode: "HTML" });
        return;
      }

      // Notification topic → ignore
      if (threadId === this.notificationTopicId) return;

      // Assistant topic → forward to assistant session
      if (threadId === this.assistantTopicId) {
        await handleAssistantMessage(this.assistantSession, ctx.message.text);
        return;
      }

      // Session topic → forward to core
      await (this.core as OpenACPCore).handleMessage({
        channelId: "telegram",
        threadId: String(threadId),
        userId: String(ctx.from.id),
        text: ctx.message.text,
      });
    });
  }

  // --- ChannelAdapter implementations ---

  async sendMessage(
    sessionId: string,
    content: OutgoingMessage,
  ): Promise<void> {
    const session = (this.core as OpenACPCore).sessionManager.getSession(
      sessionId,
    );
    if (!session) return;
    const threadId = Number(session.threadId);
    if (!threadId) return; // Drop messages before threadId is assigned

    switch (content.type) {
      case "thought": {
        // Skip thought/thinking content — it's internal agent reasoning
        break;
      }

      case "text": {
        let draft = this.sessionDrafts.get(sessionId);
        if (!draft) {
          draft = new MessageDraft(
            this.bot,
            this.telegramConfig.chatId,
            threadId,
          );
          this.sessionDrafts.set(sessionId, draft);
        }
        draft.append(content.text);
        break;
      }

      case "tool_call": {
        await this.finalizeDraft(sessionId);
        const msg = await this.bot.api.sendMessage(
          this.telegramConfig.chatId,
          formatToolCall(content.metadata as never),
          {
            message_thread_id: threadId,
            parse_mode: "HTML",
            disable_notification: true,
          },
        );
        if (!this.toolCallMessages.has(sessionId)) {
          this.toolCallMessages.set(sessionId, new Map());
        }
        this.toolCallMessages
          .get(sessionId)!
          .set(content.metadata?.id as string, msg.message_id);
        break;
      }

      case "tool_update": {
        const msgId = this.toolCallMessages
          .get(sessionId)
          ?.get(content.metadata?.id as string);
        if (msgId) {
          try {
            await this.bot.api.editMessageText(
              this.telegramConfig.chatId,
              msgId,
              formatToolUpdate(content.metadata as never),
              { parse_mode: "HTML" },
            );
          } catch {
            /* edit failed */
          }
        }
        break;
      }

      case "plan": {
        await this.finalizeDraft(sessionId);
        await this.bot.api.sendMessage(
          this.telegramConfig.chatId,
          formatPlan(content.metadata as never),
          {
            message_thread_id: threadId,
            parse_mode: "HTML",
            disable_notification: true,
          },
        );
        break;
      }

      case "usage": {
        await this.bot.api.sendMessage(
          this.telegramConfig.chatId,
          formatUsage(content.metadata as never),
          {
            message_thread_id: threadId,
            parse_mode: "HTML",
            disable_notification: true,
          },
        );
        break;
      }

      case "session_end": {
        await this.finalizeDraft(sessionId);
        this.sessionDrafts.delete(sessionId);
        this.toolCallMessages.delete(sessionId);
        await this.bot.api.sendMessage(
          this.telegramConfig.chatId,
          `✅ <b>Done</b>`,
          {
            message_thread_id: threadId,
            parse_mode: "HTML",
            disable_notification: true,
          },
        );
        break;
      }

      case "error": {
        await this.finalizeDraft(sessionId);
        await this.bot.api.sendMessage(
          this.telegramConfig.chatId,
          `❌ <b>Error:</b> ${escapeHtml(content.text)}`,
          {
            message_thread_id: threadId,
            parse_mode: "HTML",
            disable_notification: true,
          },
        );
        break;
      }
    }
  }

  async sendPermissionRequest(
    sessionId: string,
    request: PermissionRequest,
  ): Promise<void> {
    const session = (this.core as OpenACPCore).sessionManager.getSession(
      sessionId,
    );
    if (!session) return;
    await this.permissionHandler.sendPermissionRequest(session, request);
  }

  async sendNotification(notification: NotificationMessage): Promise<void> {
    if (!this.notificationTopicId) return;
    const emoji: Record<string, string> = {
      completed: "✅",
      error: "❌",
      permission: "🔐",
      input_required: "💬",
    };
    let text = `${emoji[notification.type] || "ℹ️"} <b>${escapeHtml(notification.sessionName || notification.sessionId)}</b>\n`;
    text += escapeHtml(notification.summary);
    if (notification.deepLink) {
      text += `\n\n<a href="${notification.deepLink}">→ Go to message</a>`;
    }
    await this.bot.api.sendMessage(this.telegramConfig.chatId, text, {
      message_thread_id: this.notificationTopicId,
      parse_mode: "HTML",
      disable_notification: false,
    });
  }

  async createSessionThread(_sessionId: string, name: string): Promise<string> {
    return String(
      await createSessionTopic(this.bot, this.telegramConfig.chatId, name),
    );
  }

  async renameSessionThread(sessionId: string, newName: string): Promise<void> {
    const session = (this.core as OpenACPCore).sessionManager.getSession(
      sessionId,
    );
    if (!session) return;
    await renameSessionTopic(
      this.bot,
      this.telegramConfig.chatId,
      Number(session.threadId),
      newName,
    );
  }

  private async finalizeDraft(sessionId: string): Promise<void> {
    const draft = this.sessionDrafts.get(sessionId);
    if (draft) {
      await draft.finalize();
      this.sessionDrafts.delete(sessionId);
    }
  }
}
