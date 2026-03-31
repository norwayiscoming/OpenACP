import path from "node:path";
import os from "node:os";
import { ConfigManager } from "./config/config.js";
import { AgentManager } from "./agents/agent-manager.js";
import { SessionManager } from "./sessions/session-manager.js";
import { SessionBridge } from "./sessions/session-bridge.js";
import type { NotificationManager } from "../plugins/notifications/notification.js";
import type { IChannelAdapter } from "./channel.js";
import { Session } from "./sessions/session.js";
import { MessageTransformer } from "./message-transformer.js";
import type { FileServiceInterface } from "./plugin/types.js";
import { JsonFileSessionStore, type SessionStore } from "./sessions/session-store.js";
import type { SecurityGuard } from "../plugins/security/security-guard.js";
import { SessionFactory } from "./sessions/session-factory.js";
import type { AgentEvent, IncomingMessage } from "./types.js";
import type { TunnelService } from "../plugins/tunnel/tunnel-service.js";
import { getAgentCapabilities } from "./agents/agent-registry.js";
import { AgentSwitchHandler } from "./agent-switch-handler.js";
import { AgentCatalog } from "./agents/agent-catalog.js";
import { AgentStore } from "./agents/agent-store.js";
import { EventBus } from "./event-bus.js";
import { LifecycleManager } from "./plugin/lifecycle-manager.js";
import { ServiceRegistry } from "./plugin/service-registry.js";
import { MiddlewareChain } from "./plugin/middleware-chain.js";
import { ErrorTracker } from "./plugin/error-tracker.js";
import { createChildLogger } from "./utils/log.js";
import type { SpeechService } from "../plugins/speech/exports.js";
import type { ContextManager } from "../plugins/context/context-manager.js";
import type { ContextQuery, ContextOptions, ContextResult } from "../plugins/context/context-provider.js";
import type { InstanceContext } from "./instance/instance-context.js";
const log = createChildLogger({ module: "core" });

export class OpenACPCore {
  configManager: ConfigManager;
  agentCatalog: AgentCatalog;
  agentManager: AgentManager;
  sessionManager: SessionManager;
  messageTransformer: MessageTransformer;
  adapters: Map<string, IChannelAdapter> = new Map();
  /** sessionId → SessionBridge — tracks active bridges for disconnect/reconnect during agent switch */
  private bridges: Map<string, SessionBridge> = new Map();
  /** Set by main.ts — triggers graceful shutdown with restart exit code */
  requestRestart: (() => Promise<void>) | null = null;
  private _tunnelService?: TunnelService;
  private sessionStore: SessionStore | null = null;
  private resumeLocks: Map<string, Promise<Session | null>> = new Map();
  eventBus: EventBus;
  sessionFactory: SessionFactory;
  readonly lifecycleManager: LifecycleManager;
  private agentSwitchHandler: AgentSwitchHandler;
  public readonly instanceContext?: InstanceContext;

  // --- Lazy getters: resolve from ServiceRegistry (populated by plugins during boot) ---

  private getService<T>(name: string): T {
    const svc = this.lifecycleManager.serviceRegistry.get<T>(name);
    if (!svc) throw new Error(`Service '${name}' not registered — is the ${name} plugin loaded?`);
    return svc;
  }

  get securityGuard(): SecurityGuard {
    return this.getService<SecurityGuard>('security');
  }

  get notificationManager(): NotificationManager {
    return this.getService<NotificationManager>('notifications');
  }

  get fileService(): FileServiceInterface {
    return this.getService<FileServiceInterface>('file-service');
  }

  get speechService(): SpeechService {
    return this.getService<SpeechService>('speech');
  }

  get contextManager(): ContextManager {
    return this.getService<ContextManager>('context');
  }

  constructor(configManager: ConfigManager, ctx?: InstanceContext) {
    this.configManager = configManager;
    this.instanceContext = ctx;
    const config = configManager.get();
    this.agentCatalog = new AgentCatalog(
      ctx ? new AgentStore(ctx.paths.agents) : undefined,
      ctx?.paths.registryCache,
      ctx?.paths.agentsDir,
    );
    this.agentCatalog.load();
    this.agentManager = new AgentManager(this.agentCatalog);
    const storePath = ctx?.paths.sessions ?? path.join(os.homedir(), ".openacp", "sessions.json");
    this.sessionStore = new JsonFileSessionStore(
      storePath,
      config.sessionStore.ttlDays,
    );
    this.sessionManager = new SessionManager(this.sessionStore);

    this.messageTransformer = new MessageTransformer();
    this.eventBus = new EventBus();
    this.sessionManager.setEventBus(this.eventBus);

    // SessionFactory uses a lazy accessor for speechService (resolved from ServiceRegistry after plugin boot)
    this.sessionFactory = new SessionFactory(
      this.agentManager,
      this.sessionManager,
      () => this.speechService,
      this.eventBus,
      ctx?.root,
    );

    // Initialize plugin lifecycle manager (before setting middlewareChain on factory)
    this.lifecycleManager = new LifecycleManager({
      serviceRegistry: new ServiceRegistry(),
      middlewareChain: new MiddlewareChain(),
      errorTracker: new ErrorTracker(),
      eventBus: this.eventBus as any,
      sessions: this.sessionManager,
      config: this.configManager,
      core: this,
      storagePath: ctx?.paths.pluginsData ?? path.join(os.homedir(), ".openacp", "plugins", "data"),
      instanceRoot: ctx?.root,
      log: createChildLogger({ module: "plugin" }),
    });

    // Wire middleware chain to session factory and session manager
    this.sessionFactory.middlewareChain = this.lifecycleManager.middlewareChain;
    this.sessionManager.middlewareChain = this.lifecycleManager.middlewareChain;

    this.agentSwitchHandler = new AgentSwitchHandler({
      sessionManager: this.sessionManager,
      agentManager: this.agentManager,
      configManager: this.configManager,
      eventBus: this.eventBus,
      adapters: this.adapters,
      bridges: this.bridges,
      createBridge: (session, adapter) => this.createBridge(session, adapter),
      getMiddlewareChain: () => this.lifecycleManager?.middlewareChain,
      getService: <T>(name: string) => this.lifecycleManager.serviceRegistry.get<T>(name),
    });

    // Hot-reload: handle config changes that need side effects
    this.configManager.on(
      "config:changed",
      async ({ path: configPath, value }: { path: string; value: unknown }) => {
        if (configPath === "logging.level" && typeof value === "string") {
          const { setLogLevel } = await import("./utils/log.js");
          setLogLevel(value);
          log.info({ level: value }, "Log level changed at runtime");
        }
        if (configPath.startsWith("speech.")) {
          const speechSvc = this.speechService;
          if (speechSvc) {
            const newConfig = this.configManager.get();
            const newSpeechConfig = newConfig.speech ?? {
              stt: { provider: null, providers: {} },
              tts: { provider: null, providers: {} },
            };
            speechSvc.refreshProviders(newSpeechConfig);
            log.info("Speech service config updated at runtime");
          }
        }
      },
    );
  }

  get tunnelService(): TunnelService | undefined {
    return this._tunnelService;
  }

  set tunnelService(service: TunnelService | undefined) {
    this._tunnelService = service;
    this.messageTransformer.tunnelService = service;
  }

  registerAdapter(name: string, adapter: IChannelAdapter): void {
    this.adapters.set(name, adapter);
  }

  async start(): Promise<void> {
    this.agentCatalog.refreshRegistryIfStale().catch((err) => {
      log.warn({ err }, "Background registry refresh failed");
    });
    const failures: Array<{ name: string; error: unknown }> = [];
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        await adapter.start();
      } catch (err) {
        log.error({ err, adapter: name }, `Adapter "${name}" failed to start`);
        failures.push({ name, error: err });
      }
    }
    if (failures.length > 0 && failures.length === this.adapters.size) {
      throw new Error(
        `All adapters failed to start: ${failures.map((f) => f.name).join(", ")}`,
      );
    }
  }

  async stop(): Promise<void> {
    // 1. Notify users (best effort — service may not be available)
    try {
      const nm = this.lifecycleManager.serviceRegistry.get<NotificationManager>('notifications');
      if (nm) {
        await nm.notifyAll({
          sessionId: "system",
          type: "error",
          summary: "OpenACP is shutting down",
        });
      }
    } catch {
      /* best effort */
    }

    // 2. Persist session state (don't kill agents — they exit with parent)
    await this.sessionManager.shutdownAll();

    // 3. Stop adapters
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
  }

  // --- Archive ---

  async archiveSession(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return { ok: false, error: "Session not found (must be in memory)" };

    // Must be active (not initializing or finished)
    if (session.status !== "active" && session.status !== "cancelled" && session.status !== "error") {
      return { ok: false, error: `Cannot archive session in '${session.status}' state` };
    }

    const adapter = this.adapters.get(session.channelId);
    if (!adapter) return { ok: false, error: "Adapter not found for session" };
    if (!adapter.archiveSessionTopic) return { ok: false, error: "Adapter does not support topic archiving" };

    try {
      // archiveSessionTopic handles: cleanup trackers → delete topic
      await adapter.archiveSessionTopic(session.id);

      // Cancel session — stops agent, removes from active sessions, marks record as cancelled
      await this.sessionManager.cancelSession(sessionId);

      return { ok: true };
    } catch (err) {
      // Clear archiving flag on error
      session.archiving = false;
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

    // Hook: message:incoming — modifiable, can block
    if (this.lifecycleManager?.middlewareChain) {
      const result = await this.lifecycleManager.middlewareChain.execute(
        'message:incoming',
        message,
        async (msg) => msg,
      );
      if (!result) return; // blocked by middleware
      message = result;
    }

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
    threadId?: string;
  }): Promise<Session> {
    // 1-3. Spawn/resume agent, create Session, register in SessionManager
    const session = await this.sessionFactory.create(params);

    // Set threadId early so agent events during bridge.connect() can find the thread
    if (params.threadId) {
      session.threadId = params.threadId;
    }

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
      eventBus: this.eventBus,
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
      firstAgent: session.firstAgent,
      currentPromptCount: session.promptCount,
      agentSwitchHistory: session.agentSwitchHistory,
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

  // --- Agent Switch ---

  async switchSessionAgent(sessionId: string, toAgent: string): Promise<{ resumed: boolean }> {
    return this.agentSwitchHandler.switch(sessionId, toAgent);
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

    // Don't resume errored or cancelled sessions
    if (record.status === "error" || record.status === "cancelled") {
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
          threadId: message.threadId,
        });
        session.activate();
        session.dangerousMode = record.dangerousMode ?? false;
        if (record.firstAgent) session.firstAgent = record.firstAgent;
        if (record.agentSwitchHistory) session.agentSwitchHistory = record.agentSwitchHistory;
        if (record.currentPromptCount != null) session.promptCount = record.currentPromptCount;

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
  createBridge(session: Session, adapter: IChannelAdapter): SessionBridge {
    const bridge = new SessionBridge(session, adapter, {
      messageTransformer: this.messageTransformer,
      notificationManager: this.notificationManager,
      sessionManager: this.sessionManager,
      eventBus: this.eventBus,
      fileService: this.fileService,
      middlewareChain: this.lifecycleManager?.middlewareChain,
    });
    this.bridges.set(session.id, bridge);
    return bridge;
  }
}
