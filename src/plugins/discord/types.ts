import type { Session } from '../../core/sessions/session.js'

export interface DiscordChannelConfig {
  enabled: boolean
  botToken: string
  guildId: string
  forumChannelId: string | null
  notificationChannelId: string | null
  assistantThreadId: string | null
  [key: string]: unknown
}

export interface CommandsAssistantContext {
  threadId: string
  getSession: () => Session | null
  respawn: () => Promise<void>
}
