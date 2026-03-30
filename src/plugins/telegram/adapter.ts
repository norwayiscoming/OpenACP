import { Bot, InputFile } from "grammy";
import path from "node:path";
import type {
  OpenACPCore,
  OutgoingMessage,
  PermissionRequest,
  NotificationMessage,
  Session,
  AgentCommand,
  FileServiceInterface,
} from "../../core/index.js";
import { createChildLogger } from "../../core/utils/log.js";
import type { DebugTracer } from "../../core/utils/debug-tracer.js";
const log = createChildLogger({ module: "telegram" });
import type { TelegramChannelConfig } from "./types.js";
import type { CommandRegistry } from "../../core/command-registry.js";
import type { CommandResponse } from "../../core/plugin/types.js";
import {
  ensureTopics,
  createSessionTopic,
  renameSessionTopic,
  deleteSessionTopic,
} from "./topics.js";
import {
  setupCommands,
  setupMenuCallbacks,
  setupDangerousModeCallbacks,
  setupTTSCallbacks,
  setupVerbosityCallbacks,
  setupIntegrateCallbacks,
  buildMenuKeyboard,
  handlePendingWorkspaceInput,
  handlePendingResumeInput,
  STATIC_COMMANDS,
} from "./commands/index.js";
import { PermissionHandler } from "./permissions.js";
import {
  spawnAssistant,
  handleAssistantMessage,
  redirectToAssistant,
  buildWelcomeMessage,
  type SpawnAssistantResult,
} from "./assistant.js";
import { escapeHtml, formatUsage } from "./formatting.js";
import { ActivityTracker } from "./activity.js";
import { SendQueue } from "../../core/adapter-primitives/primitives/send-queue.js";
import { setupActionCallbacks } from "./action-detect.js";
import { DraftManager } from "./draft-manager.js";
import { SkillCommandManager } from "./skill-command-manager.js";
import {
  MessagingAdapter,
  type MessagingAdapterConfig,
} from "../../core/adapter-primitives/messaging-adapter.js";
import type { IRenderer } from "../../core/adapter-primitives/rendering/renderer.js";
import { TelegramRenderer } from "./renderer.js";
import type { AdapterCapabilities } from "../../core/channel.js";
import type {
  DisplayVerbosity,
  ToolCallMeta,
  ToolUpdateMeta,
  OutputMode,
} from "../../core/adapter-primitives/format-types.js";
import { OutputModeResolver } from "../../core/adapter-primitives/output-mode-resolver.js";
import type { TunnelServiceInterface } from "../../core/plugin/types.js";
// evaluateNoise is handled by MessagingAdapter.shouldDisplay()

interface PlanMetadata {
  entries: Array<{ content: string; status: string; priority: string }>;
}

interface UsageMetadata {
  tokensUsed?: number;
  contextSize?: number;
}

/**
 * Wraps native fetch to work around grammY's polyfilled AbortController.
 * grammY uses abort-controller polyfill whose AbortSignal fails instanceof
 * checks in Node 24+ native fetch. This wrapper re-creates a native
 * AbortSignal from the polyfilled one before passing it to fetch.
 */
function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (init?.signal && !(init.signal instanceof AbortSignal)) {
    const nativeController = new AbortController();
    const polyfillSignal = init.signal as unknown as {
      aborted: boolean;
      addEventListener: (event: string, fn: () => void) => void;
    };
    if (polyfillSignal.aborted) {
      nativeController.abort();
    } else {
      polyfillSignal.addEventListener("abort", () => nativeController.abort());
    }
    init = { ...init, signal: nativeController.signal };
  }
  return fetch(input, init);
}

export class TelegramAdapter extends MessagingAdapter {
  readonly name = "telegram";
  readonly renderer: IRenderer = new TelegramRenderer();
  readonly capabilities: AdapterCapabilities = {
    streaming: true,
    richFormatting: true,
    threads: true,
    reactions: true,
    fileUpload: true,
    voice: true,
  };

  private core: OpenACPCore;
  private bot!: Bot;
  private telegramConfig: TelegramChannelConfig;
  private permissionHandler!: PermissionHandler;
  private assistantSession: Session | null = null;
  private assistantInitializing = false;
  private notificationTopicId!: number;
  private assistantTopicId!: number;
  private sendQueue = new SendQueue({ minInterval: 3000 });
  private _sessionThreadIds = new Map<string, number>();
  private outputModeResolver = new OutputModeResolver();

  // Extracted managers
  private draftManager!: DraftManager;
  private skillManager!: SkillCommandManager;
  private fileService!: FileServiceInterface;
  private sessionTrackers: Map<string, ActivityTracker> = new Map();
  private callbackCache = new Map<string, string>();
  private callbackCounter = 0;

  private getThreadId(sessionId: string): number {
    const threadId = this._sessionThreadIds.get(sessionId);
    if (threadId === undefined) {
      throw new Error(`No threadId stored for session ${sessionId}`);
    }
    return threadId;
  }

  private getOrCreateTracker(
    sessionId: string,
    threadId: number,
    outputMode: OutputMode = "medium",
  ): ActivityTracker {
    let tracker = this.sessionTrackers.get(sessionId);
    if (!tracker) {
      const tunnelService = this.core.lifecycleManager?.serviceRegistry?.get("tunnel") as TunnelServiceInterface | undefined;
      const session = this.core.sessionManager.getSession(sessionId);
      const sessionContext = session ? {
        id: sessionId,
        workingDirectory: session.workingDirectory,
      } : undefined;
      tracker = new ActivityTracker(
        this.bot.api,
        this.telegramConfig.chatId,
        threadId,
        this.sendQueue,
        outputMode,
        sessionId,
        this.getTracer(sessionId),
        tunnelService,
        sessionContext,
      );
      this.sessionTrackers.set(sessionId, tracker);
    }
    return tracker;
  }

  constructor(core: OpenACPCore, config: TelegramChannelConfig) {
    super({ configManager: core.configManager }, {
      ...(config as Record<string, unknown>),
      maxMessageLength: 4096,
      enabled: config.enabled ?? true,
    } as MessagingAdapterConfig);
    this.core = core;
    this.telegramConfig = config;
  }

  async start(): Promise<void> {
    this.bot = new Bot(this.telegramConfig.botToken, {
      client: {
        baseFetchConfig: { duplex: "half" } as RequestInit,
        fetch: patchedFetch,
      },
    });
    this.fileService = this.core.fileService;

    // Initialize extracted managers
    this.draftManager = new DraftManager(
      this.bot,
      this.telegramConfig.chatId,
      this.sendQueue,
    );
    this.skillManager = new SkillCommandManager(
      this.bot,
      this.telegramConfig.chatId,
      this.sendQueue,
      this.core.sessionManager,
    );

    // Global error handler — prevent unhandled errors from crashing the bot
    this.bot.catch((err) => {
      const rootCause = err.error instanceof Error ? err.error : err;
      log.error({ err: rootCause }, "Telegram bot error");
    });

    // Auto-retry on 429 (Too Many Requests)
    this.bot.api.config.use(async (prev, method, payload, signal) => {
      const maxRetries = 3;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await prev(method, payload, signal);
        if (
          result.ok ||
          (result as { error_code?: number }).error_code !== 429 ||
          attempt === maxRetries
        ) {
          return result;
        }
        const retryAfter =
          ((result as { parameters?: { retry_after?: number } }).parameters
            ?.retry_after ?? 5) + 1;
        const rateLimitedMethods = [
          "sendMessage",
          "editMessageText",
          "editMessageReplyMarkup",
        ];
        if (rateLimitedMethods.includes(method)) {
          this.sendQueue.onRateLimited();
        }
        log.warn(
          { method, retryAfter, attempt: attempt + 1 },
          "Rate limited by Telegram, retrying",
        );
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
      }
      return prev(method, payload, signal);
    });

    // Ensure allowed_updates includes callback_query on every poll
    this.bot.api.config.use((prev, method, payload, signal) => {
      if (method === "getUpdates") {
        const p = payload as Record<string, unknown>;
        p.allowed_updates = (p.allowed_updates as string[] | undefined) ?? [
          "message",
          "callback_query",
        ];
      }
      return prev(method, payload, signal);
    });

    // Register static commands for Telegram autocomplete
    await this.bot.api.setMyCommands(STATIC_COMMANDS, {
      scope: { type: "chat", chat_id: this.telegramConfig.chatId },
    });

    // Middleware: only accept updates from configured chatId
    this.bot.use((ctx, next) => {
      const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
      if (chatId !== this.telegramConfig.chatId) return;
      return next();
    });

    // Ensure system topics exist
    const topics = await ensureTopics(
      this.bot,
      this.telegramConfig.chatId,
      this.telegramConfig,
      async (updates) => {
        await this.core.configManager.save({
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
      (sessionId) => this.core.sessionManager.getSession(sessionId),
      (notification) => this.sendNotification(notification),
    );

    // Generic CommandRegistry dispatch — handles any command registered via plugin system.
    // Must be early so registry commands run before legacy bot.command() handlers.
    this.bot.on("message:text", async (ctx, next) => {
      const text = ctx.message?.text;
      if (!text?.startsWith("/")) return next();

      const registry =
        this.core.lifecycleManager?.serviceRegistry?.get<CommandRegistry>(
          "command-registry",
        );
      if (!registry) return next();

      // Extract command name (remove / and @botname suffix)
      const rawCommand = text.split(" ")[0].slice(1);
      const atIdx = rawCommand.indexOf("@");
      // If command is directed at another bot, ignore it
      if (
        atIdx !== -1 &&
        rawCommand.slice(atIdx + 1).toLowerCase() !==
          ctx.me.username.toLowerCase()
      ) {
        return next();
      }
      const commandName =
        atIdx === -1 ? rawCommand : rawCommand.slice(0, atIdx);
      const def = registry.get(commandName);
      if (!def) return next(); // not in registry, fall through to existing handlers

      const chatId = ctx.chat.id;
      const topicId = ctx.message.message_thread_id;

      try {
        const sessionId =
          topicId != null
            ? (this.core.sessionManager.getSessionByThread(
                "telegram",
                String(topicId),
              )?.id ?? null)
            : null;

        const response = await registry.execute(text, {
          raw: "",
          sessionId,
          channelId: "telegram",
          userId: String(ctx.from?.id),
          reply: async (content) => {
            if (typeof content === "string") {
              await ctx.reply(content);
            } else if (
              typeof content === "object" &&
              content !== null &&
              "type" in content
            ) {
              await this.renderCommandResponse(
                content as CommandResponse,
                chatId,
                topicId,
              );
            }
          },
        });

        if (response.type === "silent") {
          // Silent means the registry has no UI for this command — pass through
          // to adapter-specific handlers (e.g. handleNewChat, handleCancel).
          return next();
        }
        await this.renderCommandResponse(response, chatId, topicId);
      } catch (err) {
        await ctx.reply(`\u26a0\ufe0f Command failed: ${String(err)}`);
      }
    });

    // Callback query handler for command buttons (c/ prefix)
    this.bot.callbackQuery(/^c\//, async (ctx) => {
      const data = ctx.callbackQuery.data;
      const command = this.fromCallbackData(data);

      const registry =
        this.core.lifecycleManager?.serviceRegistry?.get<CommandRegistry>(
          "command-registry",
        );
      if (!registry) return;

      const chatId = ctx.chat!.id;
      const topicId = ctx.callbackQuery.message?.message_thread_id;

      try {
        const sessionId =
          topicId != null
            ? (this.core.sessionManager.getSessionByThread(
                "telegram",
                String(topicId),
              )?.id ?? null)
            : null;

        const response = await registry.execute(command, {
          raw: "",
          sessionId,
          channelId: "telegram",
          userId: String(ctx.from?.id),
          reply: async (content) => {
            if (typeof content === "string") {
              await ctx.editMessageText(content).catch(() => {});
            }
          },
        });

        await ctx.answerCallbackQuery();
        if (response.type !== "silent") {
          await this.renderCommandResponse(response, chatId, topicId);
        }
      } catch {
        await ctx.answerCallbackQuery({ text: "Command failed" });
      }
    });

    // Callback registration order matters!
    setupDangerousModeCallbacks(this.bot, this.core as OpenACPCore);
    setupTTSCallbacks(this.bot, this.core as OpenACPCore);
    setupVerbosityCallbacks(this.bot, this.core as OpenACPCore);
    setupActionCallbacks(
      this.bot,
      this.core as OpenACPCore,
      this.telegramConfig.chatId,
      () => this.assistantSession?.id,
    );
    setupIntegrateCallbacks(this.bot, this.core as OpenACPCore);
    setupMenuCallbacks(
      this.bot,
      this.core as OpenACPCore,
      this.telegramConfig.chatId,
      {
        notificationTopicId: this.notificationTopicId,
        assistantTopicId: this.assistantTopicId,
      },
      () => {
        if (!this.assistantSession) return undefined;
        return {
          topicId: this.assistantTopicId,
          enqueuePrompt: (p: string) => this.assistantSession!.enqueuePrompt(p),
        };
      },
    );
    setupCommands(
      this.bot,
      this.core as OpenACPCore,
      this.telegramConfig.chatId,
      {
        topicId: this.assistantTopicId,
        getSession: () => this.assistantSession,
        respawn: async () => {
          if (this.assistantSession) {
            await this.assistantSession.destroy();
            this.assistantSession = null;
          }
          const { session, ready } = await spawnAssistant(
            this.core as OpenACPCore,
            this,
            this.assistantTopicId,
          );
          this.assistantSession = session;
          this.assistantInitializing = true;
          ready.then(() => {
            this.assistantInitializing = false;
          });
        },
      },
    );
    this.permissionHandler.setupCallbackHandler();

    // /handoff command
    this.bot.command("handoff", async (ctx) => {
      const threadId = ctx.message?.message_thread_id;
      if (!threadId) return;

      if (
        threadId === this.notificationTopicId ||
        threadId === this.assistantTopicId
      ) {
        await ctx.reply("This command only works in session topics.", {
          message_thread_id: threadId,
        });
        return;
      }

      const session = this.core.sessionManager.getSessionByThread(
        "telegram",
        String(threadId),
      );
      const record = session
        ? undefined
        : this.core.sessionManager.getRecordByThread(
            "telegram",
            String(threadId),
          );

      const agentName = session?.agentName ?? record?.agentName;
      const agentSessionId = session?.agentSessionId ?? record?.agentSessionId;

      if (!agentName || !agentSessionId) {
        await ctx.reply("No session found for this topic.", {
          message_thread_id: threadId,
        });
        return;
      }

      const { getAgentCapabilities } =
        await import("../../core/agents/agent-registry.js");
      const caps = getAgentCapabilities(agentName);

      if (!caps.supportsResume || !caps.resumeCommand) {
        await ctx.reply("This agent does not support session transfer.", {
          message_thread_id: threadId,
        });
        return;
      }

      const command = caps.resumeCommand(agentSessionId);

      await ctx.reply(
        `Run this in your terminal to continue the session:\n\n<code>${command}</code>`,
        {
          message_thread_id: threadId,
          parse_mode: "HTML",
        },
      );
    });

    // Setup message routing
    this.setupRoutes();

    // Start bot polling
    this.bot.start({
      allowed_updates: ["message", "callback_query"],
      onStart: () =>
        log.info(
          { chatId: this.telegramConfig.chatId },
          "Telegram bot started",
        ),
    });

    // Send welcome message
    try {
      const config = this.core.configManager.get();
      const agents = this.core.agentManager.getAvailableAgents();
      const allRecords = this.core.sessionManager.listRecords();

      const welcomeText = buildWelcomeMessage({
        activeCount: allRecords.filter(
          (r) => r.status === "active" || r.status === "initializing",
        ).length,
        errorCount: allRecords.filter((r) => r.status === "error").length,
        totalCount: allRecords.length,
        agents: agents.map((a) => a.name),
        defaultAgent: config.defaultAgent,
      });

      await this.bot.api.sendMessage(this.telegramConfig.chatId, welcomeText, {
        message_thread_id: this.assistantTopicId,
        parse_mode: "HTML",
        reply_markup: buildMenuKeyboard(),
      });
    } catch (err) {
      log.warn({ err }, "Failed to send welcome message");
    }

    // Spawn assistant in background
    try {
      log.info("Spawning assistant session...");
      const { session, ready } = await spawnAssistant(
        this.core as OpenACPCore,
        this,
        this.assistantTopicId,
      );
      this.assistantSession = session;
      this.assistantInitializing = true;
      log.info(
        { sessionId: session.id },
        "Assistant session ready, system prompt running in background",
      );
      ready.then(() => {
        this.assistantInitializing = false;
        log.info(
          { sessionId: session.id },
          "Assistant ready for user messages",
        );
      });
    } catch (err) {
      log.error({ err }, "Failed to spawn assistant");
      this.bot.api
        .sendMessage(
          this.telegramConfig.chatId,
          `⚠️ <b>Failed to start assistant session.</b>\n\n<code>${err instanceof Error ? err.message : String(err)}</code>`,
          { message_thread_id: this.assistantTopicId, parse_mode: "HTML" },
        )
        .catch(() => {});
    }
  }

  async stop(): Promise<void> {
    // Cleanup activity trackers (interval timers)
    for (const tracker of this.sessionTrackers.values()) {
      tracker.destroy();
    }
    this.sessionTrackers.clear();

    // Clear send queue
    this.sendQueue.clear();

    // Destroy assistant session
    if (this.assistantSession) {
      await this.assistantSession.destroy();
    }

    await this.bot.stop();
    log.info("Telegram bot stopped");
  }

  // --- CommandRegistry response rendering ---

  private async renderCommandResponse(
    response: CommandResponse,
    chatId: number,
    topicId?: number,
  ): Promise<void> {
    switch (response.type) {
      case "text":
        await this.bot.api.sendMessage(chatId, response.text, {
          message_thread_id: topicId,
        });
        break;
      case "error":
        await this.bot.api.sendMessage(
          chatId,
          `\u26a0\ufe0f ${response.message}`,
          { message_thread_id: topicId },
        );
        break;
      case "menu": {
        const keyboard = response.options.map((opt) => [
          {
            text: `${opt.label}${opt.hint ? ` \u2014 ${opt.hint}` : ""}`,
            callback_data: this.toCallbackData(opt.command),
          },
        ]);
        await this.bot.api.sendMessage(chatId, response.title, {
          message_thread_id: topicId,
          reply_markup: { inline_keyboard: keyboard },
        });
        break;
      }
      case "list": {
        const lines = response.items.map(
          (i) => `\u2022 ${i.label}${i.detail ? ` \u2014 ${i.detail}` : ""}`,
        );
        const text = `${response.title}\n${lines.join("\n")}`;
        await this.bot.api.sendMessage(chatId, text, {
          message_thread_id: topicId,
        });
        break;
      }
      case "confirm": {
        const buttons = [
          [
            {
              text: "\u2705 Yes",
              callback_data: this.toCallbackData(response.onYes),
            },
          ],
        ];
        if (response.onNo) {
          buttons[0].push({
            text: "\u274c No",
            callback_data: this.toCallbackData(response.onNo),
          });
        }
        await this.bot.api.sendMessage(chatId, response.question, {
          message_thread_id: topicId,
          reply_markup: { inline_keyboard: buttons },
        });
        break;
      }
      case "silent":
        break;
    }
  }

  private toCallbackData(command: string): string {
    const data = `c/${command}`;
    if (data.length <= 64) return data;
    const id = String(++this.callbackCounter);
    this.callbackCache.set(id, command);
    if (this.callbackCache.size > 1000) {
      const first = this.callbackCache.keys().next().value;
      if (first) this.callbackCache.delete(first);
    }
    return `c/#${id}`;
  }

  private fromCallbackData(data: string): string {
    if (data.startsWith("c/#")) {
      return this.callbackCache.get(data.slice(3)) ?? data.slice(2);
    }
    return data.slice(2);
  }

  private setupRoutes(): void {
    this.bot.on("message:text", async (ctx) => {
      const threadId = ctx.message.message_thread_id;
      const text = ctx.message.text;

      // Check for pending workspace input from interactive /new flow
      if (
        await handlePendingWorkspaceInput(
          ctx,
          this.core,
          this.telegramConfig.chatId,
          this.assistantTopicId,
        )
      ) {
        return;
      }

      // Check for pending workspace input from interactive /resume flow
      if (
        await handlePendingResumeInput(
          ctx,
          this.core,
          this.telegramConfig.chatId,
          this.assistantTopicId,
        )
      ) {
        return;
      }

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

      // Strip leading "/" from unrecognized commands — registered commands
      // (e.g. /new, /cancel) are already handled by bot.command() above.
      // Unrecognized slash commands can cause agent subprocesses to hang.
      const forwardText = text.startsWith("/") ? text.slice(1) : text;

      // Assistant topic → forward to assistant session
      if (threadId === this.assistantTopicId) {
        if (!this.assistantSession) {
          await ctx.reply(
            "⚠️ Assistant is not available yet. Please try again shortly.",
            { parse_mode: "HTML" },
          );
          return;
        }
        await this.draftManager.finalize(
          this.assistantSession.id,
          this.assistantSession.id,
        );
        ctx.replyWithChatAction("typing").catch(() => {});
        handleAssistantMessage(this.assistantSession, forwardText).catch(
          (err) => log.error({ err }, "Assistant error"),
        );
        return;
      }

      // Session topic → forward to core
      const sessionId = this.core.sessionManager.getSessionByThread(
        "telegram",
        String(threadId),
      )?.id;
      if (sessionId) {
        this.getTracer(sessionId)?.log("telegram", { action: "incoming:message", sessionId, userId: String(ctx.from?.id), text: ctx.message?.text });
        await this.draftManager.finalize(sessionId, this.assistantSession?.id);
      }
      if (sessionId) {
        const tracker = this.sessionTrackers.get(sessionId);
        if (tracker) await tracker.onNewPrompt();
      }
      ctx.replyWithChatAction("typing").catch(() => {});
      this.core
        .handleMessage({
          channelId: "telegram",
          threadId: String(threadId),
          userId: String(ctx.from.id),
          text: forwardText,
        })
        .catch((err) => log.error({ err }, "handleMessage error"));
    });

    // --- Incoming media handlers ---

    this.bot.on("message:photo", async (ctx) => {
      const threadId = ctx.message.message_thread_id;
      if (!threadId || threadId === this.notificationTopicId) return;

      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const ext = ".jpg";
      await this.handleIncomingMedia(
        threadId,
        ctx.from.id,
        largest.file_id,
        `photo${ext}`,
        "image/jpeg",
        ctx.message.caption || undefined,
      );
    });

    this.bot.on("message:document", async (ctx) => {
      const threadId = ctx.message.message_thread_id;
      if (!threadId || threadId === this.notificationTopicId) return;

      const doc = ctx.message.document;
      await this.handleIncomingMedia(
        threadId,
        ctx.from.id,
        doc.file_id,
        doc.file_name || "document",
        doc.mime_type || "application/octet-stream",
        ctx.message.caption || undefined,
      );
    });

    this.bot.on("message:voice", async (ctx) => {
      const threadId = ctx.message.message_thread_id;
      if (!threadId || threadId === this.notificationTopicId) return;

      const voice = ctx.message.voice;
      await this.handleIncomingMedia(
        threadId,
        ctx.from.id,
        voice.file_id,
        "voice.wav",
        "audio/wav",
        undefined,
        true,
      );
    });

    this.bot.on("message:audio", async (ctx) => {
      const threadId = ctx.message.message_thread_id;
      if (!threadId || threadId === this.notificationTopicId) return;

      const audio = ctx.message.audio;
      await this.handleIncomingMedia(
        threadId,
        ctx.from.id,
        audio.file_id,
        audio.file_name || "audio.mp3",
        audio.mime_type || "audio/mpeg",
        ctx.message.caption || undefined,
      );
    });

    this.bot.on("message:video_note", async (ctx) => {
      const threadId = ctx.message.message_thread_id;
      if (!threadId || threadId === this.notificationTopicId) return;

      const videoNote = ctx.message.video_note;
      await this.handleIncomingMedia(
        threadId,
        ctx.from.id,
        videoNote.file_id,
        "video_note.mp4",
        "video/mp4",
      );
    });
  }

  // --- MessagingAdapter overrides ---

  /**
   * Per-session serial dispatch queues.
   * SessionBridge fires sendMessage() as fire-and-forget, so multiple events
   * (tool_call, tool_update, text) can arrive concurrently. Without serialization,
   * fast handlers (tool_update) overtake slow ones (tool_call with draftManager.finalize),
   * causing out-of-order processing where a tool's completion update is processed before
   * its creation event. This queue ensures events are processed in the order they arrive.
   */
  private _dispatchQueues = new Map<string, Promise<void>>();

  private getTracer(sessionId: string): DebugTracer | null {
    return this.core.sessionManager.getSession(sessionId)?.agentInstance?.debugTracer ?? null;
  }

  async sendMessage(
    sessionId: string,
    content: OutgoingMessage,
  ): Promise<void> {
    // Suppress assistant messages during system prompt
    if (this.assistantInitializing && sessionId === this.assistantSession?.id)
      return;

    const session = this.core.sessionManager.getSession(sessionId);
    if (!session) return;

    // Drop messages while topic is being recreated (archive in progress)
    if (session.archiving) return;
    const threadId = Number(session.threadId);
    if (!threadId || isNaN(threadId)) {
      log.warn(
        { sessionId, threadId: session.threadId },
        "Session has no valid threadId, skipping message",
      );
      return;
    }

    // Serialize dispatch per session to preserve event ordering
    const prev = this._dispatchQueues.get(sessionId) ?? Promise.resolve();
    const next = prev.then(async () => {
      this.getTracer(sessionId)?.log("telegram", { action: "dispatch:enter", sessionId, message: content });
      this._sessionThreadIds.set(sessionId, threadId);
      try {
        await super.sendMessage(sessionId, content);
      } finally {
        this._sessionThreadIds.delete(sessionId);
      }
    }).catch((err) => {
      log.warn({ err, sessionId }, "Dispatch queue error");
    });
    this._dispatchQueues.set(sessionId, next);
    await next;
  }

  protected async handleThought(
    sessionId: string,
    content: OutgoingMessage,
    _verbosity: DisplayVerbosity,
  ): Promise<void> {
    this.getTracer(sessionId)?.log("telegram", { action: "handle:thought", sessionId, text: content.text });
    const threadId = this.getThreadId(sessionId);
    const mode = this.outputModeResolver.resolve(
      this.context.configManager,
      this.name,
      sessionId,
      this.core.sessionManager as any,
    );
    const tracker = this.getOrCreateTracker(sessionId, threadId, mode);
    await tracker.onThought(content.text);
  }

  protected async handleText(
    sessionId: string,
    content: OutgoingMessage,
  ): Promise<void> {
    this.getTracer(sessionId)?.log("telegram", { action: "handle:text", sessionId, text: content.text });
    const threadId = this.getThreadId(sessionId);
    // Per-session dispatch queue serializes all events, so we can safely await here.
    if (!this.draftManager.hasDraft(sessionId)) {
      const mode = this.outputModeResolver.resolve(
        this.context.configManager,
        this.name,
        sessionId,
        this.core.sessionManager as any,
      );
      const tracker = this.getOrCreateTracker(sessionId, threadId, mode);
      await tracker.onTextStart();
    }
    const draft = this.draftManager.getOrCreate(sessionId, threadId, this.getTracer(sessionId));
    draft.append(content.text);
    this.draftManager.appendText(sessionId, content.text);
  }

  protected async handleToolCall(
    sessionId: string,
    content: OutgoingMessage,
    _verbosity: DisplayVerbosity,
  ): Promise<void> {
    const threadId = this.getThreadId(sessionId);
    const meta = (content.metadata ?? {}) as Partial<ToolCallMeta>;
    this.getTracer(sessionId)?.log("telegram", { action: "handle:toolCall", sessionId, toolId: meta.id, toolName: meta.name, kind: meta.kind, status: meta.status, displaySummary: meta.displaySummary, rawInput: meta.rawInput });

    const mode = this.outputModeResolver.resolve(
      this.context.configManager,
      this.name,
      sessionId,
      this.core.sessionManager as any,
    );
    const tracker = this.getOrCreateTracker(sessionId, threadId, mode);
    await this.draftManager.finalize(sessionId, this.assistantSession?.id);
    await tracker.onToolCall(
      {
        id: meta.id ?? "",
        name: meta.name ?? content.text ?? "Tool",
        kind: meta.kind,
        status: meta.status,
        content: meta.content,
        rawInput: meta.rawInput,
        viewerLinks: meta.viewerLinks,
        viewerFilePath: meta.viewerFilePath,
        displaySummary: meta.displaySummary as string | undefined,
        displayTitle: meta.displayTitle as string | undefined,
        displayKind: meta.displayKind as string | undefined,
      },
      String(meta.kind ?? ""),
      meta.rawInput,
    );
  }

  protected async handleToolUpdate(
    sessionId: string,
    content: OutgoingMessage,
    _verbosity: DisplayVerbosity,
  ): Promise<void> {
    const threadId = this.getThreadId(sessionId);
    const meta = (content.metadata ?? {}) as Partial<ToolUpdateMeta>;
    this.getTracer(sessionId)?.log("telegram", { action: "handle:toolUpdate", sessionId, toolId: meta.id, name: meta.name, kind: meta.kind, status: meta.status, viewerLinks: meta.viewerLinks, viewerFilePath: meta.viewerFilePath });
    const mode = this.outputModeResolver.resolve(
      this.context.configManager,
      this.name,
      sessionId,
      this.core.sessionManager as any,
    );
    const tracker = this.getOrCreateTracker(sessionId, threadId, mode);
    await tracker.onToolUpdate(
      meta.id ?? "",
      meta.status ?? "completed",
      meta.viewerLinks as { file?: string; diff?: string } | undefined,
      meta.viewerFilePath as string | undefined,
      typeof meta.content === "string" ? meta.content : null,
      meta.rawInput ?? undefined,
      (meta as any).diffStats as { added: number; removed: number } | undefined,
    );
  }

  protected async handlePlan(
    sessionId: string,
    content: OutgoingMessage,
    _verbosity: DisplayVerbosity,
  ): Promise<void> {
    const threadId = this.getThreadId(sessionId);
    const meta = (content.metadata ?? {}) as Partial<PlanMetadata>;
    const entries = meta.entries ?? [];
    this.getTracer(sessionId)?.log("telegram", { action: "handle:plan", sessionId, entryCount: entries.length });
    const mode = this.outputModeResolver.resolve(
      this.context.configManager,
      this.name,
      sessionId,
      this.core.sessionManager as any,
    );
    const tracker = this.getOrCreateTracker(sessionId, threadId, mode);
    await tracker.onPlan(
      entries.map((e) => ({
        content: e.content,
        status: e.status as "pending" | "in_progress" | "completed",
        priority: (e.priority ?? "medium") as "high" | "medium" | "low",
      })),
    );
  }

  protected async handleUsage(
    sessionId: string,
    content: OutgoingMessage,
    verbosity: DisplayVerbosity,
  ): Promise<void> {
    const threadId = this.getThreadId(sessionId);
    const meta = content.metadata as UsageMetadata | undefined;
    this.getTracer(sessionId)?.log("telegram", { action: "handle:usage", sessionId, tokensUsed: meta?.tokensUsed, contextSize: meta?.contextSize, cost: (meta as Record<string, unknown>)?.cost });
    await this.draftManager.finalize(sessionId, this.assistantSession?.id);

    // Send usage as a separate message (not part of the tool card)
    const usageText = formatUsage(meta ?? {}, verbosity);
    let usageMsgId: number | undefined;
    try {
      const result = await this.sendQueue.enqueue(() =>
        this.bot.api.sendMessage(this.telegramConfig.chatId, usageText, {
          message_thread_id: threadId,
          parse_mode: "HTML",
          disable_notification: true,
        }),
      );
      usageMsgId = result?.message_id;
    } catch (err) {
      log.warn({ err, sessionId }, "Failed to send usage message");
    }

    // Notify the Notifications topic that a prompt has completed
    if (this.notificationTopicId && sessionId !== this.assistantSession?.id) {
      const sess = this.core.sessionManager.getSession(sessionId);
      const sessionName = sess?.name || "Session";
      const chatIdStr = String(this.telegramConfig.chatId);
      const numericId = chatIdStr.startsWith("-100")
        ? chatIdStr.slice(4)
        : chatIdStr.replace("-", "");
      const deepLink = usageMsgId
        ? `https://t.me/c/${numericId}/${threadId}/${usageMsgId}`
        : `https://t.me/c/${numericId}/${threadId}`;
      const text = `✅ <b>${escapeHtml(sessionName)}</b>\nTask completed.\n\n<a href="${deepLink}">→ Go to topic</a>`;
      this.sendQueue
        .enqueue(() =>
          this.bot.api.sendMessage(this.telegramConfig.chatId, text, {
            message_thread_id: this.notificationTopicId,
            parse_mode: "HTML",
            disable_notification: false,
          }),
        )
        .catch(() => {});
    }
  }

  protected async handleAttachment(
    sessionId: string,
    content: OutgoingMessage,
  ): Promise<void> {
    this.getTracer(sessionId)?.log("telegram", { action: "handle:attachment", sessionId, type: content.attachment?.type, fileName: content.attachment?.fileName });
    const threadId = this.getThreadId(sessionId);
    if (!content.attachment) return;
    const { attachment } = content;

    // Telegram bot API upload limit: 50MB
    if (attachment.size > 50 * 1024 * 1024) {
      log.warn(
        {
          sessionId,
          fileName: attachment.fileName,
          size: attachment.size,
        },
        "File too large for Telegram (>50MB)",
      );
      await this.sendQueue.enqueue(() =>
        this.bot.api.sendMessage(
          this.telegramConfig.chatId,
          `⚠️ File too large to send (${Math.round(attachment.size / 1024 / 1024)}MB): ${escapeHtml(attachment.fileName)}`,
          { message_thread_id: threadId, parse_mode: "HTML" },
        ),
      );
      return;
    }

    try {
      const inputFile = new InputFile(attachment.filePath);
      if (attachment.type === "image") {
        await this.sendQueue.enqueue(() =>
          this.bot.api.sendPhoto(this.telegramConfig.chatId, inputFile, {
            message_thread_id: threadId,
          }),
        );
      } else if (attachment.type === "audio") {
        await this.sendQueue.enqueue(() =>
          this.bot.api.sendVoice(this.telegramConfig.chatId, inputFile, {
            message_thread_id: threadId,
          }),
        );
        // Strip [TTS]...[/TTS] block from the text message after voice is sent
        const draft = this.draftManager.getDraft(sessionId);
        if (draft) {
          draft.stripPattern(/\[TTS\][\s\S]*?\[\/TTS\]/g).catch(() => {});
        }
      } else {
        await this.sendQueue.enqueue(() =>
          this.bot.api.sendDocument(this.telegramConfig.chatId, inputFile, {
            message_thread_id: threadId,
          }),
        );
      }
    } catch (err) {
      log.error(
        { err, sessionId, fileName: attachment.fileName },
        "Failed to send attachment",
      );
    }
  }

  protected async handleSessionEnd(
    sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {
    this.getTracer(sessionId)?.log("telegram", { action: "handle:sessionEnd", sessionId });
    const threadId = this.getThreadId(sessionId);
    await this.draftManager.finalize(sessionId, this.assistantSession?.id);
    this.draftManager.cleanup(sessionId);
    await this.skillManager.cleanup(sessionId);
    const tracker = this.sessionTrackers.get(sessionId);
    if (tracker) {
      await tracker.cleanup();
      this.sessionTrackers.delete(sessionId);
    } else {
      await this.sendQueue.enqueue(() =>
        this.bot.api.sendMessage(this.telegramConfig.chatId, `✅ <b>Done</b>`, {
          message_thread_id: threadId,
          parse_mode: "HTML",
          disable_notification: true,
        }),
      );
    }
  }

  protected async handleError(
    sessionId: string,
    content: OutgoingMessage,
  ): Promise<void> {
    this.getTracer(sessionId)?.log("telegram", { action: "handle:error", sessionId, text: content.text });
    const threadId = this.getThreadId(sessionId);
    await this.draftManager.finalize(sessionId, this.assistantSession?.id);
    const tracker = this.sessionTrackers.get(sessionId);
    if (tracker) {
      tracker.destroy();
      this.sessionTrackers.delete(sessionId);
    }
    await this.sendQueue.enqueue(() =>
      this.bot.api.sendMessage(
        this.telegramConfig.chatId,
        `❌ <b>Error:</b> ${escapeHtml(content.text)}`,
        {
          message_thread_id: threadId,
          parse_mode: "HTML",
          disable_notification: true,
        },
      ),
    );
  }

  protected async handleSystem(
    sessionId: string,
    content: OutgoingMessage,
  ): Promise<void> {
    this.getTracer(sessionId)?.log("telegram", { action: "handle:system", sessionId, text: content.text });
    const threadId = this.getThreadId(sessionId);
    await this.sendQueue.enqueue(() =>
      this.bot.api.sendMessage(
        this.telegramConfig.chatId,
        escapeHtml(content.text),
        {
          message_thread_id: threadId,
          parse_mode: "HTML",
          disable_notification: true,
        },
      ),
    );
  }

  async sendPermissionRequest(
    sessionId: string,
    request: PermissionRequest,
  ): Promise<void> {
    this.getTracer(sessionId)?.log("telegram", { action: "permission:send", sessionId, requestId: request.id, description: request.description });
    log.info({ sessionId, requestId: request.id }, "Permission request sent");
    const session = this.core.sessionManager.getSession(sessionId);
    if (!session) return;

    await this.sendQueue.enqueue(() =>
      this.permissionHandler.sendPermissionRequest(session, request),
    );
  }

  async sendNotification(notification: NotificationMessage): Promise<void> {
    this.getTracer(notification.sessionId)?.log("telegram", { action: "notification:send", sessionId: notification.sessionId, type: notification.type });
    if (notification.sessionId === this.assistantSession?.id) return;

    log.info(
      { sessionId: notification.sessionId, type: notification.type },
      "Notification sent",
    );
    if (!this.notificationTopicId) return;
    const emoji: Record<string, string> = {
      completed: "✅",
      error: "❌",
      permission: "🔐",
      input_required: "💬",
    };
    let text = `${emoji[notification.type] || "ℹ️"} <b>${escapeHtml(notification.sessionName || "New session")}</b>\n`;
    text += escapeHtml(notification.summary);

    const deepLink =
      notification.deepLink ??
      (() => {
        const session = this.core.sessionManager.getSession(
          notification.sessionId,
        );
        const threadId = session?.threadId;
        if (!threadId) return undefined;
        const chatIdStr = String(this.telegramConfig.chatId);
        const numericId = chatIdStr.startsWith("-100")
          ? chatIdStr.slice(4)
          : chatIdStr.replace("-", "");
        return `https://t.me/c/${numericId}/${threadId}`;
      })();

    if (deepLink) {
      text += `\n\n<a href="${deepLink}">→ Go to topic</a>`;
    }

    await this.sendQueue.enqueue(() =>
      this.bot.api.sendMessage(this.telegramConfig.chatId, text, {
        message_thread_id: this.notificationTopicId,
        parse_mode: "HTML",
        disable_notification: false,
      }),
    );
  }

  async createSessionThread(sessionId: string, name: string): Promise<string> {
    this.getTracer(sessionId)?.log("telegram", { action: "thread:create", sessionId, name });
    log.info({ sessionId, name }, "Session topic created");
    return String(
      await createSessionTopic(this.bot, this.telegramConfig.chatId, name),
    );
  }

  async renameSessionThread(sessionId: string, newName: string): Promise<void> {
    this.getTracer(sessionId)?.log("telegram", { action: "thread:rename", sessionId, newName });
    const session = this.core.sessionManager.getSession(sessionId);
    if (!session) return;
    await renameSessionTopic(
      this.bot,
      this.telegramConfig.chatId,
      Number(session.threadId),
      newName,
    );
    await this.core.sessionManager.patchRecord(sessionId, { name: newName });
  }

  async deleteSessionThread(sessionId: string): Promise<void> {
    const record = this.core.sessionManager.getSessionRecord(sessionId);
    const platform = record?.platform as
      | import("../../core/types.js").TelegramPlatformData
      | undefined;
    const topicId = platform?.topicId;
    if (!topicId) return;

    try {
      await this.bot.api.deleteForumTopic(this.telegramConfig.chatId, topicId);
    } catch (err) {
      log.warn(
        { err, sessionId, topicId },
        "Failed to delete forum topic (may already be deleted)",
      );
    }
  }

  async sendSkillCommands(
    sessionId: string,
    commands: AgentCommand[],
  ): Promise<void> {
    if (sessionId === this.assistantSession?.id) return;

    const session = this.core.sessionManager.getSession(sessionId);
    if (!session) return;
    const threadId = Number(session.threadId);
    if (!threadId) return;

    await this.skillManager.send(sessionId, threadId, commands);
  }

  private resolveSessionId(threadId: number): string | undefined {
    return this.core.sessionManager.getSessionByThread(
      "telegram",
      String(threadId),
    )?.id;
  }

  private async downloadTelegramFile(
    fileId: string,
  ): Promise<{ buffer: Buffer; filePath: string } | null> {
    try {
      const file = await this.bot.api.getFile(fileId);
      if (!file.file_path) return null;
      const url = `https://api.telegram.org/file/bot${this.telegramConfig.botToken}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, filePath: file.file_path };
    } catch (err) {
      log.error({ err }, "Failed to download file from Telegram");
      return null;
    }
  }

  private async handleIncomingMedia(
    threadId: number,
    userId: number,
    fileId: string,
    fileName: string,
    mimeType: string,
    caption?: string,
    convertOggToWav?: boolean,
  ): Promise<void> {
    const downloaded = await this.downloadTelegramFile(fileId);
    if (!downloaded) return;

    let buffer = downloaded.buffer;
    let originalFilePath: string | undefined;
    const sessionId = this.resolveSessionId(threadId) || "unknown";

    if (convertOggToWav) {
      // Save original OGG for STT (smaller, API-compatible)
      const oggAtt = await this.fileService.saveFile(
        sessionId,
        "voice.ogg",
        downloaded.buffer,
        "audio/ogg",
      );
      originalFilePath = oggAtt.filePath;

      try {
        buffer = await this.fileService.convertOggToWav(buffer);
      } catch (err) {
        log.warn({ err }, "OGG→WAV conversion failed, saving original OGG");
        fileName = "voice.ogg";
        mimeType = "audio/ogg";
        originalFilePath = undefined;
      }
    }

    const att = await this.fileService.saveFile(
      sessionId,
      fileName,
      buffer,
      mimeType,
    );
    if (originalFilePath) {
      att.originalFilePath = originalFilePath;
    }

    const rawText =
      caption ||
      `[${att.type === "image" ? "Photo" : att.type === "audio" ? "Audio" : "File"}: ${att.fileName}]`;
    const text = rawText.startsWith("/") ? rawText.slice(1) : rawText;

    // Assistant topic
    if (threadId === this.assistantTopicId) {
      if (this.assistantSession) {
        await this.assistantSession.enqueuePrompt(text, [att]);
      }
      return;
    }

    // Session topic
    const sid = this.resolveSessionId(threadId);
    if (sid) await this.draftManager.finalize(sid, this.assistantSession?.id);
    this.core
      .handleMessage({
        channelId: "telegram",
        threadId: String(threadId),
        userId: String(userId),
        text,
        attachments: [att],
      })
      .catch((err) => log.error({ err }, "handleMessage error"));
  }

  async cleanupSkillCommands(sessionId: string): Promise<void> {
    await this.skillManager.cleanup(sessionId);
  }

  async stripTTSBlock(sessionId: string): Promise<void> {
    await this.draftManager.stripPattern(sessionId, /\[TTS\][\s\S]*?\[\/TTS\]/g);
  }

  async archiveSessionTopic(sessionId: string): Promise<string> {
    this.getTracer(sessionId)?.log("telegram", { action: "thread:archive", sessionId });
    const core = this.core as OpenACPCore;
    const session = core.sessionManager.getSession(sessionId);
    if (!session) throw new Error("Session not found");

    const chatId = this.telegramConfig.chatId;
    const oldTopicId = Number(session.threadId);

    // Set archiving flag — sendMessage will skip while this is true.
    session.archiving = true;

    // Finalize any pending draft
    await this.draftManager.finalize(session.id, this.assistantSession?.id);

    // Cleanup all trackers
    this.draftManager.cleanup(session.id);
    await this.skillManager.cleanup(session.id);
    const tracker = this.sessionTrackers.get(session.id);
    if (tracker) {
      tracker.destroy();
      this.sessionTrackers.delete(session.id);
    }

    // 1. Delete old topic (removes all messages)
    await deleteSessionTopic(this.bot, chatId, oldTopicId);

    // 2. Create new topic with session name
    const topicName = session.name ?? `Session ${session.id.slice(0, 6)}`;
    const newTopicId = await createSessionTopic(this.bot, chatId, topicName);

    // Clear archiving flag — messages can now be sent to new topic
    session.archiving = false;

    return String(newTopicId);
  }
}
