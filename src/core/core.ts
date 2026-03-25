import path from "node:path";
import os from "node:os";
import { ConfigManager } from "./config.js";
import { AgentManager } from "./agent-manager.js";
import { SessionManager } from "./session-manager.js";
import { SessionBridge } from "./session-bridge.js";
import { NotificationManager } from "./notification.js";
import { ChannelAdapter } from "./channel.js";
import { Session } from "./session.js";
import { MessageTransformer } from "./message-transformer.js";
import { FileService } from "./file-service.js";
import { JsonFileSessionStore, type SessionStore } from "./session-store.js";
import { UsageStore } from "./usage-store.js";
import { UsageBudget } from "./usage-budget.js";
import { SecurityGuard } from "./security-guard.js";
import { SessionFactory } from "./session-factory.js";
import type { IncomingMessage } from "./types.js";
import type { TunnelService } from "../tunnel/tunnel-service.js";
import { getAgentCapabilities } from "./agent-registry.js";
import { AgentCatalog } from "./agent-catalog.js";
import { EventBus } from "./event-bus.js";
import { createChildLogger } from "./log.js";
import { SpeechService, GroqSTT, EdgeTTS } from "./speech/index.js";
import { ContextManager } from "./context/context-manager.js";
import { EntireProvider } from "./context/entire/entire-provider.js";
import type { ContextQuery, ContextOptions, ContextResult } from "./context/context-provider.js";
const log = createChildLogger({ module: "core" });

export class OpenACPCore {
  configManager: ConfigManager;
  agentCatalog: AgentCatalog;
  agentManager: AgentManager;
  sessionManager: SessionManager;
  notificationManager: NotificationManager;
  messageTransformer: MessageTransformer;
  fileService: FileService;
  readonly speechService: SpeechService;
  securityGuard: SecurityGuard;
  adapters: Map<string, ChannelAdapter> = new Map();
  /** Set by main.ts — triggers graceful shutdown with restart exit code */
  requestRestart: (() => Promise<void>) | null = null;
  private _tunnelService?: TunnelService;
  private sessionStore: SessionStore | null = null;
  private resumeLocks: Map<string, Promise<Session | null>> = new Map();
  eventBus: EventBus;
  sessionFactory: SessionFactory;
  readonly usageStore: UsageStore | null = null;
  readonly usageBudget: UsageBudget | null = null;
  readonly contextManager: ContextManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    const config = configManager.get();
    this.agentCatalog = new AgentCatalog();
    this.agentCatalog.load();
    this.agentManager = new AgentManager(this.agentCatalog);
    const storePath = path.join(os.homedir(), ".openacp", "sessions.json");
    this.sessionStore = new JsonFileSessionStore(
      storePath,
      config.sessionStore.ttlDays,
    );
    this.sessionManager = new SessionManager(this.sessionStore);
    this.securityGuard = new SecurityGuard(configManager, this.sessionManager);
    this.notificationManager = new NotificationManager(this.adapters);

    // Usage tracking
    const usageConfig = config.usage;
    if (usageConfig.enabled) {
      const usagePath = path.join(os.homedir(), ".openacp", "usage.json");
      this.usageStore = new UsageStore(usagePath, usageConfig.retentionDays);
      this.usageBudget = new UsageBudget(this.usageStore, usageConfig);
    }

    this.messageTransformer = new MessageTransformer();
    this.eventBus = new EventBus();
    this.sessionManager.setEventBus(this.eventBus);
    this.contextManager = new ContextManager();
    this.contextManager.register(new EntireProvider());
    this.fileService = new FileService(
      path.join(os.homedir(), ".openacp", "files"),
    );

    // Initialize speech service — edge-tts is always available by default (free, no API key)
    const speechConfig = config.speech ?? {
      stt: { provider: null, providers: {} },
      tts: { provider: "edge-tts", providers: {} },
    };
    // Default TTS provider to edge-tts if not explicitly set
    if (speechConfig.tts.provider == null) {
      speechConfig.tts.provider = "edge-tts";
    }
    this.speechService = new SpeechService(speechConfig);

    // Register built-in STT providers
    const groqConfig = speechConfig.stt?.providers?.groq;
    if (groqConfig?.apiKey) {
      this.speechService.registerSTTProvider(
        "groq",
        new GroqSTT(groqConfig.apiKey, groqConfig.model),
      );
    }

    // Register built-in TTS providers — always register edge-tts (free, no config needed)
    {
      const edgeConfig = speechConfig.tts?.providers?.["edge-tts"];
      const voice = edgeConfig?.voice as string | undefined;
      this.speechService.registerTTSProvider("edge-tts", new EdgeTTS(voice));
    }

    this.sessionFactory = new SessionFactory(
      this.agentManager,
      this.sessionManager,
      this.speechService,
      this.eventBus,
    );

    // Hot-reload: handle config changes that need side effects
    this.configManager.on(
      "config:changed",
      async ({ path: configPath, value }: { path: string; value: unknown }) => {
        if (configPath === "logging.level" && typeof value === "string") {
          const { setLogLevel } = await import("./log.js");
          setLogLevel(value);
          log.info({ level: value }, "Log level changed at runtime");
        }
        if (configPath.startsWith("speech.")) {
          const newConfig = this.configManager.get();
          const newSpeechConfig = newConfig.speech ?? {
            stt: { provider: null, providers: {} },
            tts: { provider: null, providers: {} },
          };
          this.speechService.updateConfig(newSpeechConfig);
          const groqCfg = newSpeechConfig.stt?.providers?.groq;
          if (groqCfg?.apiKey) {
            this.speechService.registerSTTProvider(
              "groq",
              new GroqSTT(groqCfg.apiKey, groqCfg.model),
            );
          }
          // Re-register TTS providers on config change — always keep edge-tts available
          {
            const edgeConfig = newSpeechConfig.tts?.providers?.["edge-tts"];
            const voice = edgeConfig?.voice as string | undefined;
            this.speechService.registerTTSProvider("edge-tts", new EdgeTTS(voice));
          }
          log.info("Speech service config updated at runtime");
        }
      },
    );
  }

  get tunnelService(): TunnelService | undefined {
    return this._tunnelService;
  }

  set tunnelService(service: TunnelService | undefined) {
    this._tunnelService = service;
    this.messageTransformer = new MessageTransformer(service);
  }

  registerAdapter(name: string, adapter: ChannelAdapter): void {
    this.adapters.set(name, adapter);
  }

  async start(): Promise<void> {
    this.agentCatalog.refreshRegistryIfStale().catch((err) => {
      log.warn({ err }, "Background registry refresh failed");
    });
    for (const adapter of this.adapters.values()) {
      await adapter.start();
    }
  }

  async stop(): Promise<void> {
    // 1. Notify users
    try {
      await this.notificationManager.notifyAll({
        sessionId: "system",
        type: "error",
        summary: "OpenACP is shutting down",
      });
    } catch {
      /* best effort */
    }

    // 2. Destroy all sessions
    await this.sessionManager.destroyAll();

    // 3. Stop adapters
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }

    // 4. Cleanup usage store
    if (this.usageStore) {
      this.usageStore.destroy();
    }
  }

  // --- Archive ---

  async archiveSession(
    sessionId: string,
  ): Promise<{ ok: true; newThreadId: string } | { ok: false; error: string }> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return { ok: false, error: "Session not found" };
    if (session.status === "initializing")
      return { ok: false, error: "Session is still initializing" };
    if (session.status !== "active")
      return { ok: false, error: `Session is ${session.status}` };

    const adapter = this.adapters.get(session.channelId);
    if (!adapter) return { ok: false, error: "Adapter not found for session" };

    try {
      const result = await adapter.archiveSessionTopic(session.id);
      if (!result)
        return { ok: false, error: "Adapter does not support archiving" };
      return { ok: true, newThreadId: result.newThreadId };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // --- Message Routing ---

  async handleMessage(message: IncomingMessage): Promise<void> {
    log.debug(
      {
        channelId: message.channelId,
        threadId: message.threadId,
        userId: message.userId,
      },
      "Incoming message",
    );

    // Security: check user access and session limits
    const access = this.securityGuard.checkAccess(message);
    if (!access.allowed) {
      log.warn({ userId: message.userId, reason: access.reason }, "Access denied");
      if (access.reason.includes("Session limit")) {
        const adapter = this.adapters.get(message.channelId);
        if (adapter) {
          await adapter.sendMessage(message.threadId, {
            type: "error",
            text: `⚠️ ${access.reason}. Please cancel existing sessions with /cancel before starting new ones.`,
          });
        }
      }
      return;
    }

    // Find session by thread
    let session = this.sessionManager.getSessionByThread(
      message.channelId,
      message.threadId,
    );

    // Lazy resume: try to restore session from store
    if (!session) {
      session = (await this.lazyResume(message)) ?? undefined;
    }

    if (!session) {
      log.warn(
        { channelId: message.channelId, threadId: message.threadId },
        "No session found for thread (in-memory miss + lazy resume returned null)",
      );
      return;
    }

    // Update activity timestamp
    this.sessionManager.patchRecord(session.id, {
      lastActiveAt: new Date().toISOString(),
    });

    // Forward to session
    await session.enqueuePrompt(message.text, message.attachments);
  }

  // --- Unified Session Creation Pipeline ---

  async createSession(params: {
    channelId: string;
    agentName: string;
    workingDirectory: string;
    resumeAgentSessionId?: string;
    existingSessionId?: string;
    createThread?: boolean;
    initialName?: string;
  }): Promise<Session> {
    // 1-3. Spawn/resume agent, create Session, register in SessionManager
    const session = await this.sessionFactory.create(params);

    // 4. Create thread if needed
    const adapter = this.adapters.get(params.channelId);
    if (params.createThread && adapter) {
      const threadId = await adapter.createSessionThread(
        session.id,
        params.initialName ?? `🔄 ${params.agentName} — New Session`,
      );
      session.threadId = threadId;
    }

    // 5. Connect SessionBridge
    if (adapter) {
      const bridge = this.createBridge(session, adapter);
      bridge.connect();
    }

    // 5b-5c. Wire usage tracking and tunnel cleanup
    this.sessionFactory.wireSideEffects(session, {
      usageStore: this.usageStore,
      usageBudget: this.usageBudget,
      notificationManager: this.notificationManager,
      tunnelService: this._tunnelService,
    });

    // 6. Persist initial record
    // Preserve existing platform data (e.g. topicId) when resuming an existing session
    const existingRecord = this.sessionStore?.get(session.id);
    const platform: Record<string, unknown> = {
      ...(existingRecord?.platform ?? {}),
    };
    if (session.threadId) {
      if (params.channelId === "telegram") {
        platform.topicId = Number(session.threadId);
      } else {
        platform.threadId = session.threadId;
      }
    }
    await this.sessionManager.patchRecord(session.id, {
      sessionId: session.id,
      agentSessionId: session.agentSessionId,
      agentName: params.agentName,
      workingDir: params.workingDirectory,
      channelId: params.channelId,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: new Date().toISOString(),
      name: session.name,
      platform,
    });

    log.info(
      { sessionId: session.id, agentName: params.agentName },
      "Session created via pipeline",
    );
    return session;
  }

  async handleNewSession(
    channelId: string,
    agentName?: string,
    workspacePath?: string,
    options?: { createThread?: boolean },
  ): Promise<Session> {
    const config = this.configManager.get();
    const resolvedAgent = agentName || config.defaultAgent;
    log.info({ channelId, agentName: resolvedAgent }, "New session request");
    const agentDef = this.agentCatalog.resolve(resolvedAgent);
    const resolvedWorkspace = this.configManager.resolveWorkspace(
      workspacePath || agentDef?.workingDirectory,
    );

    return this.createSession({
      channelId,
      agentName: resolvedAgent,
      workingDirectory: resolvedWorkspace,
      createThread: options?.createThread,
    });
  }

  async adoptSession(
    agentName: string,
    agentSessionId: string,
    cwd: string,
    channelId?: string,
  ): Promise<
    | {
        ok: true;
        sessionId: string;
        threadId: string;
        status: "adopted" | "existing";
      }
    | { ok: false; error: string; message: string }
  > {
    // 1. Validate agent supports resume
    const caps = getAgentCapabilities(agentName);
    if (!caps.supportsResume) {
      return {
        ok: false,
        error: "agent_not_supported",
        message: `Agent '${agentName}' does not support session resume`,
      };
    }

    const agentDef = this.agentManager.getAgent(agentName);
    if (!agentDef) {
      return {
        ok: false,
        error: "agent_not_supported",
        message: `Agent '${agentName}' not found`,
      };
    }

    // 2. Validate cwd
    const { existsSync } = await import("node:fs");
    if (!existsSync(cwd)) {
      return {
        ok: false,
        error: "invalid_cwd",
        message: `Directory does not exist: ${cwd}`,
      };
    }

    // 3. Check session limit
    const maxSessions = this.configManager.get().security.maxConcurrentSessions;
    if (this.sessionManager.listSessions().length >= maxSessions) {
      return {
        ok: false,
        error: "session_limit",
        message: "Maximum concurrent sessions reached",
      };
    }

    // 4. Check if session already exists on the same channel
    const existingRecord =
      this.sessionManager.getRecordByAgentSessionId(agentSessionId);
    if (existingRecord) {
      const sameChannel = !channelId || existingRecord.channelId === channelId;
      const platform = existingRecord.platform as { topicId?: number; threadId?: string } | undefined;
      const existingThreadId = platform?.topicId ? String(platform.topicId) : platform?.threadId;
      if (existingThreadId && sameChannel) {
        const adapter = this.adapters.get(existingRecord.channelId) ?? this.adapters.values().next().value;
        if (adapter) {
          try {
            await adapter.sendMessage(existingRecord.sessionId, {
              type: "text",
              text: "Session resumed from CLI.",
            });
          } catch { /* Topic/thread may be deleted */ }
        }
        return {
          ok: true,
          sessionId: existingRecord.sessionId,
          threadId: existingThreadId,
          status: "existing",
        };
      }
    }

    // 5. Find adapter (explicit channel or default first)
    let adapterChannelId: string;
    if (channelId) {
      if (!this.adapters.has(channelId)) {
        const available = Array.from(this.adapters.keys()).join(", ") || "none";
        return { ok: false, error: "adapter_not_found", message: `Adapter '${channelId}' is not connected. Available: ${available}` };
      }
      adapterChannelId = channelId;
    } else {
      const firstEntry = this.adapters.entries().next().value;
      if (!firstEntry) {
        return { ok: false, error: "no_adapter", message: "No channel adapter registered" };
      }
      adapterChannelId = firstEntry[0];
    }

    // 6. Create session via unified pipeline
    let session: Session;
    try {
      session = await this.createSession({
        channelId: adapterChannelId,
        agentName,
        workingDirectory: cwd,
        resumeAgentSessionId: agentSessionId,
        createThread: true,
        initialName: "Adopted session",
      });
    } catch (err) {
      return {
        ok: false,
        error: "resume_failed",
        message: `Failed to resume session: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 7. Update store with adopt-specific fields
    const adoptPlatform: Record<string, unknown> = {};
    if (adapterChannelId === 'telegram') {
      adoptPlatform.topicId = Number(session.threadId);
    } else {
      adoptPlatform.threadId = session.threadId;
    }
    await this.sessionManager.patchRecord(session.id, {
      originalAgentSessionId: agentSessionId,
      platform: adoptPlatform,
    });

    return {
      ok: true,
      sessionId: session.id,
      threadId: session.threadId,
      status: "adopted",
    };
  }

  async handleNewChat(
    channelId: string,
    currentThreadId: string,
  ): Promise<Session | null> {
    const currentSession = this.sessionManager.getSessionByThread(
      channelId,
      currentThreadId,
    );

    if (currentSession) {
      return this.handleNewSession(
        channelId,
        currentSession.agentName,
        currentSession.workingDirectory,
      );
    }

    // Fallback: look up from store (e.g. after restart before lazy resume)
    const record = this.sessionManager.getRecordByThread(
      channelId,
      currentThreadId,
    );
    if (!record || record.status === "cancelled" || record.status === "error")
      return null;

    return this.handleNewSession(
      channelId,
      record.agentName,
      record.workingDir,
    );
  }

  async createSessionWithContext(params: {
    channelId: string;
    agentName: string;
    workingDirectory: string;
    contextQuery: ContextQuery;
    contextOptions?: ContextOptions;
    createThread?: boolean;
  }): Promise<{ session: Session; contextResult: ContextResult | null }> {
    let contextResult: ContextResult | null = null;
    try {
      contextResult = await this.contextManager.buildContext(
        params.contextQuery,
        params.contextOptions,
      );
    } catch (err) {
      log.warn({ err }, "Context building failed, proceeding without context");
    }

    const session = await this.createSession({
      channelId: params.channelId,
      agentName: params.agentName,
      workingDirectory: params.workingDirectory,
      createThread: params.createThread,
    });

    if (contextResult) {
      session.setContext(contextResult.markdown);
    }

    return { session, contextResult };
  }

  // --- Lazy Resume ---

  /**
   * Get active session by thread, or attempt lazy resume from store.
   * Used by adapter command handlers that need a session but don't go through handleMessage().
   */
  async getOrResumeSession(channelId: string, threadId: string): Promise<Session | null> {
    const session = this.sessionManager.getSessionByThread(channelId, threadId);
    if (session) return session;
    return this.lazyResume({ channelId, threadId, userId: "", text: "" });
  }

  private async lazyResume(message: IncomingMessage): Promise<Session | null> {
    const store = this.sessionStore;
    if (!store) return null;

    const lockKey = `${message.channelId}:${message.threadId}`;

    // Check for existing resume in progress
    const existing = this.resumeLocks.get(lockKey);
    if (existing) return existing;

    const record = store.findByPlatform(
      message.channelId,
      (p) => String(p.topicId) === message.threadId,
    );
    if (!record) {
      log.debug(
        { threadId: message.threadId, channelId: message.channelId },
        "No session record found for thread",
      );
      return null;
    }

    // Don't resume errored sessions (cancelled sessions can still be resumed)
    if (record.status === "error") {
      log.debug(
        {
          threadId: message.threadId,
          sessionId: record.sessionId,
          status: record.status,
        },
        "Skipping resume of error session",
      );
      return null;
    }

    log.info(
      {
        threadId: message.threadId,
        sessionId: record.sessionId,
        status: record.status,
      },
      "Lazy resume: found record, attempting resume",
    );

    const resumePromise = (async (): Promise<Session | null> => {
      try {
        const session = await this.createSession({
          channelId: record.channelId,
          agentName: record.agentName,
          workingDirectory: record.workingDir,
          resumeAgentSessionId: record.agentSessionId,
          existingSessionId: record.sessionId,
          initialName: record.name,
        });
        session.threadId = message.threadId;
        session.activate();
        session.dangerousMode = record.dangerousMode ?? false;

        log.info(
          { sessionId: session.id, threadId: message.threadId },
          "Lazy resume successful",
        );
        return session;
      } catch (err) {
        log.error({ err, record }, "Lazy resume failed");
        // Send error feedback to user instead of silent drop
        const adapter = this.adapters.get(message.channelId);
        if (adapter) {
          try {
            await adapter.sendMessage(message.threadId, {
              type: "error",
              text: `⚠️ Failed to resume session: ${err instanceof Error ? err.message : String(err)}`,
            });
          } catch {
            /* best effort */
          }
        }
        return null;
      } finally {
        this.resumeLocks.delete(lockKey);
      }
    })();

    this.resumeLocks.set(lockKey, resumePromise);
    return resumePromise;
  }

  // --- Event Wiring ---

  /** Create a SessionBridge for the given session and adapter */
  createBridge(session: Session, adapter: ChannelAdapter): SessionBridge {
    return new SessionBridge(session, adapter, {
      messageTransformer: this.messageTransformer,
      notificationManager: this.notificationManager,
      sessionManager: this.sessionManager,
      eventBus: this.eventBus,
      fileService: this.fileService,
    });
  }
}
