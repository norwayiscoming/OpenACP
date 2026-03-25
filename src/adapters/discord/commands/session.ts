import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import type { Session } from '../../../core/session.js'
import { log } from '../../../core/log.js'
import { deleteSessionThread } from '../forums.js'
import type { DiscordAdapter } from '../adapter.js'

const STATUS_EMOJI: Record<string, string> = {
  active: '🟢',
  initializing: '🟡',
  finished: '✅',
  error: '❌',
  cancelled: '⛔',
}

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  initializing: 1,
  error: 2,
  finished: 3,
  cancelled: 4,
}

export async function handleCancel(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  const channelId = interaction.channelId
  const session = adapter.core.sessionManager.getSessionByThread('discord', channelId)

  if (session) {
    log.info({ sessionId: session.id }, '[discord-session] Cancel command')
    await session.abortPrompt()
    await interaction.editReply('⛔ Session cancelled.')
    return
  }

  // Fallback: cancel from store when session not in memory
  const record = adapter.core.sessionManager.getRecordByThread('discord', channelId)
  if (record && record.status !== 'cancelled' && record.status !== 'error') {
    log.info({ sessionId: record.sessionId }, '[discord-session] Cancel command (from store)')
    await adapter.core.sessionManager.cancelSession(record.sessionId)
    await interaction.editReply('⛔ Session cancelled.')
    return
  }

  await interaction.editReply('No active session in this channel.')
}

export async function handleStatus(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  const channelId = interaction.channelId
  const session = adapter.core.sessionManager.getSessionByThread('discord', channelId)

  if (session) {
    await interaction.editReply(
      `**Session:** ${session.name || session.id}\n` +
      `**Agent:** ${session.agentName}\n` +
      `**Status:** ${session.status}\n` +
      `**Workspace:** \`${session.workingDirectory}\`\n` +
      `**Queue:** ${session.queueDepth} pending`,
    )
    return
  }

  // Try stored record
  const record = adapter.core.sessionManager.getRecordByThread('discord', channelId)
  if (record) {
    await interaction.editReply(
      `**Session:** ${record.name || record.sessionId}\n` +
      `**Agent:** ${record.agentName}\n` +
      `**Status:** ${record.status} (not loaded)\n` +
      `**Workspace:** \`${record.workingDir}\``,
    )
    return
  }

  // Global status
  const sessions = adapter.core.sessionManager.listSessions('discord')
  const active = sessions.filter(
    (s: Session) => s.status === 'active' || s.status === 'initializing',
  )
  await interaction.editReply(
    `**OpenACP Status**\n` +
    `Active sessions: ${active.length}\n` +
    `Total sessions: ${sessions.length}`,
  )
}

export async function handleSessions(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  try {
    const allRecords = adapter.core.sessionManager.listRecords()

    // Only show sessions that have a Discord thread
    const records = allRecords.filter((r: any) => {
      const platform = r.platform as { topicId?: string | number }
      return !!platform?.topicId
    })
    const headlessCount = allRecords.length - records.length

    if (records.length === 0) {
      const extra = headlessCount > 0 ? ` (${headlessCount} headless hidden)` : ''
      await interaction.editReply(`No sessions found.${extra}`)
      return
    }

    records.sort(
      (a: any, b: any) => (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5),
    )

    const MAX_DISPLAY = 25
    const displayed = records.slice(0, MAX_DISPLAY)

    const lines = displayed.map((r: any) => {
      const emoji = STATUS_EMOJI[r.status] || '⚪'
      const name = r.name?.trim() || `${r.agentName} session`
      return `${emoji} **${name}** \`[${r.status}]\``
    })

    const header =
      `**Sessions: ${records.length}**` +
      (headlessCount > 0 ? ` (${headlessCount} headless hidden)` : '')
    const truncated =
      records.length > MAX_DISPLAY
        ? `\n\n*...and ${records.length - MAX_DISPLAY} more*`
        : ''

    // Cleanup buttons
    const finishedCount = allRecords.filter((r: any) => r.status === 'finished').length
    const errorCount = allRecords.filter(
      (r: any) => r.status === 'error' || r.status === 'cancelled',
    ).length

    const rows: ActionRowBuilder<ButtonBuilder>[] = []

    if (finishedCount + errorCount > 0) {
      const cleanupRow = new ActionRowBuilder<ButtonBuilder>()
      if (finishedCount > 0) {
        cleanupRow.addComponents(
          new ButtonBuilder()
            .setCustomId('m:cleanup:finished')
            .setLabel(`Cleanup finished (${finishedCount})`)
            .setStyle(ButtonStyle.Secondary),
        )
      }
      if (errorCount > 0) {
        cleanupRow.addComponents(
          new ButtonBuilder()
            .setCustomId('m:cleanup:errors')
            .setLabel(`Cleanup errors (${errorCount})`)
            .setStyle(ButtonStyle.Secondary),
        )
      }
      rows.push(cleanupRow)

      const cleanupAllRow = new ActionRowBuilder<ButtonBuilder>()
      cleanupAllRow.addComponents(
        new ButtonBuilder()
          .setCustomId('m:cleanup:all')
          .setLabel(`Cleanup all non-active (${finishedCount + errorCount})`)
          .setStyle(ButtonStyle.Secondary),
      )
      rows.push(cleanupAllRow)
    }

    await interaction.editReply({
      content: `${header}\n\n${lines.join('\n')}${truncated}`,
      components: rows,
    })
  } catch (err) {
    log.error({ err }, '[discord-session] handleSessions error')
    await interaction.editReply('❌ Failed to list sessions.').catch(() => {})
  }
}

export async function handleHandoff(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  const channelId = interaction.channelId
  const session = adapter.core.sessionManager.getSessionByThread('discord', channelId)

  if (!session) {
    const record = adapter.core.sessionManager.getRecordByThread('discord', channelId)
    if (!record) {
      await interaction.editReply('No session found in this channel.')
      return
    }
    const cmd = `openacp agents run ${record.agentName} --resume ${record.agentSessionId} -- --continue`
    await interaction.editReply(
      `**Resume in terminal:**\n\`\`\`\n${cmd}\n\`\`\`\n\n*Run this from your project directory:* \`${record.workingDir}\``,
    )
    return
  }

  const cmd = `openacp agents run ${session.agentName} --resume ${session.agentSessionId} -- --continue`
  await interaction.editReply(
    `**Resume in terminal:**\n\`\`\`\n${cmd}\n\`\`\`\n\n*Run this from your project directory:* \`${session.workingDirectory}\``,
  )
}

export async function executeCancelSession(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const sessions: Session[] = adapter.core.sessionManager
    .listSessions('discord')
    .filter((s: Session) => s.status === 'active')
    .sort((a: Session, b: Session) => b.createdAt.getTime() - a.createdAt.getTime())

  const session = sessions[0]
  if (!session) {
    await interaction.reply({ content: 'No active sessions to cancel.', ephemeral: true })
    return
  }

  await session.abortPrompt()
  await interaction.reply({ content: `⛔ Cancelled session: **${session.name || session.id}**`, ephemeral: true })
}

export async function handleCleanupButton(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const { customId } = interaction

  switch (customId) {
    case 'm:cleanup:all':
      await interaction.deferReply({ ephemeral: true })
      await runCleanup(interaction, adapter, ['finished', 'error', 'cancelled'])
      break

    case 'm:cleanup:finished':
      await interaction.deferReply({ ephemeral: true })
      await runCleanup(interaction, adapter, ['finished'])
      break

    case 'm:cleanup:errors':
      await interaction.deferReply({ ephemeral: true })
      await runCleanup(interaction, adapter, ['error', 'cancelled'])
      break

    case 'm:cleanup:confirm':
      await interaction.deferReply({ ephemeral: true })
      await runCleanup(interaction, adapter, ['finished', 'error', 'cancelled', 'active', 'initializing'])
      break

    case 'm:cleanup:cancel':
      try { await interaction.update({ components: [] }) } catch { /* ignore */ }
      break

    default:
      // Unknown cleanup variant — ignore
      try { await interaction.reply({ content: 'Unknown cleanup action.', ephemeral: true }) } catch { /* ignore */ }
  }
}

async function runCleanup(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
  statuses: string[],
): Promise<void> {
  const allRecords = adapter.core.sessionManager.listRecords()
  const cleanable = allRecords.filter((r: any) => statuses.includes(r.status))

  if (cleanable.length === 0) {
    await interaction.editReply('Nothing to clean up.')
    return
  }

  let deleted = 0
  let failed = 0

  for (const record of cleanable) {
    try {
      // Cancel active sessions first
      if (record.status === 'active' || record.status === 'initializing') {
        try {
          await adapter.core.sessionManager.cancelSession(record.sessionId)
        } catch (err) {
          log.warn({ err, sessionId: record.sessionId }, '[discord-session] Failed to cancel session during cleanup')
        }
      }

      const platform = record.platform as { topicId?: string | number; threadId?: string } | undefined
      const threadId = platform?.threadId ?? (platform?.topicId != null ? String(platform.topicId) : undefined)
      if (threadId) {
        try {
          await deleteSessionThread(adapter.getGuild(), threadId)
        } catch (err) {
          log.warn({ err, sessionId: record.sessionId, threadId }, '[discord-session] Failed to delete thread during cleanup')
        }
      }
      await adapter.core.sessionManager.removeRecord(record.sessionId)
      deleted++
    } catch (err) {
      log.error({ err, sessionId: record.sessionId }, '[discord-session] Failed to cleanup session')
      failed++
    }
  }

  await interaction.editReply(
    `🗑 Cleaned up **${deleted}** sessions${failed > 0 ? ` (${failed} failed)` : ''}.`,
  )
}
