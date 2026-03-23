import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import { log } from '../../../core/log.js'

// TODO: Replace `any` with DiscordAdapter once Task 12 is implemented

export async function handleIntegrate(
  interaction: ChatInputCommandInteraction,
  _adapter: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })
  // Stub: integration management not yet implemented for Discord
  await interaction.editReply(
    '🔗 **Integrations**\n\nIntegration management via Discord is not yet implemented.\n\nUse the CLI: `openacp integrate`',
  )
}

export async function handleIntegrateButton(
  interaction: ButtonInteraction,
  _adapter: any,
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
