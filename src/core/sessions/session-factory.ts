import type { AgentManager } from "../agents/agent-manager.js";
import type { SessionManager } from "./session-manager.js";
import type { SpeechService } from "../../plugins/speech/exports.js";
import type { EventBus } from "../event-bus.js";
import type { NotificationManager } from "../../plugins/notifications/notification.js";
import type { TunnelService } from "../../plugins/tunnel/tunnel-service.js";
import type { AgentEvent } from "../types.js";
import type { MiddlewareChain } from "../plugin/middleware-chain.js";
import type { SessionStore } from "./session-store.js";
import type { IChannelAdapter } from "../channel.js";
import type { ConfigManager } from "../config/config.js";
import type { AgentCatalog } from "../agents/agent-catalog.js";
import type { ContextManager } from "../../plugins/context/context-manager.js";
import type { ContextQuery, ContextOptions, ContextResult } from "../../plugins/context/context-provider.js";
import { Session } from "./session.js";
import { createChildLogger } from "../utils/log.js";

const log = createChildLogger({ module: "session-factory" });

export interface SessionCreateParams {
  channelId: string;
  agentName: string;
  workingDirectory: string;
  resumeAgentSessionId?: string;
  existingSessionId?: string;
  initialName?: string;
}

export interface SideEffectDeps {
  eventBus: EventBus;
  notificationManager: NotificationManager;
  tunnelService?: TunnelService;
}

export class SessionFactory {
  middlewareChain?: MiddlewareChain;
  private resumeLocks: Map<string, Promise<Session | null>> = new Map();

  /** Injected by Core after construction — needed for lazy resume error feedback */
  adapters?: Map<string, IChannelAdapter>;
  /** Injected by Core after construction — needed for lazy resume store lookup */
  sessionStore?: SessionStore | null;
  /** Injected by Core — creates full session with thread + bridge + persist */
  createFullSession?: (params: SessionCreateParams & { threadId?: string; createThread?: boolean }) => Promise<Session>;
  /** Injected by Core — needed for resolving default agent and workspace */
  configManager?: ConfigManager;
  /** Injected by Core — needed for resolving agent definitions */
  agentCatalog?: AgentCatalog;
  /** Injected by Core — needed for context-aware session creation */
  getContextManager?: () => ContextManager | undefined;

  constructor(
    private agentManager: AgentManager,
    private sessionManager: SessionManager,
    private speechServiceAccessor: SpeechService | (() => SpeechService),
    private eventBus: EventBus,
    private instanceRoot?: string,
  ) {}

  private get speechService(): SpeechService {
    return typeof this.speechServiceAccessor === 'function'
      ? this.speechServiceAccessor()
      : this.speechServiceAccessor;
  }

  async create(params: SessionCreateParams): Promise<Session> {
    // Hook: session:beforeCreate — modifiable, can block
    let createParams = params;
    if (this.middlewareChain) {
      const payload = {
        agentName: params.agentName,
        workingDir: params.workingDirectory,
        userId: '', // userId is not part of SessionCreateParams — resolved upstream
        channelId: params.channelId,
        threadId: '', // threadId is assigned after session creation
      };
      const result = await this.middlewareChain.execute('session:beforeCreate', payload, async (p) => p);
      if (!result) throw new Error("Session creation blocked by middleware");
      // Apply any middleware modifications back to create params
      createParams = {
        ...params,
        agentName: result.agentName,
        workingDirectory: result.workingDir,
        channelId: result.channelId,
      };
    }

    // 1. Spawn or resume agent
    let agentInstance;
    try {
      agentInstance = createParams.resumeAgentSessionId
        ? await this.agentManager.resume(
            createParams.agentName,
            createParams.workingDirectory,
            createParams.resumeAgentSessionId,
          )
        : await this.agentManager.spawn(
            createParams.agentName,
            createParams.workingDirectory,
          );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);

      // Emit a structured guidance error so adapters (Telegram, SSE UI) can show clear next steps.
      // We intentionally avoid leaking internal paths — instead, we point users at the openacp wrapper.
      const guidanceLines = [
        `❌ Failed to start agent "${createParams.agentName}": ${message}`,
        "",
        "Run the agent CLI once in a terminal for this OpenACP instance to complete login or setup.",
      ];
      if (this.instanceRoot) {
        guidanceLines.push(
          "",
          "Copy and run this command in your terminal:",
          `  cd "${this.instanceRoot}" && openacp agents run ${createParams.agentName}`,
        );
      } else {
        guidanceLines.push(
          "",
          "Copy and run this command in your terminal (same project where you started OpenACP):",
          `  openacp agents run ${createParams.agentName}`,
        );
      }
      guidanceLines.push(
        "",
        "After setup completes, retry creating the session here.",
      );

      const guidance: AgentEvent = {
        type: "system_message",
        message: guidanceLines.join("\n"),
      };

      // Create a lightweight "failed" session context so UIs listening on the event bus
      // still receive a message in the right channel/thread.
      const failedSession = new Session({
        id: createParams.existingSessionId,
        channelId: createParams.channelId,
        agentName: createParams.agentName,
        workingDirectory: createParams.workingDirectory,
        // Dummy agent instance — will never be prompted
        agentInstance: {
          sessionId: "",
          prompt: async () => {},
          cancel: async () => {},
          destroy: async () => {},
          on: () => {},
          off: () => {},
        } as any,
        speechService: this.speechService,
      });
      this.sessionManager.registerSession(failedSession);
      failedSession.emit("agent_event", guidance);
      this.eventBus.emit("agent:event", {
        sessionId: failedSession.id,
        event: guidance,
      });

      // Re-throw so callers still see the failure
      throw err;
    }

    // Wire middleware chain to agent instance for FS/terminal hooks
    agentInstance.middlewareChain = this.middlewareChain;

    // 2. Create Session instance
    const session = new Session({
      id: createParams.existingSessionId,
      channelId: createParams.channelId,
      agentName: createParams.agentName,
      workingDirectory: createParams.workingDirectory,
      agentInstance,
      speechService: this.speechService,
    });
    session.agentSessionId = agentInstance.sessionId;
    session.middlewareChain = this.middlewareChain;
    if (createParams.initialName) {
      session.name = createParams.initialName;
    }

    // 3. Propagate ACP state from agent session response
    const resp = agentInstance.initialSessionResponse;
    if (resp) {
      if (resp.configOptions) {
        session.setInitialConfigOptions(resp.configOptions as import("../types.js").ConfigOption[]);
      }
      if (agentInstance.agentCapabilities) {
        session.setAgentCapabilities(agentInstance.agentCapabilities);
      }
    } else if (agentInstance.agentCapabilities) {
      session.setAgentCapabilities(agentInstance.agentCapabilities);
    }

    // 4. Register in SessionManager
    this.sessionManager.registerSession(session);
    this.eventBus.emit("session:created", {
      sessionId: session.id,
      agent: session.agentName,
      status: session.status,
    });

    return session;
  }

  /**
   * Get active session by thread, or attempt lazy resume from store.
   * Used by adapter command handlers and handleMessage().
   */
  async getOrResume(channelId: string, threadId: string): Promise<Session | null> {
    const session = this.sessionManager.getSessionByThread(channelId, threadId);
    if (session) return session;
    return this.lazyResume(channelId, threadId);
  }

  private async lazyResume(channelId: string, threadId: string): Promise<Session | null> {
    const store = this.sessionStore;
    if (!store || !this.createFullSession) return null;

    const lockKey = `${channelId}:${threadId}`;

    // Check for existing resume in progress
    const existing = this.resumeLocks.get(lockKey);
    if (existing) return existing;

    const record = store.findByPlatform(
      channelId,
      (p) => String(p.topicId) === threadId,
    );
    if (!record) {
      log.debug({ threadId, channelId }, "No session record found for thread");
      return null;
    }

    // Don't resume errored or cancelled sessions
    if (record.status === "error" || record.status === "cancelled") {
      log.warn(
        { threadId, sessionId: record.sessionId, status: record.status },
        "Session record found but skipped (status: %s) — use /new to start a fresh session",
        record.status,
      );
      return null;
    }

    log.info({ threadId, sessionId: record.sessionId, status: record.status }, "Lazy resume: found record, attempting resume");

    const resumePromise = (async (): Promise<Session | null> => {
      try {
        const session = await this.createFullSession!({
          channelId: record.channelId,
          agentName: record.agentName,
          workingDirectory: record.workingDir,
          resumeAgentSessionId: record.agentSessionId,
          existingSessionId: record.sessionId,
          initialName: record.name,
          threadId,
        });
        session.activate();
        // MIGRATION: old records with dangerousMode but no clientOverrides
        if (record.clientOverrides) {
          session.clientOverrides = record.clientOverrides;
        } else if (record.dangerousMode) {
          session.clientOverrides = { bypassPermissions: true };
        }
        if (record.firstAgent) session.firstAgent = record.firstAgent;
        if (record.agentSwitchHistory) session.agentSwitchHistory = record.agentSwitchHistory;
        if (record.currentPromptCount != null) session.promptCount = record.currentPromptCount;

        // Hydrate cached ACP state (will be overridden by agent events on resume)
        if (record.acpState) {
          if (record.acpState.configOptions) {
            session.setInitialConfigOptions(record.acpState.configOptions);
          }
          if (record.acpState.agentCapabilities) {
            session.setAgentCapabilities(record.acpState.agentCapabilities);
          }
        }

        log.info({ sessionId: session.id, threadId }, "Lazy resume successful");
        return session;
      } catch (err) {
        log.error({ err, record }, "Lazy resume failed");
        // Send error feedback to user
        const adapter = this.adapters?.get(channelId);
        if (adapter) {
          try {
            await adapter.sendMessage(threadId, {
              type: "error",
              text: `⚠️ Failed to resume session: ${err instanceof Error ? err.message : String(err)}`,
            });
          } catch { /* best effort */ }
        }
        return null;
      } finally {
        this.resumeLocks.delete(lockKey);
      }
    })();

    this.resumeLocks.set(lockKey, resumePromise);
    return resumePromise;
  }

  async handleNewSession(
    channelId: string,
    agentName?: string,
    workspacePath?: string,
    options?: { createThread?: boolean },
  ): Promise<Session> {
    if (!this.configManager || !this.agentCatalog || !this.createFullSession) {
      throw new Error("SessionFactory not fully initialized");
    }
    const config = this.configManager.get();
    const resolvedAgent = agentName || config.defaultAgent;
    log.info({ channelId, agentName: resolvedAgent }, "New session request");
    const agentDef = this.agentCatalog.resolve(resolvedAgent);
    const resolvedWorkspace = this.configManager.resolveWorkspace(
      workspacePath || agentDef?.workingDirectory,
    );

    return this.createFullSession({
      channelId,
      agentName: resolvedAgent,
      workingDirectory: resolvedWorkspace,
      ...options,
    });
  }

  /** NOTE: handleNewChat is currently dead code — never called outside core.ts itself.
   *  Moving it anyway for completeness; can be removed in a future cleanup. */
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

    // Fallback: look up from store
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
    if (!this.createFullSession) throw new Error("SessionFactory not fully initialized");

    let contextResult: ContextResult | null = null;
    const contextManager = this.getContextManager?.();
    if (contextManager) {
      try {
        contextResult = await contextManager.buildContext(
          params.contextQuery,
          params.contextOptions,
        );
      } catch (err) {
        log.warn({ err }, "Context building failed, proceeding without context");
      }
    }

    const session = await this.createFullSession({
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

  wireSideEffects(session: Session, deps: SideEffectDeps): void {
    // Wire usage tracking via event bus (consumed by usage plugin)
    session.on("agent_event", (event: AgentEvent) => {
      if (event.type !== "usage") return;
      deps.eventBus.emit("usage:recorded", {
        sessionId: session.id,
        agentName: session.agentName,
        timestamp: new Date().toISOString(),
        tokensUsed: event.tokensUsed ?? 0,
        contextSize: event.contextSize ?? 0,
        cost: event.cost,
      });
    });

    // Clean up user tunnels when session ends
    session.on("status_change", (_from, to) => {
      if ((to === "finished" || to === "cancelled") && deps.tunnelService) {
        deps.tunnelService
          .stopBySession(session.id)
          .then((stopped) => {
            for (const entry of stopped) {
              deps.notificationManager
                .notifyAll({
                  sessionId: session.id,
                  sessionName: session.name,
                  type: "completed",
                  summary: `Tunnel stopped: port ${entry.port}${entry.label ? ` (${entry.label})` : ""} — session ended`,
                })
                .catch(() => {});
            }
          })
          .catch(() => {});
      }
    });
  }
}
