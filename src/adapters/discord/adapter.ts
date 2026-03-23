import { Client, GatewayIntentBits, MessageFlags, type Guild, type ForumChannel, type TextChannel, type ThreadChannel } from 'discord.js'
import { ChannelAdapter } from '../../core/channel.js'
import type { OutgoingMessage, PermissionRequest, NotificationMessage, AgentCommand, PlanEntry } from '../../core/types.js'
import type { OpenACPCore } from '../../core/core.js'
import type { Session } from '../../core/session.js'
import { log } from '../../core/log.js'
import type { DiscordChannelConfig } from './types.js'
import { DiscordSendQueue } from './send-queue.js'
import { ToolCallTracker } from './tool-call-tracker.js'
import { DraftManager } from './draft-manager.js'
import { ActivityTracker } from './activity.js'
import { SkillCommandManager } from './skill-command-manager.js'
import { PermissionHandler } from './permissions.js'
import {
  ensureForums,
  createSessionThread as forumsCreateThread,
  renameSessionThread as forumsRenameThread,
  deleteSessionThread as forumsDeleteThread,
  ensureUnarchived,
  buildDeepLink,
} from './forums.js'
import {
  registerSlashCommands,
  handleSlashCommand,
  setupButtonCallbacks,
} from './commands/index.js'
import {
  spawnAssistant,
  buildWelcomeMessage,
} from './assistant.js'
import type { Attachment } from '../../core/types.js'
import type { FileService } from '../../core/file-service.js'
import { buildFallbackText, downloadDiscordAttachment, isAttachmentTooLarge } from './media.js'

export class DiscordAdapter extends ChannelAdapter<OpenACPCore> {
  private client: Client
  private discordConfig: DiscordChannelConfig
  private sendQueue: DiscordSendQueue
  private toolTracker: ToolCallTracker
  private draftManager: DraftManager
  private skillManager!: SkillCommandManager
  private permissionHandler!: PermissionHandler
  private sessionTrackers: Map<string, ActivityTracker> = new Map()
  private guild!: Guild
  private forumChannel!: ForumChannel | TextChannel
  private notificationChannel!: TextChannel
  private assistantSession: Session | null = null
  private assistantInitializing = false
  private fileService: FileService

  constructor(core: OpenACPCore, config: DiscordChannelConfig) {
    super(core, config)
    this.discordConfig = config

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    })

    this.sendQueue = new DiscordSendQueue()
    this.toolTracker = new ToolCallTracker(this.sendQueue)
    this.draftManager = new DraftManager(this.sendQueue)
    this.fileService = core.fileService

    // Wire discord.js rate limit events to send queue
    this.client.rest.on('rateLimited', (info) => {
      log.warn({ route: info.route, timeToReset: info.timeToReset }, '[DiscordAdapter] Rate limited')
      this.sendQueue.onRateLimited()
    })
  }

  // ─── start ────────────────────────────────────────────────────────────────

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.once('ready', async () => {
        try {
          log.info({ guildId: this.discordConfig.guildId }, '[DiscordAdapter] Client ready, initializing...')

          // Fetch guild
          const guild = this.client.guilds.cache.get(this.discordConfig.guildId)
            ?? await this.client.guilds.fetch(this.discordConfig.guildId).catch(() => null)
          if (!guild) {
            throw new Error(`Guild not found: ${this.discordConfig.guildId}`)
          }
          this.guild = guild

          // Ensure forum + notification channels exist
          const saveConfig = (updates: Record<string, unknown>) =>
            this.core.configManager.save(updates as Parameters<typeof this.core.configManager.save>[0])
          const { forumChannel, notificationChannel } = await ensureForums(
            guild,
            {
              forumChannelId: this.discordConfig.forumChannelId,
              notificationChannelId: this.discordConfig.notificationChannelId,
            },
            saveConfig,
          )
          this.forumChannel = forumChannel
          this.notificationChannel = notificationChannel

          // Init managers that need guild/guildId
          this.skillManager = new SkillCommandManager(this.sendQueue, this.core.sessionManager)
          this.permissionHandler = new PermissionHandler(
            guild.id,
            (sessionId) => this.core.sessionManager.getSession(sessionId),
            (notification) => this.sendNotification(notification),
          )

          // Register slash commands
          await registerSlashCommands(guild)

          // Wire interaction + message handlers
          this.setupInteractionHandler()
          this.setupMessageHandler()

          // Welcome message
          const welcomeMsg = buildWelcomeMessage(this.core)
          try {
            await this.notificationChannel.send(welcomeMsg)
          } catch (err) {
            log.warn({ err }, '[DiscordAdapter] Failed to send welcome message')
          }

          // Spawn assistant session
          await this.setupAssistant()

          log.info('[DiscordAdapter] Initialization complete')
          resolve()
        } catch (err) {
          log.error({ err }, '[DiscordAdapter] Initialization failed')
          reject(err)
        }
      })

      this.client.login(this.discordConfig.botToken).catch(reject)
    })
  }

  // ─── stop ─────────────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    if (this.assistantSession) {
      try {
        await this.assistantSession.destroy()
      } catch (err) {
        log.warn({ err }, '[DiscordAdapter] Failed to destroy assistant session')
      }
      this.assistantSession = null
    }
    this.client.destroy()
    log.info('[DiscordAdapter] Stopped')
  }

  // ─── Interaction handler ──────────────────────────────────────────────────

  private setupInteractionHandler(): void {
    this.client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await handleSlashCommand(interaction, this)
          return
        }

        if (interaction.isButton()) {
          // Permission buttons take priority
          const handled = await this.permissionHandler.handleButtonInteraction(interaction)
          if (!handled) {
            await setupButtonCallbacks(interaction, this)
          }
        }
      } catch (err) {
        log.error({ err }, '[DiscordAdapter] interactionCreate handler error')
      }
    })
  }

  // ─── Message handler ──────────────────────────────────────────────────────

  private setupMessageHandler(): void {
    this.client.on('messageCreate', async (message) => {
      try {
        // Ignore bots and self
        if (message.author.bot) return

        // Ignore DMs
        if (!message.guild) return

        // Ignore messages from the wrong guild
        if (message.guild.id !== this.guild.id) return

        // Only process messages in threads
        if (!message.channel.isThread()) return

        const threadId = message.channel.id
        const userId = message.author.id
        let text = message.content

        log.debug(
          { threadId, userId, text: text.slice(0, 50), attachmentCount: message.attachments.size },
          '[DiscordAdapter] messageCreate received',
        )

        // Ignore messages with no text and no attachments
        if (!text && message.attachments.size === 0) return

        // Resolve sessionId for file storage (fallback to "unknown" for new sessions)
        const sessionId =
          this.core.sessionManager.getSessionByThread('discord', threadId)?.id ?? 'unknown'

        // Process attachments
        if (message.attachments.size > 0) {
          log.info(
            {
              sessionId,
              attachments: message.attachments.map((a) => ({
                name: a.name, size: a.size, contentType: a.contentType, url: a.url?.slice(0, 80),
              })),
            },
            '[discord-media] Processing incoming attachments',
          )
        }
        const attachments = await this.processIncomingAttachments(message, sessionId)

        // Generate fallback text if message has attachments but no text
        if (!text && attachments.length > 0) {
          text = buildFallbackText(attachments)
        }

        // If all attachment downloads failed and no text, notify user
        if (!text && attachments.length === 0 && message.attachments.size > 0) {
          try {
            await message.reply('Failed to process attachment(s)')
          } catch { /* best effort */ }
          return
        }

        // Route assistant thread messages to assistant
        if (
          this.discordConfig.assistantThreadId &&
          threadId === this.discordConfig.assistantThreadId
        ) {
          if (this.assistantSession && text) {
            await this.assistantSession.enqueuePrompt(text, attachments.length > 0 ? attachments : undefined)
          }
          return
        }

        // Route to core for session dispatch
        await this.core.handleMessage({
          channelId: 'discord',
          threadId,
          userId,
          text,
          ...(attachments.length > 0 ? { attachments } : {}),
        })
      } catch (err) {
        log.error({ err }, '[DiscordAdapter] messageCreate handler error')
      }
    })
  }

  // ─── Assistant ────────────────────────────────────────────────────────────

  private async setupAssistant(): Promise<void> {
    let threadId = this.discordConfig.assistantThreadId

    // Verify existing thread is still accessible
    if (threadId) {
      try {
        const existing = this.guild.channels.cache.get(threadId)
          ?? await this.guild.channels.fetch(threadId)
        if (existing && existing.isThread()) {
          await ensureUnarchived(existing as import('discord.js').ThreadChannel)
          log.info({ threadId }, '[DiscordAdapter] Reusing existing assistant thread')
        } else {
          log.warn({ threadId }, '[DiscordAdapter] Assistant thread not found, recreating...')
          threadId = null
        }
      } catch {
        log.warn({ threadId }, '[DiscordAdapter] Assistant thread inaccessible, recreating...')
        threadId = null
      }
    }

    if (!threadId) {
      // Create a new thread for the assistant
      const thread = await forumsCreateThread(this.forumChannel, 'Assistant')
      threadId = thread.id
      await this.core.configManager.save({
        channels: { discord: { assistantThreadId: thread.id } },
      } as Parameters<typeof this.core.configManager.save>[0])
      log.info({ threadId }, '[DiscordAdapter] Created assistant thread')
    }

    this.assistantInitializing = true
    try {
      const { session, ready } = await spawnAssistant(this.core, threadId)
      this.assistantSession = session
      ready.finally(() => {
        this.assistantInitializing = false
      })
    } catch (err) {
      this.assistantInitializing = false
      log.error({ err }, '[DiscordAdapter] Failed to spawn assistant')
    }
  }

  async respawnAssistant(): Promise<void> {
    if (this.assistantSession) {
      try {
        await this.assistantSession.destroy()
      } catch { /* ignore */ }
      this.assistantSession = null
    }
    await this.setupAssistant()
  }

  // ─── Incoming media ──────────────────────────────────────────────────

  private async processIncomingAttachments(
    message: import('discord.js').Message,
    sessionId: string,
  ): Promise<Attachment[]> {
    if (message.attachments.size === 0) return []

    const isVoiceMessage = message.flags.has(MessageFlags.IsVoiceMessage)

    const results = await Promise.allSettled(
      message.attachments.map(async (discordAtt) => {
        const buffer = await downloadDiscordAttachment(
          discordAtt.url,
          discordAtt.name ?? 'attachment',
        )
        if (!buffer) return null

        let data = buffer
        let fileName = discordAtt.name ?? 'attachment'
        let mimeType = discordAtt.contentType ?? 'application/octet-stream'

        // Convert voice messages from OGG Opus to WAV
        if (isVoiceMessage && mimeType.includes('ogg')) {
          try {
            data = await this.fileService.convertOggToWav(buffer)
            fileName = 'voice.wav'
            mimeType = 'audio/wav'
          } catch (err) {
            log.warn({ err }, '[discord-media] OGG→WAV conversion failed, saving original')
          }
        }

        return this.fileService.saveFile(sessionId, fileName, data, mimeType)
      }),
    )

    const rejected = results.filter((r) => r.status === 'rejected')
    if (rejected.length > 0) {
      log.warn({ rejected: rejected.map((r) => (r as PromiseRejectedResult).reason) }, '[discord-media] Some attachments failed')
    }

    const saved = results
      .filter((r): r is PromiseFulfilledResult<Attachment | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((att): att is Attachment => att !== null)

    log.info({ count: saved.length, files: saved.map((a) => a.fileName) }, '[discord-media] Attachments processed')
    return saved
  }

  // ─── Helper: resolve thread ───────────────────────────────────────────────

  private async getThread(sessionId: string): Promise<ThreadChannel | null> {
    const session = this.core.sessionManager.getSession(sessionId)
    const threadId = session?.threadId
    if (!threadId) {
      log.warn({ sessionId }, '[DiscordAdapter] No threadId for session')
      return null
    }
    try {
      const channel = this.guild.channels.cache.get(threadId)
        ?? await this.guild.channels.fetch(threadId)
      if (channel && channel.isThread()) return channel as ThreadChannel
      log.warn({ sessionId, threadId }, '[DiscordAdapter] Channel is not a thread')
      return null
    } catch (err) {
      log.warn({ err, sessionId, threadId }, '[DiscordAdapter] Failed to fetch thread')
      return null
    }
  }

  // ─── sendMessage ──────────────────────────────────────────────────────────

  async sendMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
    // Suppress output while assistant is initializing its system prompt
    if (
      this.assistantInitializing &&
      this.assistantSession &&
      sessionId === this.assistantSession.id
    ) {
      return
    }

    const thread = await this.getThread(sessionId)
    if (!thread) return

    await ensureUnarchived(thread)

    const isAssistant =
      this.assistantSession != null && sessionId === this.assistantSession.id

    // Get or create activity tracker for this session
    if (!this.sessionTrackers.has(sessionId)) {
      this.sessionTrackers.set(sessionId, new ActivityTracker(thread, this.sendQueue))
    }
    const tracker = this.sessionTrackers.get(sessionId)!

    switch (content.type) {
      case 'thought': {
        await tracker.onThought()
        break
      }

      case 'text': {
        await tracker.onTextStart()
        const draft = this.draftManager.getOrCreate(sessionId, thread)
        draft.append(content.text)
        this.draftManager.appendText(sessionId, content.text)
        break
      }

      case 'tool_call': {
        await tracker.onToolCall()
        await this.draftManager.finalize(sessionId, thread, isAssistant)
        const meta = content.metadata ?? {}
        await this.toolTracker.trackNewCall(sessionId, thread, {
          id: String(meta.id ?? ''),
          name: content.text || String(meta.name ?? 'Tool'),
          kind: meta.kind as string | undefined,
          status: String(meta.status ?? 'running'),
          content: meta.content,
          viewerLinks: meta.viewerLinks as { file?: string; diff?: string } | undefined,
          viewerFilePath: meta.viewerFilePath as string | undefined,
        })
        break
      }

      case 'tool_update': {
        const meta = content.metadata ?? {}
        await this.toolTracker.updateCall(sessionId, {
          id: String(meta.id ?? ''),
          name: content.text || String(meta.name ?? ''),
          kind: meta.kind as string | undefined,
          status: String(meta.status ?? 'completed'),
          content: meta.content,
          viewerLinks: meta.viewerLinks as { file?: string; diff?: string } | undefined,
          viewerFilePath: meta.viewerFilePath as string | undefined,
        })
        break
      }

      case 'plan': {
        const entries = (content.metadata?.entries ?? []) as PlanEntry[]
        await tracker.onPlan(entries)
        break
      }

      case 'usage': {
        await this.draftManager.finalize(sessionId, thread, isAssistant)
        const meta = content.metadata ?? {}
        await tracker.sendUsage({
          tokensUsed: meta.tokensUsed as number | undefined,
          contextSize: meta.contextSize as number | undefined,
        })
        // Send usage notification to notification channel
        try {
          const deepLink = buildDeepLink(this.guild.id, thread.id)
          await this.sendNotification({
            sessionId,
            type: 'completed',
            summary: content.text || 'Session completed',
            deepLink,
          })
        } catch { /* best effort */ }
        break
      }

      case 'session_end': {
        await this.draftManager.finalize(sessionId, thread, isAssistant)
        await tracker.cleanup()
        this.toolTracker.cleanup(sessionId)
        this.sessionTrackers.delete(sessionId)
        await this.skillManager.cleanup(sessionId)
        try {
          await this.sendQueue.enqueue(
            () => thread.send({ content: '✅ Done' }),
            { type: 'other' },
          )
        } catch { /* best effort */ }
        break
      }

      case 'error': {
        await this.draftManager.finalize(sessionId, thread, isAssistant)
        await tracker.cleanup()
        this.toolTracker.cleanup(sessionId)
        this.sessionTrackers.delete(sessionId)
        try {
          await this.sendQueue.enqueue(
            () => thread.send({ content: `❌ Error: ${content.text}` }),
            { type: 'other' },
          )
        } catch { /* best effort */ }
        break
      }

      case 'attachment': {
        if (!content.attachment) break
        const { attachment } = content
        await this.draftManager.finalize(sessionId, thread, isAssistant)

        // Discord free tier limit: 25MB
        if (isAttachmentTooLarge(attachment.size)) {
          log.warn({ sessionId, fileName: attachment.fileName, size: attachment.size }, '[discord-media] File too large (>25MB)')
          try {
            await this.sendQueue.enqueue(
              () => thread.send({ content: `⚠️ File too large to send (${Math.round(attachment.size / 1024 / 1024)}MB): ${attachment.fileName}` }),
              { type: 'other' },
            )
          } catch { /* best effort */ }
          break
        }

        try {
          await this.sendQueue.enqueue(
            () => thread.send({ files: [{ attachment: attachment.filePath, name: attachment.fileName }] }),
            { type: 'other' },
          )
        } catch (err) {
          log.error({ err, sessionId, fileName: attachment.fileName }, '[discord-media] Failed to send attachment')
        }
        break
      }
    }
  }

  // ─── sendPermissionRequest ────────────────────────────────────────────────

  async sendPermissionRequest(sessionId: string, request: PermissionRequest): Promise<void> {
    const session = this.core.sessionManager.getSession(sessionId)
    if (!session) {
      log.warn({ sessionId }, '[DiscordAdapter] sendPermissionRequest: session not found')
      return
    }

    // Auto-approve if request is from openacp internals or dangerous mode is enabled
    const autoApprove =
      request.description.toLowerCase().includes('openacp') ||
      session.dangerousMode

    if (autoApprove) {
      const allowOption = request.options.find((o) => o.isAllow)
      if (allowOption && session.permissionGate.requestId === request.id) {
        session.permissionGate.resolve(allowOption.id)
      }
      return
    }

    const thread = await this.getThread(sessionId)
    if (!thread) return

    await this.permissionHandler.sendPermissionRequest(session, request, thread)
  }

  // ─── sendNotification ─────────────────────────────────────────────────────

  async sendNotification(notification: NotificationMessage): Promise<void> {
    if (!this.notificationChannel) return

    const typeIcon: Record<string, string> = {
      completed: '✅',
      error: '❌',
      permission: '🔐',
      input_required: '💬',
    }

    const icon = typeIcon[notification.type] ?? 'ℹ️'
    const name = notification.sessionName ? ` **${notification.sessionName}**` : ''
    let text = `${icon}${name}: ${notification.summary}`
    if (notification.deepLink) {
      text += `\n${notification.deepLink}`
    }

    try {
      await this.sendQueue.enqueue(
        () => this.notificationChannel.send({ content: text }),
        { type: 'other' },
      )
    } catch (err) {
      log.warn({ err }, '[DiscordAdapter] Failed to send notification')
    }
  }

  // ─── createSessionThread ─────────────────────────────────────────────────

  async createSessionThread(sessionId: string, name: string): Promise<string> {
    const thread = await forumsCreateThread(this.forumChannel, name)

    // Persist threadId on session record
    const session = this.core.sessionManager.getSession(sessionId)
    if (session) {
      session.threadId = thread.id
    }

    const record = this.core.sessionManager.getSessionRecord(sessionId)
    if (record) {
      await this.core.sessionManager.patchRecord(sessionId, {
        platform: { ...record.platform, threadId: thread.id },
      })
    }

    return thread.id
  }

  // ─── renameSessionThread ──────────────────────────────────────────────────

  async renameSessionThread(sessionId: string, newName: string): Promise<void> {
    const session = this.core.sessionManager.getSession(sessionId)
    const threadId = session?.threadId
    if (!threadId) return
    await forumsRenameThread(this.guild, threadId, newName)
  }

  // ─── deleteSessionThread ──────────────────────────────────────────────────

  override async deleteSessionThread(sessionId: string): Promise<void> {
    const session = this.core.sessionManager.getSession(sessionId)
    const threadId = session?.threadId
    if (!threadId) return
    await forumsDeleteThread(this.guild, threadId)
  }

  // ─── sendSkillCommands ────────────────────────────────────────────────────

  override async sendSkillCommands(sessionId: string, commands: AgentCommand[]): Promise<void> {
    const thread = await this.getThread(sessionId)
    if (!thread) return
    await this.skillManager.send(sessionId, thread, commands)
  }

  // ─── cleanupSkillCommands ─────────────────────────────────────────────────

  override async cleanupSkillCommands(sessionId: string): Promise<void> {
    await this.skillManager.cleanup(sessionId)
  }

  // ─── Public helpers (for slash commands) ─────────────────────────────────

  getForumChannel(): ForumChannel | TextChannel {
    return this.forumChannel
  }

  getGuild(): Guild {
    return this.guild
  }

  getGuildId(): string {
    return this.guild.id
  }

  getAssistantSessionId(): string | null {
    return this.assistantSession?.id ?? null
  }

  getAssistantThreadId(): string | null {
    return this.discordConfig.assistantThreadId
  }
}
