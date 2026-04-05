import type { Session } from '../sessions/session.js'
import type { AssistantRegistry } from './assistant-registry.js'
import type { SessionStore } from '../sessions/session-store.js'
import { createChildLogger } from '../utils/log.js'

const log = createChildLogger({ module: 'assistant-manager' })

interface AssistantManagerCore {
  createSession(params: {
    channelId: string
    agentName: string
    workingDirectory: string
    initialName?: string
    isAssistant?: boolean
    threadId?: string
    existingSessionId?: string
  }): Promise<Session>
  connectSessionBridge(session: Session): void
  configManager: {
    get(): { defaultAgent: string }
    resolveWorkspace(): string
  }
  sessionStore: SessionStore | null
}

export class AssistantManager {
  private sessions = new Map<string, Session>()
  private pendingSystemPrompts = new Map<string, string>()

  constructor(
    private core: AssistantManagerCore,
    private registry: AssistantRegistry,
  ) {}

  async getOrSpawn(channelId: string, threadId: string): Promise<Session> {
    const existing = this.core.sessionStore?.findAssistant(channelId)
    const session = await this.core.createSession({
      channelId,
      agentName: this.core.configManager.get().defaultAgent,
      workingDirectory: this.core.configManager.resolveWorkspace(),
      initialName: 'Assistant',
      isAssistant: true,
      threadId,
      existingSessionId: existing?.sessionId,
    })
    this.sessions.set(channelId, session)

    const systemPrompt = this.registry.buildSystemPrompt(channelId)
    this.pendingSystemPrompts.set(channelId, systemPrompt)
    log.info(
      { sessionId: session.id, channelId, reused: !!existing },
      existing ? 'Assistant session reused (system prompt deferred)' : 'Assistant spawned (system prompt deferred)',
    )

    return session
  }

  get(channelId: string): Session | null {
    return this.sessions.get(channelId) ?? null
  }

  /**
   * Consume and return any pending system prompt for a channel.
   * Should be prepended to the first real user message.
   */
  consumePendingSystemPrompt(channelId: string): string | undefined {
    const prompt = this.pendingSystemPrompts.get(channelId)
    if (prompt) this.pendingSystemPrompts.delete(channelId)
    return prompt
  }

  isAssistant(sessionId: string): boolean {
    for (const s of this.sessions.values()) {
      if (s.id === sessionId) return true
    }
    return false
  }
}
