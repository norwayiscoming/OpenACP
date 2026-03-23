import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js'
import { log } from '../../../core/log.js'
import { buildDangerousModeKeyboard } from './admin.js'
import { createSessionThread, deleteSessionThread } from '../forums.js'

// TODO: Replace `any` with DiscordAdapter once Task 12 is implemented

export async function handleNew(
  interaction: ChatInputCommandInteraction,
  adapter: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  const agentName = interaction.options.getString('agent') ?? undefined
  const workspace = interaction.options.getString('workspace') ?? undefined

  if (agentName) {
    await executeNewSession(interaction, adapter, agentName, workspace)
    return
  }

  // No agent specified — show agent picker
  const installedEntries = adapter.core.agentCatalog.getInstalledEntries()
  const agentKeys = Object.keys(installedEntries)
  const config = adapter.core.configManager.get()

  if (agentKeys.length === 0) {
    await interaction.editReply('❌ No agents installed. Use `/install` to install an agent first.')
    return
  }

  if (agentKeys.length === 1) {
    await executeNewSession(interaction, adapter, config.defaultAgent, workspace)
    return
  }

  // Multiple agents — show picker buttons
  const row = new ActionRowBuilder<ButtonBuilder>()
  for (const key of agentKeys) {
    const agent = installedEntries[key]!
    const label = key === config.defaultAgent ? `${agent.name} (default)` : agent.name
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`m:new:agent:${key}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary),
    )
  }

  await interaction.editReply({
    content: '🤖 **Choose an agent:**',
    components: [row],
  })
}

export async function handleNewChat(
  interaction: ChatInputCommandInteraction,
  adapter: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  // Get current thread to inherit config from
  const channelId = interaction.channelId
  const currentSession = adapter.core.sessionManager.getSessionByThread('discord', channelId)

  let agentName: string | undefined
  let workspace: string | undefined

  if (currentSession) {
    agentName = currentSession.agentName
    workspace = currentSession.workingDirectory
  } else {
    const record = adapter.core.sessionManager.getRecordByThread('discord', channelId)
    if (!record || record.status === 'cancelled' || record.status === 'error') {
      await interaction.editReply('No active session in this channel. Use `/new` to start one.')
      return
    }
    agentName = record.agentName
    workspace = record.workingDir
  }

  await executeNewSession(interaction, adapter, agentName, workspace)
}

export async function executeNewSession(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  adapter: any,
  agentName?: string,
  workspace?: string,
): Promise<void> {
  const config = adapter.core.configManager.get()
  const resolvedAgent = agentName || config.defaultAgent

  log.info({ agentName: resolvedAgent, workspace }, '[discord-new-session] Creating session')

  const forumChannel = adapter.getForumChannel()
  if (!forumChannel) {
    const msg = '❌ Forum channel not configured. Please run setup first.'
    if ((interaction as any).deferred || (interaction as any).replied) {
      await interaction.editReply(msg)
    } else {
      await (interaction as ChatInputCommandInteraction).reply({ content: msg, ephemeral: true })
    }
    return
  }

  let thread: import('discord.js').ThreadChannel | undefined

  try {
    // Create forum thread BEFORE creating session to avoid race condition
    thread = await createSessionThread(forumChannel, `🔄 ${resolvedAgent} — New Session`)

    // Create session via core
    const session = await adapter.core.handleNewSession('discord', resolvedAgent, workspace)
    session.threadId = thread.id

    // Patch platform record with Discord thread ID
    await adapter.core.sessionManager.patchRecord(session.id, {
      platform: { threadId: thread.id },
    })

    // Send welcome message in the new thread
    const dangerousRow = buildDangerousModeKeyboard(session.id, false)
    await thread.send({
      content:
        `✅ **Session started**\n` +
        `**Agent:** ${session.agentName}\n` +
        `**Workspace:** \`${session.workingDirectory}\`\n\n` +
        `This is your coding session — chat here to work with the agent.`,
      components: [dangerousRow],
    })

    // Reply to the interaction with a link to the thread
    const replyMsg = `✅ Session created → [Open thread](https://discord.com/channels/${adapter.getGuildId()}/${thread.id})`
    if ((interaction as any).deferred || (interaction as any).replied) {
      await interaction.editReply(replyMsg)
    } else {
      await (interaction as ChatInputCommandInteraction).reply({ content: replyMsg, ephemeral: true })
    }

    // Warm up model cache in background
    session.warmup().catch((err: unknown) => log.error({ err }, '[discord-new-session] Warm-up error'))
  } catch (err) {
    log.error({ err }, '[discord-new-session] Session creation failed')

    // Clean up orphaned thread on failure (archive+lock instead of permanent delete)
    if (thread) {
      try { await deleteSessionThread(adapter.getGuild(), thread.id) } catch { /* ignore */ }
    }

    const errMsg = `❌ ${err instanceof Error ? err.message : String(err)}`
    try {
      if ((interaction as any).deferred || (interaction as any).replied) {
        await interaction.editReply(errMsg)
      } else {
        await (interaction as ChatInputCommandInteraction).reply({ content: errMsg, ephemeral: true })
      }
    } catch { /* ignore */ }
  }
}

export async function handleNewSessionButton(
  interaction: ButtonInteraction,
  adapter: any,
): Promise<void> {
  const { customId } = interaction

  if (customId.startsWith('m:new:agent:')) {
    const agentKey = customId.replace('m:new:agent:', '')
    try { await interaction.deferUpdate() } catch { /* ignore */ }
    await executeNewSession(interaction, adapter, agentKey, undefined)
  }
}
