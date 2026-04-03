import type { Session } from '../sessions/session.js'
import type { AssistantRegistry } from './assistant-registry.js'
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
  }): Promise<Session>
  connectSessionBridge(session: Session): void
  configManager: {
    get(): { defaultAgent: string }
    resolveWorkspace(): string
  }
}

export class AssistantManager {
  private sessions = new Map<string, Session>()
  private respawning = new Set<string>()
  private pendingSystemPrompts = new Map<string, string>()

  constructor(
    private core: AssistantManagerCore,
    private registry: AssistantRegistry,
  ) {}

  async spawn(channelId: string, threadId: string): Promise<Session> {
    const session = await this.core.createSession({
      channelId,
      agentName: this.core.configManager.get().defaultAgent,
      workingDirectory: this.core.configManager.resolveWorkspace(),
      initialName: 'Assistant',
      isAssistant: true,
      threadId,
    })
    this.sessions.set(channelId, session)

    // Store system prompt for lazy initialization — it will be prepended
    // to the first real user message so no unsolicited AI response is sent on startup.
    const systemPrompt = this.registry.buildSystemPrompt(channelId)
    this.pendingSystemPrompts.set(channelId, systemPrompt)
    log.info({ sessionId: session.id, channelId }, 'Assistant spawned (system prompt deferred)')

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

  async respawn(channelId: string, threadId: string): Promise<Session> {
    if (this.respawning.has(channelId)) {
      return this.sessions.get(channelId)!
    }
    this.respawning.add(channelId)
    try {
      const old = this.sessions.get(channelId)
      if (old) await old.destroy()
      return await this.spawn(channelId, threadId)
    } finally {
      this.respawning.delete(channelId)
    }
  }

}
