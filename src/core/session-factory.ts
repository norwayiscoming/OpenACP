import { nanoid } from "nanoid";
import type { AgentManager } from "./agent-manager.js";
import type { SessionManager } from "./session-manager.js";
import type { SpeechService } from "./speech/index.js";
import type { EventBus } from "./event-bus.js";
import type { UsageStore } from "./usage-store.js";
import type { UsageBudget } from "./usage-budget.js";
import type { NotificationManager } from "./notification.js";
import type { TunnelService } from "../tunnel/tunnel-service.js";
import type { AgentEvent, UsageRecord } from "./types.js";
import { Session } from "./session.js";
import { createChildLogger } from "./log.js";

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
  usageStore?: UsageStore | null;
  usageBudget?: UsageBudget | null;
  notificationManager: NotificationManager;
  tunnelService?: TunnelService;
}

export class SessionFactory {
  constructor(
    private agentManager: AgentManager,
    private sessionManager: SessionManager,
    private speechService: SpeechService,
    private eventBus: EventBus,
  ) {}

  async create(params: SessionCreateParams): Promise<Session> {
    // 1. Spawn or resume agent
    const agentInstance = params.resumeAgentSessionId
      ? await this.agentManager.resume(
          params.agentName,
          params.workingDirectory,
          params.resumeAgentSessionId,
        )
      : await this.agentManager.spawn(
          params.agentName,
          params.workingDirectory,
        );

    // 2. Create Session instance
    const session = new Session({
      id: params.existingSessionId,
      channelId: params.channelId,
      agentName: params.agentName,
      workingDirectory: params.workingDirectory,
      agentInstance,
      speechService: this.speechService,
    });
    session.agentSessionId = agentInstance.sessionId;
    if (params.initialName) {
      session.name = params.initialName;
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
    // Wire usage tracking
    if (deps.usageStore) {
      const usageStore = deps.usageStore;
      const usageBudget = deps.usageBudget;
      const notificationManager = deps.notificationManager;

      session.on("agent_event", (event: AgentEvent) => {
        if (event.type !== "usage") return;
        const record: UsageRecord = {
          id: nanoid(),
          sessionId: session.id,
          agentName: session.agentName,
          tokensUsed: event.tokensUsed ?? 0,
          contextSize: event.contextSize ?? 0,
          cost: event.cost,
          timestamp: new Date().toISOString(),
        };
        usageStore.append(record);

        if (usageBudget) {
          const result = usageBudget.check();
          if (result.message) {
            notificationManager.notifyAll({
              sessionId: session.id,
              sessionName: session.name,
              type: "budget_warning",
              summary: result.message,
            });
          }
        }
      });
    }

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
