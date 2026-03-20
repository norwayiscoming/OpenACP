import type { AgentManager } from "./agent-manager.js";
import { Session } from "./session.js";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

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

  async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) await session.cancel();
  }

  listSessions(channelId?: string): Session[] {
    const all = Array.from(this.sessions.values());
    if (channelId) return all.filter((s) => s.channelId === channelId);
    return all;
  }

  async destroyAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.destroy();
    }
    this.sessions.clear();
  }
}
