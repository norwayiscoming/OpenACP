import type { Bot } from 'grammy'

// Ensure notification and assistant topics exist, create if needed
// Returns updated topic IDs
export async function ensureTopics(
  bot: Bot,
  chatId: number,
  config: { notificationTopicId: number | null; assistantTopicId: number | null },
  saveConfig: (updates: { notificationTopicId?: number; assistantTopicId?: number }) => Promise<void>,
): Promise<{ notificationTopicId: number; assistantTopicId: number }> {
  let notificationTopicId = config.notificationTopicId
  let assistantTopicId = config.assistantTopicId

  if (notificationTopicId === null) {
    const topic = await bot.api.createForumTopic(chatId, '📋 Notifications')
    notificationTopicId = topic.message_thread_id
    await saveConfig({ notificationTopicId })
  }

  if (assistantTopicId === null) {
    const topic = await bot.api.createForumTopic(chatId, '🤖 Assistant')
    assistantTopicId = topic.message_thread_id
    await saveConfig({ assistantTopicId })
  }

  return { notificationTopicId, assistantTopicId }
}

// Create a new forum topic for a session
export async function createSessionTopic(
  bot: Bot,
  chatId: number,
  name: string,
): Promise<number> {
  const topic = await bot.api.createForumTopic(chatId, name)
  return topic.message_thread_id
}

// Rename an existing forum topic
export async function renameSessionTopic(
  bot: Bot,
  chatId: number,
  threadId: number,
  name: string,
): Promise<void> {
  try {
    await bot.api.editForumTopic(chatId, threadId, { name })
  } catch {
    // Ignore rename failures (topic may be closed/deleted)
  }
}

// Delete a forum topic and all its messages
export async function deleteSessionTopic(
  bot: Bot,
  chatId: number,
  threadId: number,
): Promise<void> {
  await bot.api.deleteForumTopic(chatId, threadId);
}

// Build a Telegram deep link to a specific message in a forum topic
export function buildDeepLink(chatId: number, threadId: number, messageId?: number): string {
  // chatId for supergroups starts with -100, need to strip it for the link
  const cleanId = String(chatId).replace('-100', '')
  // For forum groups: c/{chatId}/{threadId}/{messageId} links to a specific message
  // Without messageId: c/{chatId}/{threadId} links to the topic itself
  if (messageId && messageId !== threadId) {
    return `https://t.me/c/${cleanId}/${threadId}/${messageId}`
  }
  return `https://t.me/c/${cleanId}/${threadId}`
}
