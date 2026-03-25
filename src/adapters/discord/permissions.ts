import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'
import type { ButtonInteraction, TextChannel, ThreadChannel } from 'discord.js'
import { nanoid } from 'nanoid'
import type { PermissionRequest, NotificationMessage } from '../../core/types.js'
import type { Session } from '../../core/session.js'
import { log } from '../../core/log.js'
import { buildDeepLink } from './forums.js'

interface PendingPermission {
  sessionId: string
  requestId: string
  options: { id: string; isAllow: boolean }[]
  guildId: string
  channelId: string
  messageId?: string
}

export class PermissionHandler {
  private pending: Map<string, PendingPermission> = new Map()

  constructor(
    private guildId: string,
    private getSession: (sessionId: string) => Session | undefined,
    private sendNotification: (notification: NotificationMessage) => Promise<void>,
  ) {}

  async sendPermissionRequest(
    session: Session,
    request: PermissionRequest,
    thread: TextChannel | ThreadChannel,
  ): Promise<void> {
    // Short callback key (Discord 100-char customId limit)
    const callbackKey = nanoid(8)
    this.pending.set(callbackKey, {
      sessionId: session.id,
      requestId: request.id,
      options: request.options.map((o) => ({ id: o.id, isAllow: o.isAllow })),
      guildId: this.guildId,
      channelId: thread.id,
    })

    // Build action row with buttons
    const row = new ActionRowBuilder<ButtonBuilder>()
    for (const option of request.options) {
      const emoji = option.isAllow ? '✅' : '❌'
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`p:${callbackKey}:${option.id}`)
          .setLabel(`${emoji} ${option.label}`)
          .setStyle(option.isAllow ? ButtonStyle.Success : ButtonStyle.Danger),
      )
    }

    // Send permission message in session thread
    let messageId: string | undefined
    try {
      const msg = await thread.send({
        content: `🔐 **Permission request:**\n\n${request.description}`,
        components: [row],
      })
      messageId = msg.id
      // Store messageId for deep link
      const pendingEntry = this.pending.get(callbackKey)
      if (pendingEntry) pendingEntry.messageId = messageId
    } catch (err) {
      log.warn({ err, sessionId: session.id }, '[PermissionHandler] Failed to send permission request')
      return
    }

    // Build deep link for notification
    const deepLink = buildDeepLink(this.guildId, thread.id, messageId)

    // Fire-and-forget notification to avoid sendQueue deadlock
    void this.sendNotification({
      sessionId: session.id,
      sessionName: session.name,
      type: 'permission',
      summary: request.description,
      deepLink,
    })
  }

  async handleButtonInteraction(interaction: ButtonInteraction): Promise<boolean> {
    const data = interaction.customId
    if (!data.startsWith('p:')) return false

    const parts = data.split(':')
    if (parts.length < 3) return false

    const [, callbackKey, optionId] = parts

    const pending = this.pending.get(callbackKey)
    if (!pending) {
      try {
        await interaction.reply({ content: '❌ Permission request expired', ephemeral: true })
      } catch { /* ignore */ }
      return true
    }

    const session = this.getSession(pending.sessionId)
    const option = pending.options.find((o) => o.id === optionId)
    const isAllow = option?.isAllow ?? false

    log.info(
      { requestId: pending.requestId, optionId, isAllow },
      '[PermissionHandler] Permission responded',
    )

    if (session?.permissionGate.requestId === pending.requestId) {
      session.permissionGate.resolve(optionId)
    }

    this.pending.delete(callbackKey)

    try {
      await interaction.reply({ content: '✅ Responded', ephemeral: true })
    } catch { /* ignore */ }

    // Remove buttons from the original message
    try {
      await interaction.message.edit({ components: [] })
    } catch { /* ignore */ }

    return true
  }
}
