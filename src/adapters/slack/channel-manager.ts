// src/adapters/slack/channel-manager.ts
import type { ISlackSendQueue } from "./send-queue.js";
import { toSlug } from "./slug.js";
import type { SlackSessionMeta } from "./types.js";
import type { SlackChannelConfig } from "./types.js";

export interface ISlackChannelManager {
  createChannel(sessionId: string, sessionName: string): Promise<SlackSessionMeta>;
  archiveChannel(channelId: string): Promise<void>;
  notifyChannel(channelId: string, text: string): Promise<void>;
}

export class SlackChannelManager implements ISlackChannelManager {
  constructor(
    private queue: ISlackSendQueue,
    private config: SlackChannelConfig,
  ) {}

  async createChannel(sessionId: string, sessionName: string): Promise<SlackSessionMeta> {
    const slug = toSlug(sessionName, this.config.channelPrefix ?? "openacp");

    const res = await this.queue.enqueue<{ channel: { id: string } }>(
      "conversations.create",
      { name: slug, is_private: false }
    );
    const channelId = res.channel.id;

    // Invite bot if needed (no-op in Socket Mode — bot is already in workspace)
    // Join the newly created channel
    await this.queue.enqueue("conversations.join", { channel: channelId });

    return { channelId, channelSlug: slug };
  }

  async archiveChannel(channelId: string): Promise<void> {
    await this.queue.enqueue("conversations.archive", { channel: channelId });
  }

  async notifyChannel(channelId: string, text: string): Promise<void> {
    if (this.config.notificationChannelId) {
      await this.queue.enqueue("chat.postMessage", {
        channel: this.config.notificationChannelId,
        text,
      });
    }
  }
}
