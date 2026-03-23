import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import { log } from '../../../core/log.js'
import type { InstallProgress } from '../../../core/types.js'

// TODO: Replace `any` with DiscordAdapter once Task 12 is implemented

const AGENTS_PER_PAGE = 5

function buildProgressBar(percent: number): string {
  const filled = Math.round(percent / 10)
  const empty = 10 - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}

export async function handleAgents(
  interaction: ChatInputCommandInteraction,
  adapter: any,
  page = 0,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })
  const { content, components } = buildAgentsContent(adapter, page)
  await interaction.editReply({ content, components })
}

export async function showAgentsList(
  interaction: ButtonInteraction,
  adapter: any,
  page = 0,
): Promise<void> {
  const { content, components } = buildAgentsContent(adapter, page)
  await interaction.followUp({ content, components, ephemeral: true })
}

function buildAgentsContent(
  adapter: any,
  page: number,
): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
  const catalog = adapter.core.agentCatalog
  const items = catalog.getAvailable()

  const installed = items.filter((i: any) => i.installed)
  const available = items.filter((i: any) => !i.installed)

  let content = '**🤖 Agents**\n\n'

  if (installed.length > 0) {
    content += '**Installed:**\n'
    for (const item of installed) {
      content += `✅ **${item.name}**`
      if (item.description) content += ` — *${truncate(item.description, 50)}*`
      content += '\n'
    }
    content += '\n'
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = []

  if (available.length > 0) {
    const totalPages = Math.ceil(available.length / AGENTS_PER_PAGE)
    const safePage = Math.max(0, Math.min(page, totalPages - 1))
    const pageItems = available.slice(safePage * AGENTS_PER_PAGE, (safePage + 1) * AGENTS_PER_PAGE)

    content += `**Available to install:**`
    if (totalPages > 1) content += ` (${safePage + 1}/${totalPages})`
    content += '\n'

    for (const item of pageItems) {
      if (item.available) {
        content += `⬇️ **${item.name}**`
      } else {
        const deps = item.missingDeps?.join(', ') ?? 'requirements not met'
        content += `⚠️ **${item.name}** *(needs: ${deps})*`
      }
      if (item.description) content += `\n   *${truncate(item.description, 60)}*`
      content += '\n'
    }

    // Install buttons row
    const installable = pageItems.filter((i: any) => i.available)
    if (installable.length > 0) {
      const installRow = new ActionRowBuilder<ButtonBuilder>()
      for (const item of installable) {
        installRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`ag:install:${item.key}`)
            .setLabel(`⬇️ ${item.name}`)
            .setStyle(ButtonStyle.Secondary),
        )
      }
      components.push(installRow)
    }

    // Pagination row
    if (totalPages > 1) {
      const pageRow = new ActionRowBuilder<ButtonBuilder>()
      if (safePage > 0) {
        pageRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`ag:page:${safePage - 1}`)
            .setLabel('◀️ Prev')
            .setStyle(ButtonStyle.Secondary),
        )
      }
      if (safePage < totalPages - 1) {
        pageRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`ag:page:${safePage + 1}`)
            .setLabel('Next ▶️')
            .setStyle(ButtonStyle.Secondary),
        )
      }
      if (pageRow.components.length > 0) components.push(pageRow)
    }
  } else {
    content += '*All agents are already installed!*'
  }

  return { content, components }
}

export async function handleInstall(
  interaction: ChatInputCommandInteraction,
  adapter: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  const nameOrId = interaction.options.getString('name', true)
  await installAgentWithProgress(interaction, adapter, nameOrId)
}

export async function handleAgentButton(
  interaction: ButtonInteraction,
  adapter: any,
): Promise<void> {
  const { customId } = interaction

  if (customId.startsWith('ag:install:')) {
    const nameOrId = customId.replace('ag:install:', '')
    try { await interaction.deferReply({ ephemeral: true }) } catch { /* ignore */ }
    await installAgentWithProgress(interaction, adapter, nameOrId)
    return
  }

  if (customId.startsWith('ag:page:')) {
    const page = parseInt(customId.replace('ag:page:', ''), 10)
    const { content, components } = buildAgentsContent(adapter, page)
    try {
      await interaction.update({ content, components })
    } catch (err) {
      log.warn({ err }, '[discord-agents] Failed to update page')
    }
  }
}

async function installAgentWithProgress(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  adapter: any,
  nameOrId: string,
): Promise<void> {
  const catalog = adapter.core.agentCatalog

  // Track the latest status for periodic edits
  let statusText = `⏳ Installing **${nameOrId}**...`
  let lastEdit = 0
  const EDIT_THROTTLE_MS = 1500

  const editStatus = async (text: string) => {
    const now = Date.now()
    if (now - lastEdit > EDIT_THROTTLE_MS) {
      lastEdit = now
      statusText = text
      try {
        if ((interaction as any).deferred || (interaction as any).replied) {
          await interaction.editReply(text)
        }
      } catch { /* rate limit or unchanged */ }
    } else {
      statusText = text
    }
  }

  // Set initial message
  try {
    if ((interaction as any).deferred || (interaction as any).replied) {
      await interaction.editReply(statusText)
    }
  } catch { /* ignore */ }

  const progress: InstallProgress = {
    onStart(_id, _name) { /* initial message already sent */ },
    async onStep(step) { await editStatus(`⏳ **${nameOrId}**: ${step}`) },
    async onDownloadProgress(percent) {
      const bar = buildProgressBar(percent)
      await editStatus(`⏳ **${nameOrId}**\nDownloading... ${bar} ${percent}%`)
    },
    async onSuccess(name) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`na:${nameOrId}`)
          .setLabel(`🚀 Start session with ${name}`)
          .setStyle(ButtonStyle.Primary),
      )
      try {
        if ((interaction as any).deferred || (interaction as any).replied) {
          await interaction.editReply({
            content: `✅ **${name}** installed!`,
            components: [row],
          })
        }
      } catch { /* ignore */ }
    },
    async onError(error) {
      try {
        if ((interaction as any).deferred || (interaction as any).replied) {
          await interaction.editReply(`❌ ${error}`)
        }
      } catch { /* ignore */ }
    },
  }

  const result = await catalog.install(nameOrId, progress)

  // Show setup steps as a follow-up message
  if (result.ok && result.setupSteps?.length) {
    let setupText = `📋 **Setup for ${result.agentKey}:**\n\n`
    for (const step of result.setupSteps) {
      setupText += `→ ${step}\n`
    }
    setupText += `\n*Run in terminal: \`openacp agents info ${result.agentKey}\`*`
    try {
      await interaction.followUp({ content: setupText, ephemeral: true })
    } catch { /* ignore */ }
  }
}
