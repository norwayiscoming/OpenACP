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
  }): Promise<Session>
  connectSessionBridge(session: Session): void
  configManager: {
    get(): { defaultAgent: string }
    resolveWorkspace(): string
  }
}

export class AssistantManager {
  private sessions = new Map<string, Session>()
  private readyState = new Map<string, Promise<void>>()
  private respawning = new Set<string>()

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
    })
    session.threadId = threadId
    this.sessions.set(channelId, session)

    // Bridge is already connected by createSession() — no need to call connectSessionBridge().
    // Just enqueue system prompt in background so assistant is ready for user messages.
    const systemPrompt = this.registry.buildSystemPrompt()
    const ready = session
      .enqueuePrompt(systemPrompt)
      .then(() => {
        log.info({ sessionId: session.id, channelId }, 'Assistant ready')
      })
      .catch((err) => {
        log.warn({ err, channelId }, 'Assistant system prompt failed')
      })
    this.readyState.set(channelId, ready)

    return session
  }

  get(channelId: string): Session | null {
    return this.sessions.get(channelId) ?? null
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

  async waitReady(channelId: string): Promise<void> {
    await this.readyState.get(channelId)
  }
}
