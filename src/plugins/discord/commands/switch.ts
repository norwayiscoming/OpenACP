import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
} from 'discord.js'
import { log } from '../../../core/utils/log.js'
import type { DiscordAdapter } from '../adapter.js'

export async function handleSwitch(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  const channelId = interaction.channelId
  const session = adapter.core.sessionManager.getSessionByThread('discord', channelId)

  if (!session) {
    await interaction.editReply('No active session in this channel.')
    return
  }

  const raw = interaction.options.getString('agent')?.trim() ?? ''

  // /switch label on|off
  const labelArg = interaction.options.getString('label')?.trim().toLowerCase() ?? ''
  if (labelArg) {
    if (labelArg === 'on' || labelArg === 'off') {
      await adapter.core.configManager.save(
        { agentSwitch: { labelHistory: labelArg === 'on' } },
        'agentSwitch.labelHistory',
      )
      await interaction.editReply(`Agent label in history: ${labelArg}`)
    } else {
      await interaction.editReply('Usage: /switch label:on or /switch label:off')
    }
    return
  }

  // /switch (no agent arg) → show menu
  if (!raw) {
    const agents = adapter.core.agentManager.getAvailableAgents()
    const currentAgent = session.agentName
    const options = agents.filter((a) => a.name !== currentAgent)

    if (options.length === 0) {
      await interaction.editReply('No other agents available.')
      return
    }

    const rows: ActionRowBuilder<ButtonBuilder>[] = []
    for (const agent of options) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`sw:${agent.name}`)
          .setLabel(agent.name)
          .setStyle(ButtonStyle.Primary),
      )
      rows.push(row)
    }

    await interaction.editReply({
      content: `**Switch Agent**\nCurrent: \`${currentAgent}\`\n\nSelect an agent:`,
      components: rows.slice(0, 5), // Discord allows max 5 action rows
    })
    return
  }

  // /switch <agentName> → direct switch
  await executeSwitchAgent(interaction, adapter, session.id, raw)
}

async function executeSwitchAgent(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  adapter: DiscordAdapter,
  sessionId: string,
  agentName: string,
): Promise<void> {
  try {
    const { resumed } = await adapter.core.switchSessionAgent(sessionId, agentName)
    const status = resumed ? 'resumed' : 'new session'
    const content = `Switched to **${agentName}** (${status})`

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content)
    } else {
      await interaction.reply({ content, ephemeral: true })
    }
    log.info({ sessionId, agentName, resumed }, '[discord-switch] Agent switched via /switch')
  } catch (err: any) {
    const errMsg = `Failed to switch agent: ${err.message || err}`
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errMsg)
    } else {
      await interaction.reply({ content: errMsg, ephemeral: true })
    }
    log.warn({ sessionId, agentName, err: err.message }, '[discord-switch] Agent switch failed')
  }
}

export async function handleSwitchButton(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const agentName = interaction.customId.replace('sw:', '')

  try {
    await interaction.deferReply({ ephemeral: true })
  } catch { /* ignore */ }

  const channelId = interaction.channelId
  const session = adapter.core.sessionManager.getSessionByThread('discord', channelId)

  if (!session) {
    await interaction.editReply('No active session in this channel.')
    return
  }

  await executeSwitchAgent(interaction, adapter, session.id, agentName)
}
