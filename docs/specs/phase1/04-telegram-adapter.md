# Phase 1 — Telegram Adapter

**Package**: `packages/adapters/telegram/`
**Library**: grammy

## Topic Structure

```
Telegram Supergroup (Forum enabled)
  ├── 📋 Notifications           → auto-created, aggregated noti + deep links
  ├── 🤖 Assistant               → auto-created, AI help & session creation
  ├── [Session] Fix login bug    → session topic
  ├── [Session] Write API tests  → session topic
  └── ...
```

### Auto-Created Topics

On first start, if `notificationTopicId` or `assistantTopicId` is null in config:
1. Create topic via `bot.api.createForumTopic(chatId, name, { icon_custom_emoji_id })`
2. Save topic ID back to config via `configManager.save()`

### Assistant Topic

- Spawn 1 AgentInstance (defaultAgent) on startup, keep alive
- System prompt teaches the assistant about OpenACP:
  - Available agents and their capabilities
  - How to create sessions, workspaces
  - Commands reference
  - Permission flow explanation
- User chats naturally → agent responds with help, suggestions, actions
- When user wants to create a session → agent confirms → core executes → sends link to new topic

## TelegramAdapter Class

```typescript
class TelegramAdapter extends ChannelAdapter {
  private bot: Bot
  private toolCallMessages: Map<string, Map<string, number>> = new Map()  // sessionId → (toolCallId → messageId)
  private sessionDrafts: Map<string, MessageDraft> = new Map()  // sessionId → active draft
  private assistantSession: Session | null = null
  private pendingPermissions: Map<string, (optionId: string) => void> = new Map()

  async start(): Promise<void> {
    this.bot = new Bot(this.config.botToken)
    this.setupMiddleware()
    this.setupRoutes()
    this.setupCommands()
    this.setupCallbackQueries()
    await this.ensureTopics()
    await this.spawnAssistant()
    await this.bot.start()
  }

  async stop(): Promise<void> {
    await this.bot.stop()
    if (this.assistantSession) {
      await this.assistantSession.destroy()
    }
  }
}
```

## Bot Setup & Routing

```typescript
private setupMiddleware(): void {
  // Only accept messages from configured chatId
  this.bot.use((ctx, next) => {
    if (ctx.chat?.id !== this.config.chatId) return
    return next()
  })
}

private setupRoutes(): void {
  this.bot.on('message:text', async (ctx) => {
    const threadId = ctx.message.message_thread_id

    // General topic or no thread → redirect to assistant topic
    if (!threadId) {
      return this.redirectToAssistant(ctx)
    }

    // Notification topic → ignore text messages
    if (threadId === this.config.notificationTopicId) return

    // Assistant topic → forward to assistant session
    if (threadId === this.config.assistantTopicId) {
      return this.handleAssistantMessage(ctx)
    }

    // Session topic → forward to core
    const message: IncomingMessage = {
      channelId: 'telegram',
      threadId: String(threadId),
      userId: String(ctx.from.id),
      text: ctx.message.text,
    }
    await this.core.handleMessage(message)
  })
}
```

## Commands

```typescript
private setupCommands(): void {
  this.bot.command('new', async (ctx) => {
    const args = ctx.match.split(' ').filter(Boolean)
    const agentName = args[0]  // optional
    const workspace = args[1]  // optional

    try {
      const session = await this.core.handleNewSession('telegram', agentName, workspace)

      // Create topic for this session
      const topicName = `🔄 ${session.agentName} — New Session`
      const threadId = await this.createSessionThread(session.id, topicName)
      session.threadId = threadId

      // Send confirmation in new topic
      await this.bot.api.sendMessage(this.config.chatId,
        `✅ Session started\n` +
        `<b>Agent:</b> ${session.agentName}\n` +
        `<b>Workspace:</b> <code>${session.workingDirectory}</code>`,
        {
          message_thread_id: Number(threadId),
          parse_mode: 'HTML',
        }
      )
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`)
    }
  })

  this.bot.command('newchat', async (ctx) => {
    const threadId = ctx.message.message_thread_id
    if (!threadId) {
      return ctx.reply('Use /newchat inside a session topic to inherit its config.')
    }

    const session = await this.core.handleNewChat('telegram', String(threadId))
    if (!session) {
      return ctx.reply('No active session in this topic.')
    }

    const topicName = `🔄 ${session.agentName} — New Chat`
    const newThreadId = await this.createSessionThread(session.id, topicName)
    session.threadId = newThreadId

    await this.bot.api.sendMessage(this.config.chatId,
      `✅ New chat (same agent & workspace)\n` +
      `<b>Agent:</b> ${session.agentName}\n` +
      `<b>Workspace:</b> <code>${session.workingDirectory}</code>`,
      {
        message_thread_id: Number(newThreadId),
        parse_mode: 'HTML',
      }
    )
  })

  this.bot.command('cancel', async (ctx) => {
    const threadId = ctx.message.message_thread_id
    if (!threadId) return
    const session = this.core.sessionManager.getSessionByThread('telegram', String(threadId))
    if (session) {
      await session.cancel()
      await ctx.reply('⛔ Session cancelled.')
    }
  })

  this.bot.command('status', async (ctx) => {
    const threadId = ctx.message.message_thread_id
    if (threadId) {
      // Status of current session
      const session = this.core.sessionManager.getSessionByThread('telegram', String(threadId))
      if (session) {
        await ctx.reply(
          `<b>Session:</b> ${session.name || session.id}\n` +
          `<b>Agent:</b> ${session.agentName}\n` +
          `<b>Status:</b> ${session.status}\n` +
          `<b>Workspace:</b> <code>${session.workingDirectory}</code>\n` +
          `<b>Queue:</b> ${session.promptQueue.length} pending`,
          { parse_mode: 'HTML' }
        )
      }
    } else {
      // Global status
      const sessions = this.core.sessionManager.listSessions('telegram')
      const active = sessions.filter(s => s.status === 'active')
      await ctx.reply(
        `<b>OpenACP Status</b>\n` +
        `Active sessions: ${active.length}\n` +
        `Total sessions: ${sessions.length}`,
        { parse_mode: 'HTML' }
      )
    }
  })

  this.bot.command('agents', async (ctx) => {
    const agents = this.core.agentManager.getAvailableAgents()
    const defaultAgent = this.core.configManager.get().defaultAgent
    const lines = agents.map(a =>
      `• <b>${a.name}</b>${a.name === defaultAgent ? ' (default)' : ''}\n  <code>${a.command} ${a.args.join(' ')}</code>`
    )
    await ctx.reply(`<b>Available Agents:</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' })
  })

  this.bot.command('help', async (ctx) => {
    await ctx.reply(
      `<b>OpenACP Commands:</b>\n\n` +
      `/new [agent] [workspace] — Create new session\n` +
      `/newchat — New chat, same agent & workspace\n` +
      `/cancel — Cancel current session\n` +
      `/status — Show session/system status\n` +
      `/agents — List available agents\n` +
      `/help — Show this help\n\n` +
      `Or just chat in the 🤖 Assistant topic for help!`,
      { parse_mode: 'HTML' }
    )
  })
}
```

## Message Streaming

```typescript
// MessageDraft — accumulates text, sends/edits with throttle
class MessageDraft {
  private messageId?: number
  private buffer: string = ''
  private lastFlush: number = 0
  private flushTimer?: NodeJS.Timeout
  private minInterval = 1000  // 1 sec

  constructor(
    private bot: Bot,
    private chatId: number,
    private threadId: number,
    private parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
  ) {}

  append(text: string): void {
    this.buffer += text
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    const now = Date.now()
    const elapsed = now - this.lastFlush

    if (elapsed >= this.minInterval) {
      this.flush()
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined
        this.flush()
      }, this.minInterval - elapsed)
    }
  }

  private async flush(): Promise<void> {
    this.lastFlush = Date.now()
    const html = markdownToTelegramHtml(this.buffer)

    try {
      if (!this.messageId) {
        const msg = await this.bot.api.sendMessage(this.chatId, html, {
          message_thread_id: this.threadId,
          parse_mode: this.parseMode,
          disable_notification: true,
        })
        this.messageId = msg.message_id
      } else {
        await this.bot.api.editMessageText(this.chatId, this.messageId, html, {
          parse_mode: this.parseMode,
        })
      }
    } catch {
      // Edit failed — try sending new message
      if (this.messageId) {
        const msg = await this.bot.api.sendMessage(this.chatId, html, {
          message_thread_id: this.threadId,
          parse_mode: this.parseMode,
          disable_notification: true,
        })
        this.messageId = msg.message_id
      }
    }
  }

  async finalize(): Promise<number | undefined> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    await this.flush()
    return this.messageId
  }

  getMessageId(): number | undefined {
    return this.messageId
  }
}
```

## ChannelAdapter Methods

```typescript
// Send agent output to session topic
async sendMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
  const session = this.core.sessionManager.getSession(sessionId)
  if (!session) return
  const threadId = Number(session.threadId)

  switch (content.type) {
    case 'text':
    case 'thought': {
      // Get or create draft for this session
      let draft = this.sessionDrafts.get(sessionId)
      if (!draft) {
        draft = new MessageDraft(this.bot, this.config.chatId, threadId)
        this.sessionDrafts.set(sessionId, draft)
      }
      const prefix = content.type === 'thought' ? '💭 ' : ''
      draft.append(prefix + content.text)
      break
    }

    case 'tool_call': {
      // Finalize any pending text draft first
      await this.finalizeDraft(sessionId)
      // Send tool call as new message
      const msg = await this.bot.api.sendMessage(this.config.chatId,
        formatToolCall(content.metadata as any),
        { message_thread_id: threadId, parse_mode: 'HTML', disable_notification: true }
      )
      if (!this.toolCallMessages.has(sessionId)) {
        this.toolCallMessages.set(sessionId, new Map())
      }
      this.toolCallMessages.get(sessionId)!.set(content.metadata?.id as string, msg.message_id)
      break
    }

    case 'tool_update': {
      const msgId = this.toolCallMessages.get(sessionId)?.get(content.metadata?.id as string)
      if (msgId) {
        try {
          await this.bot.api.editMessageText(this.config.chatId, msgId,
            formatToolUpdate(content.metadata as any),
            { parse_mode: 'HTML' }
          )
        } catch { /* edit failed, ignore */ }
      }
      break
    }

    case 'plan': {
      await this.finalizeDraft(sessionId)
      await this.bot.api.sendMessage(this.config.chatId,
        formatPlan(content.metadata as any),
        { message_thread_id: threadId, parse_mode: 'HTML', disable_notification: true }
      )
      break
    }

    case 'session_end': {
      await this.finalizeDraft(sessionId)
      this.sessionDrafts.delete(sessionId)
      this.toolCallMessages.delete(sessionId)  // cleanup only this session's tool messages
      await this.bot.api.sendMessage(this.config.chatId,
        `✅ <b>Done</b>`,
        { message_thread_id: threadId, parse_mode: 'HTML', disable_notification: true }
      )
      break
    }

    case 'error': {
      await this.finalizeDraft(sessionId)
      await this.bot.api.sendMessage(this.config.chatId,
        `❌ <b>Error:</b> ${escapeHtml(content.text)}`,
        { message_thread_id: threadId, parse_mode: 'HTML', disable_notification: true }
      )
      break
    }
  }
}

private async finalizeDraft(sessionId: string): Promise<void> {
  const draft = this.sessionDrafts.get(sessionId)
  if (draft) {
    await draft.finalize()
    this.sessionDrafts.delete(sessionId)
  }
}
```

## Permission Request (Inline Keyboard)

```typescript
async sendPermissionRequest(sessionId: string, request: PermissionRequest): Promise<void> {
  const session = this.core.sessionManager.getSession(sessionId)
  if (!session) return
  const threadId = Number(session.threadId)

  // Finalize any pending draft
  await this.finalizeDraft(sessionId)

  // Build inline keyboard
  // Note: Telegram callback_data has 64-byte limit.
  // Use short lookup key instead of full IDs.
  const callbackKey = nanoid(8)
  this.pendingPermissions.set(callbackKey, { sessionId, requestId: request.id })

  const keyboard = new InlineKeyboard()
  for (const option of request.options) {
    const emoji = option.isAllow ? '✅' : '❌'
    keyboard.text(`${emoji} ${option.label}`, `p:${callbackKey}:${option.id}`)
  }

  // Send in session topic WITH notification
  const msg = await this.bot.api.sendMessage(this.config.chatId,
    `🔐 <b>Permission request:</b>\n\n${escapeHtml(request.description)}`,
    {
      message_thread_id: threadId,
      parse_mode: 'HTML',
      reply_markup: keyboard,
      disable_notification: false,  // HAS notification
    }
  )

  // Deep link to this message
  const deepLink = `https://t.me/c/${String(this.config.chatId).replace('-100', '')}/${msg.message_id}`

  // Also notify in notification topic
  await this.sendNotification({
    sessionId,
    sessionName: session.name,
    type: 'permission',
    summary: request.description,
    deepLink,
  })
}

// Handle button callback
private setupCallbackQueries(): void {
  this.bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data

    if (data.startsWith('p:')) {
      const [_, callbackKey, optionId] = data.split(':')
      const pending = this.pendingPermissions.get(callbackKey)
      if (!pending) return

      const session = this.core.sessionManager.getSession(pending.sessionId)
      if (session?.pendingPermission?.requestId === pending.requestId) {
        session.pendingPermission.resolve(optionId)
        session.pendingPermission = undefined
      }
      this.pendingPermissions.delete(callbackKey)

      await ctx.answerCallbackQuery({ text: '✅ Responded' })

      // Remove buttons from message
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined })
      } catch { /* ignore */ }
    }
  })
}
```

## Notification Topic

```typescript
async sendNotification(notification: NotificationMessage): Promise<void> {
  if (!this.config.notificationTopicId) return

  const emoji = {
    completed: '✅',
    error: '❌',
    permission: '🔐',
    input_required: '💬',
  }[notification.type]

  let text = `${emoji} <b>${escapeHtml(notification.sessionName || notification.sessionId)}</b>\n`
  text += escapeHtml(notification.summary)

  if (notification.deepLink) {
    text += `\n\n<a href="${notification.deepLink}">→ Go to message</a>`
  }

  await this.bot.api.sendMessage(this.config.chatId, text, {
    message_thread_id: this.config.notificationTopicId,
    parse_mode: 'HTML',
    disable_notification: false,  // HAS notification
  })
}
```

## Session Thread Management

```typescript
async createSessionThread(sessionId: string, name: string): Promise<string> {
  const topic = await this.bot.api.createForumTopic(this.config.chatId, name)
  return String(topic.message_thread_id)
}

async renameSessionThread(sessionId: string, newName: string): Promise<void> {
  const session = this.core.sessionManager.getSession(sessionId)
  if (!session) return
  try {
    await this.bot.api.editForumTopic(this.config.chatId, Number(session.threadId), {
      name: newName,
    })
  } catch { /* ignore rename failures */ }
}
```

## Assistant Topic

```typescript
private async spawnAssistant(): Promise<void> {
  const config = this.core.configManager.get()

  // Create assistant session using default agent
  this.assistantSession = await this.core.sessionManager.createSession(
    'telegram',
    config.defaultAgent,
    this.core.configManager.resolveWorkspace(),
    this.core.agentManager,
  )
  this.assistantSession.threadId = String(this.config.assistantTopicId)

  // Wire events to assistant topic
  this.core.wireSessionEvents(this.assistantSession, this)

  // Send system prompt as first message
  await this.assistantSession.enqueuePrompt(this.buildAssistantSystemPrompt(config))
}

private buildAssistantSystemPrompt(config: Config): string {
  const agentNames = Object.keys(config.agents).join(', ')
  return `You are the OpenACP Assistant. Help users manage their AI coding sessions.

Available agents: ${agentNames}
Default agent: ${config.defaultAgent}
Workspace base: ${config.workspace.baseDir}

When a user wants to create a session, guide them through:
1. Which agent to use
2. Which workspace/project
3. Confirm and create

Commands reference:
- /new [agent] [workspace] — Create new session
- /newchat — New chat with same agent & workspace
- /cancel — Cancel current session
- /status — Show status
- /agents — List agents
- /help — Show help

Be concise and helpful. When the user confirms session creation, tell them you'll create it now.`
}

private async handleAssistantMessage(ctx: Context): Promise<void> {
  if (!this.assistantSession) return
  await this.assistantSession.enqueuePrompt(ctx.message!.text!)
}

private async redirectToAssistant(ctx: Context): Promise<void> {
  if (!this.config.assistantTopicId) return
  const link = `https://t.me/c/${String(this.config.chatId).replace('-100', '')}/${this.config.assistantTopicId}`
  await ctx.reply(
    `💬 Please use the <a href="${link}">🤖 Assistant</a> topic to chat with OpenACP.`,
    { parse_mode: 'HTML' }
  )
}
```

## Formatting Utilities

```typescript
// packages/adapters/telegram/src/formatting.ts

function markdownToTelegramHtml(md: string): string {
  let html = md
  // Bold: **text** → <b>text</b>
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  // Italic: *text* → <i>text</i>
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>')
  // Inline code: `code` → <code>code</code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Code blocks: ```lang\ncode\n``` → <pre><code class="language-lang">code</code></pre>
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`)
  // Links: [text](url) → <a href="url">text</a>
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  // Escape remaining special chars in non-tagged text
  return html
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatToolCall(tool: { id: string; name: string; kind?: string; status: string }): string {
  const statusIcon = {
    pending: '⏳',
    in_progress: '⏳',
    completed: '✅',
    failed: '❌',
  }[tool.status] || '🔧'

  const kindIcon = {
    read: '📄', edit: '✏️', delete: '🗑️', execute: '⚡',
    search: '🔍', fetch: '🌐', think: '💭',
  }[tool.kind || ''] || '🔧'

  return `${kindIcon} ${statusIcon} <b>${escapeHtml(tool.name)}</b>`
}

function formatToolUpdate(update: { id: string; status: string; content?: unknown }): string {
  const statusIcon = {
    pending: '⏳',
    in_progress: '⏳',
    completed: '✅',
    failed: '❌',
  }[update.status] || '🔧'

  let text = `${statusIcon} <b>Tool ${update.status}</b>`
  if (update.content) {
    text += `\n<pre>${escapeHtml(String(update.content))}</pre>`
  }
  return text
}

function formatPlan(plan: { entries: Array<{ content: string; status: string }> }): string {
  const statusIcon = { pending: '⬜', in_progress: '🔄', completed: '✅' }
  const lines = plan.entries.map((e, i) =>
    `${statusIcon[e.status] || '⬜'} ${i + 1}. ${escapeHtml(e.content)}`
  )
  return `<b>Plan:</b>\n${lines.join('\n')}`
}

function splitMessage(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }
    let splitAt = remaining.lastIndexOf('\n\n', maxLength)
    if (splitAt === -1 || splitAt < maxLength * 0.5) {
      splitAt = remaining.lastIndexOf('\n', maxLength)
    }
    if (splitAt === -1 || splitAt < maxLength * 0.5) {
      splitAt = maxLength
    }
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }
  return chunks
}
```
