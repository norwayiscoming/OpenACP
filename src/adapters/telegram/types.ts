import type { Session } from "../../core/session.js";
import type { ChannelConfig } from "../../core/channel.js";

export interface TelegramChannelConfig extends ChannelConfig {
  botToken: string
  chatId: number
  notificationTopicId: number | null
  assistantTopicId: number | null
}

export interface CommandsAssistantContext {
  topicId: number;
  getSession: () => Session | null;
  respawn: () => Promise<void>;
}
