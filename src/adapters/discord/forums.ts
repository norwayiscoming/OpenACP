import { ChannelType } from 'discord.js'
import type { ForumChannel, ThreadChannel, Guild, TextChannel } from 'discord.js'
import { log } from '../../core/log.js'

// ─── ensureForums ─────────────────────────────────────────────────────────────

/**
 * Ensures both the forum channel and notification channel exist.
 * Creates them if their IDs are null, then persists the IDs via saveConfig.
 *
 * saveConfig uses nested object path: { channels: { discord: { forumChannelId: ... } } }
 */
export async function ensureForums(
  guild: Guild,
  config: {
    forumChannelId: string | null
    notificationChannelId: string | null
  },
  saveConfig: (updates: Record<string, unknown>) => Promise<void>,
): Promise<{ forumChannel: ForumChannel | TextChannel; notificationChannel: TextChannel }> {
  let forumChannelId = config.forumChannelId
  let notificationChannelId = config.notificationChannelId

  // Ensure forum/sessions channel exists — fetch existing or create new
  let forumChannel: ForumChannel | TextChannel | null = null
  if (forumChannelId) {
    try {
      const ch = guild.channels.cache.get(forumChannelId)
        ?? await guild.channels.fetch(forumChannelId)
      if (ch && (ch.type === ChannelType.GuildForum || ch.type === ChannelType.GuildText)) {
        forumChannel = ch as ForumChannel | TextChannel
        log.info({ forumChannelId, type: ch.type }, '[forums] Reusing existing sessions channel')
      }
    } catch {
      log.warn({ forumChannelId }, '[forums] Saved sessions channel not found, recreating...')
    }
  }
  if (!forumChannel) {
    // Prefer Forum Channel (requires Community mode), fallback to Text Channel with threads
    if (guild.features.includes('COMMUNITY')) {
      const channel = await guild.channels.create({
        name: 'openacp-sessions',
        type: ChannelType.GuildForum,
      })
      forumChannel = channel as ForumChannel
      log.info({ forumChannelId: channel.id }, '[forums] Created forum channel')
    } else {
      const channel = await guild.channels.create({
        name: 'openacp-sessions',
        type: ChannelType.GuildText,
      })
      forumChannel = channel as TextChannel
      log.info({ forumChannelId: channel.id }, '[forums] Created text channel (Community mode not enabled, using threads fallback)')
    }
    await saveConfig({ channels: { discord: { forumChannelId: forumChannel.id } } })
  }

  // Ensure notification channel exists — fetch existing or create new
  let notificationChannel: TextChannel | null = null
  if (notificationChannelId) {
    try {
      const ch = guild.channels.cache.get(notificationChannelId)
        ?? await guild.channels.fetch(notificationChannelId)
      if (ch && ch.type === ChannelType.GuildText) {
        notificationChannel = ch as TextChannel
        log.info({ notificationChannelId }, '[forums] Reusing existing notification channel')
      }
    } catch {
      log.warn({ notificationChannelId }, '[forums] Saved notification channel not found, recreating...')
    }
  }
  if (!notificationChannel) {
    const channel = await guild.channels.create({
      name: 'openacp-notifications',
      type: ChannelType.GuildText,
    })
    notificationChannel = channel as TextChannel
    await saveConfig({ channels: { discord: { notificationChannelId: channel.id } } })
    log.info({ notificationChannelId: channel.id }, '[forums] Created notification channel')
  }

  return { forumChannel, notificationChannel }
}

// ─── createSessionThread ──────────────────────────────────────────────────────

/**
 * Creates a new thread for a session.
 * - Forum Channel: creates a forum post (thread with initial message)
 * - Text Channel: creates a public thread
 */
export async function createSessionThread(
  forumChannel: ForumChannel | TextChannel,
  name: string,
): Promise<ThreadChannel> {
  if (forumChannel.type === ChannelType.GuildForum) {
    // Forum channel: create a post (thread with initial message)
    const thread = await (forumChannel as ForumChannel).threads.create({
      name,
      message: { content: '⏳ Setting up...' },
    })
    return thread
  }

  // Text channel fallback: send a message first, then create a thread on it
  const textChannel = forumChannel as TextChannel
  const msg = await textChannel.send({ content: `📂 **${name}** — ⏳ Setting up...` })
  const thread = await msg.startThread({ name })
  return thread
}

// ─── renameSessionThread ──────────────────────────────────────────────────────

/**
 * Fetches and renames a thread. Ignores all errors (thread may be deleted/archived).
 */
export async function renameSessionThread(
  guild: Guild,
  threadId: string,
  newName: string,
): Promise<void> {
  try {
    const channel = guild.channels.cache.get(threadId)
      ?? await guild.channels.fetch(threadId)
    if (channel && 'setName' in channel) {
      await (channel as ThreadChannel).setName(newName)
    }
  } catch {
    // Ignore — thread may be deleted or archived
  }
}

// ─── deleteSessionThread ──────────────────────────────────────────────────────

/**
 * Archives and locks a thread instead of permanently deleting it.
 * Unlike Telegram (which just closes a topic), Discord delete is permanent
 * and destroys all messages. Archiving preserves the conversation history.
 */
export async function deleteSessionThread(
  guild: Guild,
  threadId: string,
): Promise<void> {
  try {
    const channel = guild.channels.cache.get(threadId)
      ?? await guild.channels.fetch(threadId)
    if (channel && channel.isThread()) {
      const thread = channel as ThreadChannel
      if (!thread.archived) {
        await thread.setArchived(true)
      }
      if (!thread.locked) {
        await thread.setLocked(true)
      }
    }
  } catch {
    // Ignore — thread may already be deleted or inaccessible
  }
}

// ─── ensureUnarchived ─────────────────────────────────────────────────────────

/**
 * If the thread is archived, unarchives it.
 */
export async function ensureUnarchived(thread: ThreadChannel): Promise<void> {
  if (thread.archived) {
    try {
      await thread.setArchived(false)
    } catch (err) {
      log.warn({ err, threadId: thread.id }, '[forums] Failed to unarchive thread')
    }
  }
}

// ─── buildDeepLink ────────────────────────────────────────────────────────────

/**
 * Builds a Discord deep link URL to a channel/thread, optionally to a specific message.
 */
export function buildDeepLink(
  guildId: string,
  channelId: string,
  messageId?: string,
): string {
  const base = `https://discord.com/channels/${guildId}/${channelId}`
  return messageId ? `${base}/${messageId}` : base
}
