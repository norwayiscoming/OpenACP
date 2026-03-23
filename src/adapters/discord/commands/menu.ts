import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import { log } from '../../../core/log.js'

// TODO: Replace `any` with DiscordAdapter once Task 12 is implemented

export function buildMenuKeyboard(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('m:new').setLabel('🆕 New Session').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('m:sessions').setLabel('📋 Sessions').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('m:status').setLabel('📊 Status').setStyle(ButtonStyle.Secondary),
  )
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('m:agents').setLabel('🤖 Agents').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('m:settings').setLabel('⚙️ Settings').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('m:integrate').setLabel('🔗 Integrate').setStyle(ButtonStyle.Secondary),
  )
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('m:restart').setLabel('🔄 Restart').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('m:update').setLabel('⬆️ Update').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('m:help').setLabel('❓ Help').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('m:doctor').setLabel('🩺 Doctor').setStyle(ButtonStyle.Secondary),
  )
  return [row1, row2, row3]
}

export async function handleMenu(
  interaction: ChatInputCommandInteraction,
  _adapter: any,
): Promise<void> {
  await interaction.reply({
    content: '**OpenACP Menu**\nChoose an action:',
    components: buildMenuKeyboard(),
    ephemeral: true,
  })
}

export async function handleHelp(
  interaction: ChatInputCommandInteraction,
  _adapter: any,
): Promise<void> {
  await interaction.reply({
    content:
      `📖 **OpenACP Help**\n\n` +
      `🚀 **Getting Started**\n` +
      `Use 🆕 New Session or \`/new\` to start coding with AI.\n` +
      `Each session gets its own forum thread — chat there to work with the agent.\n\n` +
      `💡 **Common Commands**\n` +
      `\`/new [agent] [workspace]\` — Create new session\n` +
      `\`/newchat\` — New chat, same agent & workspace\n` +
      `\`/cancel\` — Cancel current session\n` +
      `\`/status\` — Show session or system status\n` +
      `\`/sessions\` — List all sessions\n` +
      `\`/agents\` — Browse & install agents\n` +
      `\`/install <name>\` — Install an agent\n\n` +
      `⚙️ **System**\n` +
      `\`/restart\` — Restart OpenACP\n` +
      `\`/update\` — Update to latest version\n` +
      `\`/integrate\` — Manage agent integrations\n` +
      `\`/settings\` — View configuration\n` +
      `\`/menu\` — Show action menu\n\n` +
      `🔒 **Session Options**\n` +
      `\`/dangerous\` — Toggle dangerous mode (auto-approve permissions)\n` +
      `\`/handoff\` — Continue session in your terminal\n` +
      `\`/clear\` — Clear assistant session history\n\n` +
      `🩺 **Diagnostics**\n` +
      `\`/doctor\` — Run system diagnostics`,
    ephemeral: true,
  })
}

export async function handleClear(
  interaction: ChatInputCommandInteraction,
  adapter: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  if (!adapter.assistant) {
    await interaction.editReply('⚠️ Assistant is not available.')
    return
  }

  try {
    await adapter.assistant.respawn()
    await interaction.editReply('✅ Assistant history cleared.')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await interaction.editReply(`❌ Failed to clear: \`${message}\``)
  }
}

export async function handleMenuButton(
  interaction: ButtonInteraction,
  adapter: any,
): Promise<void> {
  const { customId } = interaction

  try {
    await interaction.deferUpdate()
  } catch { /* expired */ }

  try {
    switch (customId) {
      case 'm:new': {
        // Delegate to new-session handler
        const { handleNew } = await import('./new-session.js')
        // Create a fake slash command interaction proxy for the button context
        // We just show the menu inline instead
        await interaction.followUp({ content: 'Use `/new` to create a new session.', ephemeral: true })
        break
      }
      case 'm:sessions': {
        const { handleSessions } = await import('./session.js')
        // Use followUp to show the sessions list
        await showSessionsList(interaction, adapter)
        break
      }
      case 'm:status': {
        await showGlobalStatus(interaction, adapter)
        break
      }
      case 'm:agents': {
        const { showAgentsList } = await import('./agents.js')
        await showAgentsList(interaction, adapter)
        break
      }
      case 'm:settings': {
        const { showSettingsInfo } = await import('./settings.js')
        await showSettingsInfo(interaction, adapter)
        break
      }
      case 'm:integrate': {
        await interaction.followUp({ content: 'Use `/integrate` to manage integrations.', ephemeral: true })
        break
      }
      case 'm:restart': {
        const { handleRestart } = await import('./admin.js')
        if (!adapter.core.requestRestart) {
          await interaction.followUp({ content: '⚠️ Restart not available.', ephemeral: true })
        } else {
          await interaction.followUp({ content: '🔄 Restarting OpenACP...', ephemeral: true })
          await new Promise((r) => setTimeout(r, 500))
          await adapter.core.requestRestart()
        }
        break
      }
      case 'm:update': {
        await interaction.followUp({ content: '⚠️ Update not implemented yet. Run `npm install -g @openacp/cli@latest` in your terminal.', ephemeral: true })
        break
      }
      case 'm:help': {
        await interaction.followUp({ content: 'Use `/help` for command reference.', ephemeral: true })
        break
      }
      case 'm:doctor': {
        const { runDoctorInline } = await import('./doctor.js')
        await runDoctorInline(interaction, adapter)
        break
      }
      default:
        log.warn({ customId }, '[discord-menu] Unhandled menu button')
    }
  } catch (err) {
    log.error({ err, customId }, '[discord-menu] Menu button handler failed')
    try {
      await interaction.followUp({ content: `❌ Action failed: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true })
    } catch { /* ignore */ }
  }
}

async function showGlobalStatus(interaction: ButtonInteraction, adapter: any): Promise<void> {
  const sessions = adapter.core.sessionManager.listSessions('discord')
  const active = sessions.filter((s: any) => s.status === 'active' || s.status === 'initializing')
  await interaction.followUp({
    content:
      `**OpenACP Status**\n` +
      `Active sessions: ${active.length}\n` +
      `Total sessions: ${sessions.length}`,
    ephemeral: true,
  })
}

async function showSessionsList(interaction: ButtonInteraction, adapter: any): Promise<void> {
  const allRecords = adapter.core.sessionManager.listRecords()
  if (allRecords.length === 0) {
    await interaction.followUp({ content: 'No sessions found.', ephemeral: true })
    return
  }

  const STATUS_EMOJI: Record<string, string> = {
    active: '🟢', initializing: '🟡', finished: '✅', error: '❌', cancelled: '⛔',
  }
  const STATUS_ORDER: Record<string, number> = {
    active: 0, initializing: 1, error: 2, finished: 3, cancelled: 4,
  }

  allRecords.sort(
    (a: any, b: any) => (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5),
  )

  const lines = allRecords.slice(0, 20).map((r: any) => {
    const emoji = STATUS_EMOJI[r.status] || '⚪'
    const name = r.name?.trim() || `${r.agentName} session`
    return `${emoji} **${name}** \`[${r.status}]\``
  })

  const truncated = allRecords.length > 20 ? `\n\n*...and ${allRecords.length - 20} more*` : ''

  await interaction.followUp({
    content: `**Sessions: ${allRecords.length}**\n\n${lines.join('\n')}${truncated}`,
    ephemeral: true,
  })
}
