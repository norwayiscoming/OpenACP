import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import { log } from '../../../core/log.js'

// TODO: Replace `any` with DiscordAdapter once Task 12 is implemented

export function buildDangerousModeKeyboard(
  sessionId: string,
  isDangerous: boolean,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`d:${sessionId}`)
      .setLabel(isDangerous ? '🔐 Disable Dangerous Mode' : '☠️ Enable Dangerous Mode')
      .setStyle(isDangerous ? ButtonStyle.Secondary : ButtonStyle.Danger),
  )
}

export async function handleDangerous(
  interaction: ChatInputCommandInteraction,
  adapter: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  const channelId = interaction.channelId
  const session = adapter.core.sessionManager.getSessionByThread('discord', channelId)

  if (session) {
    session.dangerousMode = !session.dangerousMode
    adapter.core.sessionManager.patchRecord(session.id, { dangerousMode: session.dangerousMode }).catch(() => {})
    log.info({ sessionId: session.id, dangerousMode: session.dangerousMode }, '[discord-admin] Dangerous mode toggled via command')

    const msg = session.dangerousMode
      ? '☠️ **Dangerous mode enabled** — All permission requests will be auto-approved.'
      : '🔐 **Dangerous mode disabled** — Permission requests will be shown normally.'
    await interaction.editReply(msg)
    return
  }

  // Session not in memory — update store directly
  const record = adapter.core.sessionManager.getRecordByThread('discord', channelId)
  if (!record || record.status === 'cancelled' || record.status === 'error') {
    await interaction.editReply('⚠️ No active session in this channel.')
    return
  }

  const newDangerousMode = !(record.dangerousMode ?? false)
  adapter.core.sessionManager.patchRecord(record.sessionId, { dangerousMode: newDangerousMode }).catch(() => {})
  log.info({ sessionId: record.sessionId, dangerousMode: newDangerousMode }, '[discord-admin] Dangerous mode toggled via command (store-only)')

  const msg = newDangerousMode
    ? '☠️ **Dangerous mode enabled** — All permission requests will be auto-approved.'
    : '🔐 **Dangerous mode disabled** — Permission requests will be shown normally.'
  await interaction.editReply(msg)
}

export async function handleDangerousButton(
  interaction: ButtonInteraction,
  adapter: any,
): Promise<void> {
  const sessionId = interaction.customId.slice(2) // strip 'd:'
  const session = adapter.core.sessionManager.getSession(sessionId)

  // Session live in memory — toggle directly
  if (session) {
    session.dangerousMode = !session.dangerousMode
    adapter.core.sessionManager.patchRecord(sessionId, { dangerousMode: session.dangerousMode }).catch(() => {})
    log.info({ sessionId, dangerousMode: session.dangerousMode }, '[discord-admin] Dangerous mode toggled via button')

    const toastText = session.dangerousMode
      ? '☠️ Dangerous mode enabled — permissions auto-approved'
      : '🔐 Dangerous mode disabled — permissions shown normally'

    try {
      await interaction.update({
        components: [buildDangerousModeKeyboard(sessionId, session.dangerousMode)],
      })
    } catch { /* ignore */ }

    try { await interaction.followUp({ content: toastText, ephemeral: true }) } catch { /* ignore */ }
    return
  }

  // Session not in memory — toggle in store
  const record = adapter.core.sessionManager.getSessionRecord(sessionId)
  if (!record || record.status === 'cancelled' || record.status === 'error') {
    await interaction.reply({ content: '⚠️ Session not found or already ended.', ephemeral: true })
    return
  }

  const newDangerousMode = !(record.dangerousMode ?? false)
  adapter.core.sessionManager.patchRecord(sessionId, { dangerousMode: newDangerousMode }).catch(() => {})
  log.info({ sessionId, dangerousMode: newDangerousMode }, '[discord-admin] Dangerous mode toggled via button (store-only)')

  const toastText = newDangerousMode
    ? '☠️ Dangerous mode enabled — permissions auto-approved'
    : '🔐 Dangerous mode disabled — permissions shown normally'

  try {
    await interaction.update({
      components: [buildDangerousModeKeyboard(sessionId, newDangerousMode)],
    })
  } catch { /* ignore */ }

  try { await interaction.followUp({ content: toastText, ephemeral: true }) } catch { /* ignore */ }
}

export async function handleRestart(
  interaction: ChatInputCommandInteraction,
  adapter: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  if (!adapter.core.requestRestart) {
    await interaction.editReply('⚠️ Restart is not available (no restart handler registered).')
    return
  }

  await interaction.editReply('🔄 **Restarting OpenACP...**\nRebuilding and restarting. Be back shortly.')
  await new Promise((r) => setTimeout(r, 500))
  await adapter.core.requestRestart()
}

export async function handleUpdate(
  interaction: ChatInputCommandInteraction,
  adapter: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })
  // Stub: not implemented yet
  await interaction.editReply('⚠️ Update via Discord is not implemented yet. Run `npm install -g @openacp/cli@latest` in your terminal, then use `/restart`.')
}
