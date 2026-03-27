import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import { DoctorEngine } from '../../../core/doctor/index.js'
import type { DoctorReport, PendingFix } from '../../../core/doctor/types.js'
import { log } from '../../../core/utils/log.js'
import type { DiscordAdapter } from '../adapter.js'

// In-memory store of pending fixes keyed by "guildId:channelId:messageId"
const pendingFixesStore = new Map<string, PendingFix[]>()

function renderReport(report: DoctorReport): {
  content: string
  components: ActionRowBuilder<ButtonBuilder>[]
} {
  const icons = { pass: '✅', warn: '⚠️', fail: '❌' }
  const lines: string[] = ['🩺 **OpenACP Doctor**\n']

  for (const category of report.categories) {
    lines.push(`**${category.name}**`)
    for (const result of category.results) {
      lines.push(`  ${icons[result.status]} ${result.message}`)
    }
    lines.push('')
  }

  const { passed, warnings, failed, fixed } = report.summary
  const fixedStr = fixed > 0 ? `, ${fixed} fixed` : ''
  lines.push(`**Result:** ${passed} passed, ${warnings} warnings, ${failed} failed${fixedStr}`)

  const components: ActionRowBuilder<ButtonBuilder>[] = []

  if (report.pendingFixes.length > 0) {
    const row = new ActionRowBuilder<ButtonBuilder>()
    for (let i = 0; i < Math.min(report.pendingFixes.length, 5); i++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`m:doctor:fix:${i}`)
          .setLabel(`🔧 Fix: ${report.pendingFixes[i].message.slice(0, 30)}`)
          .setStyle(ButtonStyle.Primary),
      )
    }
    components.push(row)
  }

  return { content: lines.join('\n'), components }
}

export async function handleDoctor(
  interaction: ChatInputCommandInteraction,
  _adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  try {
    const engine = new DoctorEngine()
    const report = await engine.runAll()
    const { content, components } = renderReport(report)

    // Store pending fixes for button callbacks
    const storeKey = `${interaction.guildId}:${interaction.channelId}`
    if (report.pendingFixes.length > 0) {
      pendingFixesStore.set(storeKey, report.pendingFixes)
    }

    await interaction.editReply({ content, components })
  } catch (err) {
    log.error({ err }, '[discord-doctor] Doctor command failed')
    await interaction.editReply(
      `❌ Doctor failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export async function runDoctorInline(
  interaction: ButtonInteraction,
  _adapter: DiscordAdapter,
): Promise<void> {
  try {
    const engine = new DoctorEngine()
    const report = await engine.runAll()
    const { content, components } = renderReport(report)

    const storeKey = `${interaction.guildId}:${interaction.channelId}`
    if (report.pendingFixes.length > 0) {
      pendingFixesStore.set(storeKey, report.pendingFixes)
    }

    await interaction.followUp({ content, components, ephemeral: true })
  } catch (err) {
    log.error({ err }, '[discord-doctor] Doctor inline failed')
    await interaction.followUp({
      content: `❌ Doctor failed: ${err instanceof Error ? err.message : String(err)}`,
      ephemeral: true,
    })
  }
}

export async function handleDoctorButton(
  interaction: ButtonInteraction,
  _adapter: DiscordAdapter,
): Promise<void> {
  const { customId } = interaction

  if (customId === 'm:doctor') {
    try { await interaction.deferUpdate() } catch { /* ignore */ }
    await runDoctorInline(interaction, _adapter)
    return
  }

  if (customId.startsWith('m:doctor:fix:')) {
    const index = parseInt(customId.replace('m:doctor:fix:', ''), 10)
    const storeKey = `${interaction.guildId}:${interaction.channelId}`
    const fixes = pendingFixesStore.get(storeKey)

    try { await interaction.deferUpdate() } catch { /* ignore */ }

    if (!fixes || index < 0 || index >= fixes.length) {
      try { await interaction.followUp({ content: '⚠️ Fix no longer available.', ephemeral: true }) } catch { /* */ }
      return
    }

    const pending = fixes[index]
    try {
      const result = await pending.fix()
      if (result.success) {
        // Re-run doctor to show updated status
        const engine = new DoctorEngine()
        const report = await engine.runAll()
        const { content, components } = renderReport(report)

        if (report.pendingFixes.length > 0) {
          pendingFixesStore.set(storeKey, report.pendingFixes)
        } else {
          pendingFixesStore.delete(storeKey)
        }

        try { await interaction.followUp({ content, components, ephemeral: true }) } catch { /* ignore */ }
      } else {
        try { await interaction.followUp({ content: `❌ Fix failed: ${result.message}`, ephemeral: true }) } catch { /* */ }
      }
    } catch (err) {
      log.error({ err, index }, '[discord-doctor] Doctor fix callback failed')
    }
  }
}
