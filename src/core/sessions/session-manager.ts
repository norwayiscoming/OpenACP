import type { AgentManager } from "../agents/agent-manager.js";
import { Session } from "./session.js";
import type { SessionStore } from "./session-store.js";
import type { EventBus } from "../event-bus.js";
import type { MiddlewareChain } from "../plugin/middleware-chain.js";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private store: SessionStore | null;
  private eventBus?: EventBus;
  middlewareChain?: MiddlewareChain;

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  constructor(store: SessionStore | null = null) {
    this.store = store;
  }

  async createSession(
    channelId: string,
    agentName: string,
    workingDirectory: string,
    agentManager: AgentManager,
  ): Promise<Session> {
    const agentInstance = await agentManager.spawn(agentName, workingDirectory);
    const session = new Session({
      channelId,
      agentName,
      workingDirectory,
      agentInstance,
    });
    this.sessions.set(session.id, session);
    session.agentSessionId = session.agentInstance.sessionId;

    if (this.store) {
      await this.store.save({
        sessionId: session.id,
        agentSessionId: session.agentInstance.sessionId,
        agentName: session.agentName,
        workingDir: session.workingDirectory,
        channelId,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: new Date().toISOString(),
        name: session.name,
        clientOverrides: {},
        platform: {},
      });
    }

    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByThread(channelId: string, threadId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.channelId === channelId && session.threadId === threadId) {
        return session;
      }
    }
    return undefined;
  }

  getSessionByAgentSessionId(agentSessionId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.agentSessionId === agentSessionId) {
        return session;
      }
    }
    return undefined;
  }

  getRecordByAgentSessionId(
    agentSessionId: string,
  ): import("../types.js").SessionRecord | undefined {
    return this.store?.findByAgentSessionId(agentSessionId);
  }

  getRecordByThread(
    channelId: string,
    threadId: string,
  ): import("../types.js").SessionRecord | undefined {
    return this.store?.findByPlatform(
      channelId,
      (p) => String(p.topicId) === threadId || p.threadId === threadId,
    );
  }

  registerSession(session: Session): void {
    this.sessions.set(session.id, session);
  }

  async patchRecord(
    sessionId: string,
    patch: Partial<import("../types.js").SessionRecord>,
    options?: { immediate?: boolean },
  ): Promise<void> {
    if (!this.store) return;
    const record = this.store.get(sessionId);
    if (record) {
      await this.store.save({ ...record, ...patch });
    } else if (patch.sessionId) {
      // Initial save — treat patch as full record
      await this.store.save(patch as import("../types.js").SessionRecord);
    }
    if (options?.immediate) {
      this.store.flush();
    }
  }

  getSessionRecord(
    sessionId: string,
  ): import("../types.js").SessionRecord | undefined {
    return this.store?.get(sessionId);
  }

  async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        await session.abortPrompt();
      } catch {
        // Agent may already be dead — continue with cleanup
      }
      session.markCancelled();
      this.sessions.delete(sessionId);
    }
    if (this.store) {
      const record = this.store.get(sessionId);
      if (record && record.status !== "cancelled") {
        await this.store.save({ ...record, status: "cancelled" });
      }
    }
    // Hook: session:afterDestroy — read-only, fire-and-forget
    if (this.middlewareChain) {
      this.middlewareChain.execute('session:afterDestroy', { sessionId }, async (p) => p).catch(() => {});
    }
  }

  listSessions(channelId?: string): Session[] {
    const all = Array.from(this.sessions.values());
    if (channelId) return all.filter((s) => s.channelId === channelId);
    return all;
  }

  listRecords(filter?: {
    statuses?: string[];
  }): import("../types.js").SessionRecord[] {
    if (!this.store) return [];
    let records = this.store.list();
    if (filter?.statuses?.length) {
      records = records.filter((r) => filter.statuses!.includes(r.status));
    }
    return records;
  }

  async removeRecord(sessionId: string): Promise<void> {
    if (!this.store) return;
    await this.store.remove(sessionId);
    this.eventBus?.emit("session:deleted", { sessionId });
  }

  /**
   * Graceful shutdown: persist session state without killing agent subprocesses.
   * Agent processes will exit naturally when the parent process terminates.
   */
  async shutdownAll(): Promise<void> {
    if (this.store) {
      for (const session of this.sessions.values()) {
        const record = this.store.get(session.id);
        if (record) {
          await this.store.save({ ...record, status: "finished" });
        }
      }
      this.store.flush();
    }
    this.sessions.clear();
  }

  /**
   * Forcefully destroy all sessions (kill agent subprocesses).
   * Use only when sessions must be fully torn down (e.g. archive).
   */
  async destroyAll(): Promise<void> {
    if (this.store) {
      for (const session of this.sessions.values()) {
        const record = this.store.get(session.id);
        if (record) {
          await this.store.save({ ...record, status: "finished" });
        }
      }
      this.store.flush();
    }
    const sessionIds = [...this.sessions.keys()];
    for (const session of this.sessions.values()) {
      await session.destroy();
    }
    this.sessions.clear();
    // Hook: session:afterDestroy — read-only, fire-and-forget
    if (this.middlewareChain) {
      for (const sessionId of sessionIds) {
        this.middlewareChain.execute('session:afterDestroy', { sessionId }, async (p) => p).catch(() => {});
      }
    }
  }
}
