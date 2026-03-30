import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import { log } from '../../../core/utils/log.js'
import { getSafeFields, resolveOptions, getConfigValue, isHotReloadable, type ConfigFieldDef } from '../../../core/config/config-registry.js'
import type { DiscordAdapter } from '../adapter.js'

function formatFieldLabel(field: ConfigFieldDef, value: unknown): string {
  const icons: Record<string, string> = {
    agent: '🤖', logging: '📝', tunnel: '🔗',
    security: '🔒', workspace: '📁', storage: '💾', speech: '🎤',
  }
  const icon = icons[field.group] ?? '⚙️'

  if (field.type === 'toggle') {
    return `${icon} ${field.displayName}: ${value ? 'ON' : 'OFF'}`
  }
  const displayValue = value === null || value === undefined ? 'Not set' : String(value)
  return `${icon} ${field.displayName}: ${displayValue}`
}

const SETTINGS_PAGE_SIZE = 4 // 4 field rows + 1 navigation row = 5 max

function buildSettingsRows(adapter: DiscordAdapter, page = 0): ActionRowBuilder<ButtonBuilder>[] {
  const config = adapter.core.configManager.get()
  const fields = getSafeFields()
  const totalPages = Math.ceil(fields.length / SETTINGS_PAGE_SIZE)
  const start = page * SETTINGS_PAGE_SIZE
  const pageFields = fields.slice(start, start + SETTINGS_PAGE_SIZE)

  const rows: ActionRowBuilder<ButtonBuilder>[] = []

  for (const field of pageFields) {
    const value = getConfigValue(config, field.path)
    const label = formatFieldLabel(field, value)

    let customId: string
    if (field.type === 'toggle') {
      customId = `s:toggle:${field.path}`
    } else if (field.type === 'select') {
      customId = `s:select:${field.path}`
    } else {
      customId = `s:input:${field.path}`
    }

    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel(label.slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
      ),
    )
  }

  // Navigation row (if more than 1 page)
  if (totalPages > 1) {
    const navRow = new ActionRowBuilder<ButtonBuilder>()
    if (page > 0) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`s:page:${page - 1}`)
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Primary),
      )
    }
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId('s:pageinfo')
        .setLabel(`Page ${page + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    )
    if (page < totalPages - 1) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`s:page:${page + 1}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Primary),
      )
    }
    rows.push(navRow)
  }

  return rows
}

export async function handleSettings(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  const rows = buildSettingsRows(adapter)
  await interaction.editReply({
    content: '**⚙️ Settings**\nTap to change:',
    components: rows,
  })
}

export async function showSettingsInfo(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const rows = buildSettingsRows(adapter)
  await interaction.followUp({
    content: '**⚙️ Settings**\nTap to change:',
    components: rows,
    ephemeral: true,
  })
}

export async function handleSettingsButton(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const { customId } = interaction

  try {
    // Toggle buttons
    if (customId.startsWith('s:toggle:')) {
      const fieldPath = customId.replace('s:toggle:', '')
      const config = adapter.core.configManager.get()
      const currentValue = getConfigValue(config, fieldPath)
      const newValue = !currentValue

      const updates = buildNestedUpdate(fieldPath, newValue)
      await adapter.core.configManager.save(updates, fieldPath)

      const toast = isHotReloadable(fieldPath)
        ? `✅ ${fieldPath} = ${newValue}`
        : `✅ ${fieldPath} = ${newValue} (restart needed)`

      try {
        await interaction.update({
          content: '**⚙️ Settings**\nTap to change:',
          components: buildSettingsRows(adapter),
        })
      } catch { /* ignore */ }

      try { await interaction.followUp({ content: toast, ephemeral: true }) } catch { /* ignore */ }
      return
    }

    // Select buttons — show options
    if (customId.startsWith('s:select:')) {
      const fieldPath = customId.replace('s:select:', '')
      const config = adapter.core.configManager.get()
      const fieldDef = getSafeFields().find((f) => f.path === fieldPath)
      if (!fieldDef) return

      const options = resolveOptions(fieldDef, config) ?? []
      const currentValue = getConfigValue(config, fieldPath)

      const rows: ActionRowBuilder<ButtonBuilder>[] = []
      let currentRow = new ActionRowBuilder<ButtonBuilder>()
      let count = 0

      for (const opt of options) {
        const marker = opt === String(currentValue) ? ' ✓' : ''
        currentRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`s:pick:${fieldPath}:${opt}`)
            .setLabel(`${opt}${marker}`.slice(0, 80))
            .setStyle(opt === String(currentValue) ? ButtonStyle.Success : ButtonStyle.Secondary),
        )
        count++
        if (count % 3 === 0) {
          rows.push(currentRow)
          currentRow = new ActionRowBuilder<ButtonBuilder>()
        }
      }

      if (currentRow.components.length > 0) {
        rows.push(currentRow)
      }

      // Add back button
      const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('s:back')
          .setLabel('◀️ Back')
          .setStyle(ButtonStyle.Primary),
      )
      rows.push(backRow)

      try {
        await interaction.update({
          content: `**⚙️ ${fieldDef.displayName}**\nSelect a value:`,
          components: rows.slice(0, 5),
        })
      } catch { /* ignore */ }
      return
    }

    // Pick buttons — apply selected value
    if (customId.startsWith('s:pick:')) {
      const parts = customId.replace('s:pick:', '').split(':')
      const fieldPath = parts.slice(0, -1).join(':')
      const newValue = parts[parts.length - 1]

      // For speech.stt.provider: check if API key is configured
      if (fieldPath === 'speech.stt.provider') {
        const config = adapter.core.configManager.get()
        const providerConfig = config.speech?.stt?.providers?.[newValue]
        if (!providerConfig?.apiKey) {
          // No API key — delegate to assistant
          const assistantSessionId = adapter.getAssistantSessionId()
          if (assistantSessionId) {
            const assistantSession = adapter.core.sessionManager.getSession(assistantSessionId)
            if (assistantSession) {
              const prompt = `User wants to enable ${newValue} as Speech-to-Text provider, but no API key is configured yet. Guide them to get a ${newValue} API key and set it up. After they provide the key, run both commands: \`openacp config set speech.stt.providers.${newValue}.apiKey <key>\` and \`openacp config set speech.stt.provider ${newValue}\``
              await assistantSession.enqueuePrompt(prompt)

              try {
                await interaction.update({
                  content: '**⚙️ Settings**\nTap to change:',
                  components: buildSettingsRows(adapter),
                })
              } catch { /* ignore */ }
              try { await interaction.followUp({ content: '🔑 API key needed — check the Assistant thread.', ephemeral: true }) } catch { /* ignore */ }
              return
            }
          }

          // No assistant — just warn
          try {
            await interaction.update({
              content: '**⚙️ Settings**\nTap to change:',
              components: buildSettingsRows(adapter),
            })
          } catch { /* ignore */ }
          try { await interaction.followUp({ content: `⚠️ Set API key first: \`openacp config set speech.stt.providers.${newValue}.apiKey <key>\``, ephemeral: true }) } catch { /* ignore */ }
          return
        }
      }

      const updates = buildNestedUpdate(fieldPath, newValue)
      await adapter.core.configManager.save(updates, fieldPath)

      try {
        await interaction.update({
          content: '**⚙️ Settings**\nTap to change:',
          components: buildSettingsRows(adapter),
        })
      } catch { /* ignore */ }
      try { await interaction.followUp({ content: `✅ ${fieldPath} = ${newValue}`, ephemeral: true }) } catch { /* ignore */ }
      return
    }

    // Input buttons — delegate to assistant
    if (customId.startsWith('s:input:')) {
      const fieldPath = customId.replace('s:input:', '')
      const config = adapter.core.configManager.get()
      const fieldDef = getSafeFields().find((f) => f.path === fieldPath)
      if (!fieldDef) return

      const currentValue = getConfigValue(config, fieldPath)
      const assistantSessionId = adapter.getAssistantSessionId()

      if (!assistantSessionId) {
        try { await interaction.reply({ content: '⚠️ Assistant is not available.', ephemeral: true }) } catch { /* ignore */ }
        return
      }

      const assistantSession = adapter.core.sessionManager.getSession(assistantSessionId)
      if (!assistantSession) {
        try { await interaction.reply({ content: '⚠️ Assistant session not found.', ephemeral: true }) } catch { /* ignore */ }
        return
      }

      try { await interaction.deferUpdate() } catch { /* ignore */ }

      const prompt = `User wants to change ${fieldDef.displayName} (config path: ${fieldPath}). Current value: ${JSON.stringify(currentValue)}. Ask them for the new value and apply it using: openacp config set ${fieldPath} <value>`
      await assistantSession.enqueuePrompt(prompt)

      try { await interaction.followUp({ content: `Delegating to assistant — check the Assistant thread.`, ephemeral: true }) } catch { /* ignore */ }
      return
    }

    // Page navigation
    if (customId.startsWith('s:page:')) {
      const page = parseInt(customId.replace('s:page:', ''), 10)
      try {
        await interaction.update({
          content: '**⚙️ Settings**\nTap to change:',
          components: buildSettingsRows(adapter, page),
        })
      } catch { /* ignore */ }
      return
    }

    // Back button — return to page 0
    if (customId === 's:back') {
      try {
        await interaction.update({
          content: '**⚙️ Settings**\nTap to change:',
          components: buildSettingsRows(adapter),
        })
      } catch { /* ignore */ }
      return
    }

    log.warn({ customId }, '[discord-settings] Unhandled settings button')
  } catch (err) {
    log.error({ err, customId }, '[discord-settings] Settings button handler failed')
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Settings action failed.', ephemeral: true })
      } else {
        await interaction.followUp({ content: '❌ Settings action failed.', ephemeral: true })
      }
    } catch { /* ignore */ }
  }
}

function buildNestedUpdate(dotPath: string, value: unknown): Record<string, unknown> {
  const parts = dotPath.split('.')
  const result: Record<string, unknown> = {}
  let target = result
  for (let i = 0; i < parts.length - 1; i++) {
    target[parts[i]] = {}
    target = target[parts[i]] as Record<string, unknown>
  }
  target[parts[parts.length - 1]] = value
  return result
}
