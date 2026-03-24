import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import { log } from '../../../core/log.js'
import type { DiscordAdapter } from '../adapter.js'

export async function handleIntegrate(
  interaction: ChatInputCommandInteraction,
  _adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })
  // Stub: integration management not yet implemented for Discord
  await interaction.editReply(
    '🔗 **Integrations**\n\nIntegration management via Discord is not yet implemented.\n\nUse the CLI: `openacp integrate`',
  )
}

export async function handleIntegrateButton(
  interaction: ButtonInteraction,
  _adapter: DiscordAdapter,
): Promise<void> {
  // Stub: integration button callbacks not yet implemented for Discord
  log.debug({ customId: interaction.customId }, '[discord-integrate] Button stub called')
  try {
    await interaction.reply({
      content: '🔗 Integration management via Discord is not yet implemented. Use the CLI: `openacp integrate`',
      ephemeral: true,
    })
  } catch { /* ignore */ }
}
