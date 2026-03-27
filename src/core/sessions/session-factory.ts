import type { AgentManager } from "../agents/agent-manager.js";
import type { SessionManager } from "./session-manager.js";
import type { SpeechService } from "../../plugins/speech/exports.js";
import type { EventBus } from "../event-bus.js";
import type { NotificationManager } from "../../plugins/notifications/notification.js";
import type { TunnelService } from "../../plugins/tunnel/tunnel-service.js";
import type { AgentEvent } from "../types.js";
import type { MiddlewareChain } from "../plugin/middleware-chain.js";
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

  constructor(
    private agentManager: AgentManager,
    private sessionManager: SessionManager,
    private speechServiceAccessor: SpeechService | (() => SpeechService),
    private eventBus: EventBus,
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
    const agentInstance = createParams.resumeAgentSessionId
      ? await this.agentManager.resume(
          createParams.agentName,
          createParams.workingDirectory,
          createParams.resumeAgentSessionId,
        )
      : await this.agentManager.spawn(
          createParams.agentName,
          createParams.workingDirectory,
        );

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

    // 3. Register in SessionManager
    this.sessionManager.registerSession(session);
    this.eventBus.emit("session:created", {
      sessionId: session.id,
      agent: session.agentName,
      status: session.status,
    });

    return session;
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
