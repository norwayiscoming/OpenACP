# Phase 1 — Core Modules

## Types (packages/core/src/types.ts)

```typescript
// Incoming message from channel to core
interface IncomingMessage {
  channelId: string
  threadId: string
  userId: string
  text: string
}

// Outgoing message from core to channel
interface OutgoingMessage {
  type: 'text' | 'thought' | 'tool_call' | 'tool_update' | 'plan' | 'usage' | 'session_end' | 'error'
  text: string
  metadata?: Record<string, unknown>
}

// Permission request forwarded from agent
interface PermissionRequest {
  id: string
  description: string
  options: PermissionOption[]
}

interface PermissionOption {
  id: string
  label: string
  isAllow: boolean
}

// Notification sent to notification topic
interface NotificationMessage {
  sessionId: string
  sessionName?: string
  type: 'completed' | 'error' | 'permission' | 'input_required'
  summary: string
  deepLink?: string
}

// Agent events (converted from ACP SessionUpdate)
type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'thought'; content: string }
  | { type: 'tool_call'; id: string; name: string; kind?: string; status: string; content?: unknown; locations?: unknown }
  | { type: 'tool_update'; id: string; status: string; content?: unknown; locations?: unknown }
  | { type: 'plan'; entries: PlanEntry[] }
  | { type: 'usage'; tokensUsed?: number; contextSize?: number; cost?: { amount: number; currency: string } }
  | { type: 'commands_update'; commands: unknown[] }
  | { type: 'session_end'; reason: string }
  | { type: 'error'; message: string }

interface PlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}

// Agent definition from config
interface AgentDefinition {
  name: string
  command: string
  args: string[]
  workingDirectory?: string
  env?: Record<string, string>
}

// Session status
type SessionStatus = 'initializing' | 'active' | 'cancelled' | 'finished' | 'error'

// Session ID: nanoid(12), URL-safe
```

## ChannelAdapter (packages/core/src/channel.ts)

```typescript
abstract class ChannelAdapter {
  constructor(protected core: OpenACPCore, protected config: ChannelConfig) {}

  // Lifecycle
  abstract start(): Promise<void>
  abstract stop(): Promise<void>

  // Outgoing: core → channel
  abstract sendMessage(sessionId: string, content: OutgoingMessage): Promise<void>
  abstract sendPermissionRequest(sessionId: string, request: PermissionRequest): Promise<void>
  abstract sendNotification(notification: NotificationMessage): Promise<void>

  // Session lifecycle on channel side
  abstract createSessionThread(sessionId: string, name: string): Promise<string>  // returns threadId
  abstract renameSessionThread(sessionId: string, newName: string): Promise<void>
}
```

## ConfigManager (packages/core/src/config.ts)

### Config Schema (Zod)

```typescript
const ConfigSchema = z.object({
  channels: z.object({
    telegram: z.object({
      enabled: z.boolean().default(false),
      botToken: z.string(),
      chatId: z.number(),
      notificationTopicId: z.number().nullable().default(null),
      assistantTopicId: z.number().nullable().default(null),
    }).optional(),
  }),

  agents: z.record(z.string(), z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
    workingDirectory: z.string().optional(),
    env: z.record(z.string(), z.string()).default({}),
  })),

  defaultAgent: z.string(),

  workspace: z.object({
    baseDir: z.string().default('~/openacp-workspace'),
  }).default({}),

  security: z.object({
    allowedUserIds: z.array(z.string()).default([]),
    maxConcurrentSessions: z.number().default(5),
    sessionTimeoutMinutes: z.number().default(60),
  }).default({}),
})

type Config = z.infer<typeof ConfigSchema>
```

### ConfigManager Class

```typescript
class ConfigManager {
  private config: Config
  private configPath: string  // default: ~/.openacp/config.json

  async load(): Promise<void>
    // 1. Resolve path (env OPENACP_CONFIG_PATH or default)
    // 2. Read JSON file
    // 3. Apply env var overrides
    // 4. Validate with Zod
    // 5. Store config

  get(): Config
    // Return current config

  async save(updates: Partial<Config>): Promise<void>
    // Merge updates, validate, write to file
    // Used for auto-saving topicIds after creation

  resolveWorkspace(input?: string): string
    // See Workspace Resolution below
}
```

### Workspace Resolution

```typescript
resolveWorkspace(input?: string): string {
  if (!input) {
    // No workspace specified → use default agent workingDirectory or baseDir
    return expandHome(this.config.workspace.baseDir)
  }

  // Check if absolute path (starts with / or ~)
  if (input.startsWith('/') || input.startsWith('~')) {
    const resolved = expandHome(input)
    fs.mkdirSync(resolved, { recursive: true })
    return resolved
  }

  // Treat as workspace name → lowercase, under baseDir
  const name = input.toLowerCase()
  const resolved = path.join(expandHome(this.config.workspace.baseDir), name)
  fs.mkdirSync(resolved, { recursive: true })
  return resolved
}
```

## SessionManager (packages/core/src/session.ts)

### Session Class

```typescript
class Session {
  id: string                    // nanoid(12)
  channelId: string
  threadId: string
  agentName: string
  workingDirectory: string
  agentInstance: AgentInstance
  status: SessionStatus
  name?: string
  promptQueue: string[]
  promptRunning: boolean
  createdAt: Date
  pendingPermission?: { requestId: string; resolve: (optionId: string) => void }

  // Enqueue prompt (with queue support)
  async enqueuePrompt(text: string): Promise<void> {
    if (this.promptRunning) {
      this.promptQueue.push(text)
      // Adapter shows "⏳ Queued" in topic
      return
    }
    await this.runPrompt(text)
  }

  // Run prompt and process queue
  private async runPrompt(text: string): Promise<void> {
    this.promptRunning = true
    this.status = 'active'

    try {
      const response = await this.agentInstance.prompt(text)
      // Events stream via agentInstance.onSessionUpdate during this await

      // Auto-name after first user prompt (not the summary prompt)
      if (!this.name) {
        await this.autoName()
      }
    } catch (err) {
      this.status = 'error'
    } finally {
      this.promptRunning = false

      // Process next queued prompt
      if (this.promptQueue.length > 0) {
        const next = this.promptQueue.shift()!
        await this.runPrompt(next)
      }
    }
  }

  // Auto-name via agent
  // NOTE: This injects a summary prompt into the agent's conversation history.
  // Known Phase 1 limitation — the agent sees this prompt in its context.
  // Future improvement: use session_info_update if agent provides titles,
  // or use forkSession to isolate the naming prompt.
  private async autoName(): Promise<void> {
    let title = ''
    const prevHandler = this.agentInstance.onSessionUpdate
    this.agentInstance.onSessionUpdate = (event) => {
      if (event.type === 'text') title += event.content
    }

    try {
      await this.agentInstance.prompt(
        'Summarize this conversation in max 5 words for a topic title. Reply ONLY with the title, nothing else.'
      )
      this.name = title.trim().slice(0, 50)
    } catch {
      this.name = `Session ${this.id.slice(0, 6)}`
    } finally {
      this.agentInstance.onSessionUpdate = prevHandler
    }
  }

  async cancel(): Promise<void> {
    this.status = 'cancelled'
    await this.agentInstance.cancel()
  }

  async destroy(): Promise<void> {
    await this.agentInstance.destroy()
  }
}
```

### SessionManager Class

```typescript
class SessionManager {
  private sessions: Map<string, Session> = new Map()

  async createSession(
    channelId: string,
    agentName: string,
    workingDirectory: string,
    agentManager: AgentManager
  ): Promise<Session> {
    const id = nanoid(12)
    const agentInstance = await agentManager.spawn(agentName, workingDirectory)
    const session = new Session({ id, channelId, agentName, workingDirectory, agentInstance })
    this.sessions.set(id, session)
    return session
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)
  }

  getSessionByThread(channelId: string, threadId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.channelId === channelId && session.threadId === threadId) {
        return session
      }
    }
    return undefined
  }

  async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) await session.cancel()
  }

  listSessions(channelId?: string): Session[] {
    const all = Array.from(this.sessions.values())
    if (channelId) return all.filter(s => s.channelId === channelId)
    return all
  }

  async destroyAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.destroy()
    }
    this.sessions.clear()
  }
}
```

## AgentManager (packages/core/src/agent.ts)

```typescript
class AgentManager {
  constructor(private config: Config) {}

  getAvailableAgents(): AgentDefinition[] {
    return Object.entries(this.config.agents).map(([name, cfg]) => ({
      name,
      command: cfg.command,
      args: cfg.args,
      workingDirectory: cfg.workingDirectory,
      env: cfg.env,
    }))
  }

  getAgent(name: string): AgentDefinition | undefined {
    const cfg = this.config.agents[name]
    if (!cfg) return undefined
    return { name, ...cfg }
  }

  async spawn(agentName: string, workingDirectory: string): Promise<AgentInstance> {
    const agentDef = this.getAgent(agentName)
    if (!agentDef) throw new Error(`Agent "${agentName}" not found in config`)
    return AgentInstance.spawn(agentDef, workingDirectory)
  }
}
```

## NotificationManager (packages/core/src/notification.ts)

```typescript
class NotificationManager {
  constructor(private adapters: Map<string, ChannelAdapter>) {}

  async notify(channelId: string, notification: NotificationMessage): Promise<void> {
    const adapter = this.adapters.get(channelId)
    if (adapter) {
      await adapter.sendNotification(notification)
    }
  }

  async notifyAll(notification: NotificationMessage): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.sendNotification(notification)
    }
  }
}
```

## OpenACPCore (packages/core/src/core.ts)

```typescript
class OpenACPCore {
  configManager: ConfigManager
  agentManager: AgentManager
  sessionManager: SessionManager
  notificationManager: NotificationManager
  adapters: Map<string, ChannelAdapter> = new Map()

  constructor(configManager: ConfigManager) {
    this.configManager = configManager
    const config = configManager.get()
    this.agentManager = new AgentManager(config)
    this.sessionManager = new SessionManager()
    this.notificationManager = new NotificationManager(this.adapters)
  }

  registerAdapter(name: string, adapter: ChannelAdapter): void {
    this.adapters.set(name, adapter)
  }

  async start(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.start()
    }
  }

  async stop(): Promise<void> {
    // 1. Notify users
    await this.notificationManager.notifyAll({
      sessionId: 'system',
      type: 'error',
      summary: 'OpenACP is shutting down',
    })

    // 2. Destroy all sessions (kills agent subprocesses)
    await this.sessionManager.destroyAll()

    // 3. Stop adapters
    for (const adapter of this.adapters.values()) {
      await adapter.stop()
    }
  }

  // Inbound: adapter forwards user message here
  async handleMessage(message: IncomingMessage): Promise<void> {
    // Security check
    const config = this.configManager.get()
    if (config.security.allowedUserIds.length > 0) {
      if (!config.security.allowedUserIds.includes(message.userId)) return
    }

    // Concurrent session limit
    const activeSessions = this.sessionManager.listSessions()
      .filter(s => s.status === 'active' || s.status === 'initializing')
    if (activeSessions.length >= config.security.maxConcurrentSessions) {
      const adapter = this.adapters.get(message.channelId)
      await adapter?.sendMessage('system', {
        type: 'error',
        text: `Max concurrent sessions (${config.security.maxConcurrentSessions}) reached. Cancel a session first.`,
      })
      return
    }

    // Find session by thread
    const session = this.sessionManager.getSessionByThread(message.channelId, message.threadId)
    if (!session) return  // No session in this thread

    // Forward to session
    await session.enqueuePrompt(message.text)
  }

  // Inbound: adapter forwards permission response here
  async handlePermissionResponse(sessionId: string, optionId: string): Promise<void> {
    // This is handled inside AgentInstance via the onPermissionRequest callback
    // The adapter resolves the pending promise with the optionId
  }

  // Handle /new command
  async handleNewSession(
    channelId: string,
    agentName?: string,
    workspacePath?: string,
  ): Promise<Session> {
    const config = this.configManager.get()
    const resolvedAgent = agentName || config.defaultAgent
    const resolvedWorkspace = this.configManager.resolveWorkspace(
      workspacePath || config.agents[resolvedAgent]?.workingDirectory
    )

    const session = await this.sessionManager.createSession(
      channelId, resolvedAgent, resolvedWorkspace, this.agentManager
    )

    // Wire event handlers
    const adapter = this.adapters.get(channelId)!
    this.wireSessionEvents(session, adapter)

    return session
  }

  // Handle /newchat command (inherit from current session)
  async handleNewChat(
    channelId: string,
    currentThreadId: string,
  ): Promise<Session | null> {
    const currentSession = this.sessionManager.getSessionByThread(channelId, currentThreadId)
    if (!currentSession) return null

    return this.handleNewSession(
      channelId,
      currentSession.agentName,
      currentSession.workingDirectory,
    )
  }

  // Convert AgentEvent to OutgoingMessage
  private toOutgoingMessage(event: AgentEvent): OutgoingMessage {
    switch (event.type) {
      case 'text':
        return { type: 'text', text: event.content }
      case 'thought':
        return { type: 'thought', text: event.content }
      case 'tool_call':
        return { type: 'tool_call', text: event.name, metadata: { id: event.id, kind: event.kind, status: event.status, content: event.content, locations: event.locations } }
      case 'tool_update':
        return { type: 'tool_update', text: '', metadata: { id: event.id, status: event.status, content: event.content } }
      case 'plan':
        return { type: 'plan', text: '', metadata: { entries: event.entries } }
      case 'usage':
        return { type: 'usage', text: '', metadata: { tokensUsed: event.tokensUsed, cost: event.cost } }
      default:
        return { type: 'text', text: '' }
    }
  }

  // Wire agent events to channel adapter (public — adapters call this for assistant session)
  wireSessionEvents(session: Session, adapter: ChannelAdapter): void {
    session.agentInstance.onSessionUpdate = (event: AgentEvent) => {
      switch (event.type) {
        case 'text':
        case 'thought':
        case 'tool_call':
        case 'tool_update':
        case 'plan':
        case 'usage':
          adapter.sendMessage(session.id, this.toOutgoingMessage(event))
          break

        case 'session_end':
          session.status = 'finished'
          adapter.sendMessage(session.id, { type: 'session_end', text: `Done (${event.reason})` })
          this.notificationManager.notify(session.channelId, {
            sessionId: session.id,
            sessionName: session.name,
            type: 'completed',
            summary: `Session "${session.name || session.id}" completed`,
          })
          break

        case 'error':
          adapter.sendMessage(session.id, { type: 'error', text: event.message })
          this.notificationManager.notify(session.channelId, {
            sessionId: session.id,
            sessionName: session.name,
            type: 'error',
            summary: event.message,
          })
          break
      }
    }

    session.agentInstance.onPermissionRequest = async (request: PermissionRequest) => {
      // Send permission UI to session topic
      await adapter.sendPermissionRequest(session.id, request)

      // Send notification with deep link
      await this.notificationManager.notify(session.channelId, {
        sessionId: session.id,
        sessionName: session.name,
        type: 'permission',
        summary: request.description,
      })

      // Wait for user response (adapter resolves this promise)
      return new Promise<string>((resolve) => {
        session.pendingPermission = { requestId: request.id, resolve }
      })
    }
  }
}
```
