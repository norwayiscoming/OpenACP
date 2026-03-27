import type { Message, TextChannel, ThreadChannel } from 'discord.js'
import { log } from '../../core/utils/log.js'
import type { AgentCommand } from '../../core/types.js'
import type { SessionManager } from '../../core/sessions/session-manager.js'
import type { DiscordPlatformData } from '../../core/types.js'
import type { SendQueue } from '../../core/adapter-primitives/primitives/send-queue.js'

const DISCORD_MSG_LIMIT = 1900

function buildSkillContent(commands: AgentCommand[]): string {
  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name))
  const header = '**Available Skills**\n'
  const lines = sorted.map((c) => `\`/${c.name}\``)
  let content = header
  for (const line of lines) {
    const candidate = content + '\n' + line
    if (candidate.length > DISCORD_MSG_LIMIT) break
    content = candidate
  }
  return content
}

export class SkillCommandManager {
  private messages: Map<string, Message> = new Map()

  constructor(
    private sendQueue: SendQueue,
    private sessionManager: SessionManager,
  ) {}

  async send(
    sessionId: string,
    thread: TextChannel | ThreadChannel,
    commands: AgentCommand[],
  ): Promise<void> {
    // Restore from persisted platform data if not in memory
    if (!this.messages.has(sessionId)) {
      const record = this.sessionManager.getSessionRecord(sessionId)
      const platform = record?.platform as DiscordPlatformData | undefined
      if (platform?.skillMsgId) {
        try {
          const msg = await thread.messages.fetch(platform.skillMsgId)
          if (msg) this.messages.set(sessionId, msg)
        } catch {
          // Message may no longer exist — will send a new one
        }
      }
    }

    // Empty commands → remove pinned message
    if (commands.length === 0) {
      await this.cleanup(sessionId)
      return
    }

    const content = buildSkillContent(commands)
    const existingMsg = this.messages.get(sessionId)

    if (existingMsg) {
      try {
        await existingMsg.edit({ content })
        return
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('Unknown Message') || msg.includes('10008')) {
          // Message no longer exists — fall through to send a new one
          this.messages.delete(sessionId)
        } else {
          // Transient error or not-modified — just return
          return
        }
      }
    }

    // Send new message and pin it
    try {
      const msg = await this.sendQueue.enqueue(
        () => thread.send({ content }),
        { type: 'other' },
      )

      if (!msg) return

      this.messages.set(sessionId, msg)

      // Persist skillMsgId so it survives restarts
      const record = this.sessionManager.getSessionRecord(sessionId)
      if (record) {
        await this.sessionManager.patchRecord(sessionId, {
          platform: { ...record.platform, skillMsgId: msg.id },
        })
      }

      // Pin the message
      try {
        await msg.pin()
      } catch (err) {
        log.warn({ err, sessionId }, '[SkillCommandManager] Failed to pin skill message')
      }
    } catch (err) {
      log.error({ err, sessionId }, '[SkillCommandManager] Failed to send skill commands')
    }
  }

  async cleanup(sessionId: string): Promise<void> {
    const msg = this.messages.get(sessionId)
    this.messages.delete(sessionId)

    if (msg) {
      try {
        await msg.edit({ content: '*Session ended*' })
        await msg.unpin()
      } catch {
        // Message may already be deleted
      }
    }

    // Clear persisted skillMsgId
    const record = this.sessionManager.getSessionRecord(sessionId)
    if (record) {
      const platform = record.platform
      if (platform && typeof platform === 'object' && 'threadId' in platform) {
        const { skillMsgId: _removed, ...rest } = platform as unknown as DiscordPlatformData
        await this.sessionManager.patchRecord(sessionId, { platform: rest })
      }
    }
  }
}
