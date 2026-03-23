import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import { log } from '../../../core/log.js'

// TODO: Replace `any` with DiscordAdapter once Task 12 is implemented

export async function handleSettings(
  interaction: ChatInputCommandInteraction,
  adapter: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  const config = adapter.core.configManager.get()
  const configPath = adapter.core.configManager.getConfigPath()

  const installedAgents = Object.keys(adapter.core.agentCatalog.getInstalledEntries())
  const agentList = installedAgents.length > 0
    ? installedAgents.map((a: string) => a === config.defaultAgent ? `${a} (default)` : a).join(', ')
    : 'none'

  await interaction.editReply(
    `**⚙️ Settings**\n\n` +
    `**Default Agent:** ${config.defaultAgent}\n` +
    `**Installed Agents:** ${agentList}\n` +
    `**Workspace:** \`${config.workspace.baseDir}\`\n` +
    `**Max Concurrent Sessions:** ${config.security.maxConcurrentSessions}\n` +
    `**Log Level:** ${config.logging.level}\n` +
    `**Config file:** \`${configPath}\`\n\n` +
    `*To change settings, edit the config file directly or use the CLI: \`openacp config set <key> <value>\`*`,
  )
}

export async function showSettingsInfo(
  interaction: ButtonInteraction,
  adapter: any,
): Promise<void> {
  const config = adapter.core.configManager.get()
  const installedAgents = Object.keys(adapter.core.agentCatalog.getInstalledEntries())
  const agentList = installedAgents.length > 0
    ? installedAgents.map((a: string) => a === config.defaultAgent ? `${a} (default)` : a).join(', ')
    : 'none'

  await interaction.followUp({
    content:
      `**⚙️ Settings**\n\n` +
      `**Default Agent:** ${config.defaultAgent}\n` +
      `**Installed Agents:** ${agentList}\n` +
      `**Workspace:** \`${config.workspace.baseDir}\`\n` +
      `**Max Concurrent Sessions:** ${config.security.maxConcurrentSessions}\n\n` +
      `*Use \`/settings\` or \`openacp config\` to view full configuration.*`,
    ephemeral: true,
  })
}

export async function handleSettingsButton(
  interaction: ButtonInteraction,
  adapter: any,
): Promise<void> {
  // Stub: settings button callbacks not yet implemented for Discord
  log.debug({ customId: interaction.customId }, '[discord-settings] Button stub called')
  try {
    await showSettingsInfo(interaction, adapter)
  } catch (err) {
    log.warn({ err }, '[discord-settings] Settings button handler failed')
    try {
      await interaction.reply({
        content: '⚙️ Use `/settings` to view configuration.',
        ephemeral: true,
      })
    } catch { /* ignore */ }
  }
}
