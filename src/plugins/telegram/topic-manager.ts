import type { SessionManager } from '../../core/sessions/session-manager.js'
import type { IChannelAdapter } from '../../core/channel.js'
import type { SessionRecord } from '../../core/types.js'
import { createChildLogger } from '../../core/utils/log.js'

const log = createChildLogger({ module: 'topic-manager' })

export interface TopicInfo {
  sessionId: string
  topicId: number | null
  name: string | null
  status: string
  agentName: string
  lastActiveAt: string
}

export interface DeleteTopicResult {
  ok: boolean
  needsConfirmation?: boolean
  topicId?: number | null
  session?: { id: string; name: string | null; status: string }
  error?: string
}

export interface CleanupResult {
  deleted: string[]
  failed: { sessionId: string; error: string }[]
}

interface SystemTopicIds {
  notificationTopicId: number | null
  assistantTopicId: number | null
}

export class TopicManager {
  constructor(
    private sessionManager: SessionManager,
    private adapter: IChannelAdapter | null,
    private systemTopicIds: SystemTopicIds,
  ) {}

  listTopics(filter?: { statuses?: string[] }): TopicInfo[] {
    const records = this.sessionManager.listRecords(filter)
    return records
      .filter(r => !this.isSystemTopic(r))
      .filter(r => !filter?.statuses?.length || filter.statuses.includes(r.status))
      .map(r => ({
        sessionId: r.sessionId,
        topicId: (r.platform as Record<string, unknown>)?.topicId as number ?? null,
        name: r.name ?? null,
        status: r.status,
        agentName: r.agentName,
        lastActiveAt: r.lastActiveAt,
      }))
  }

  async deleteTopic(sessionId: string, options?: { confirmed?: boolean }): Promise<DeleteTopicResult> {
    const records = this.sessionManager.listRecords()
    const record = records.find(r => r.sessionId === sessionId)
    if (!record) return { ok: false, error: 'Session not found' }

    if (this.isSystemTopic(record)) return { ok: false, error: 'Cannot delete system topic' }

    const isActive = record.status === 'active' || record.status === 'initializing'
    if (isActive && !options?.confirmed) {
      return {
        ok: false,
        needsConfirmation: true,
        session: { id: record.sessionId, name: record.name ?? null, status: record.status },
      }
    }

    if (isActive) {
      await this.sessionManager.cancelSession(sessionId)
    }

    const topicId = (record.platform as Record<string, unknown>)?.topicId as number ?? null
    if (this.adapter && topicId) {
      try {
        await this.adapter.deleteSessionThread?.(sessionId)
      } catch (err) {
        log.warn({ err, sessionId, topicId }, 'Failed to delete platform thread, removing record anyway')
      }
    }

    await this.sessionManager.removeRecord(sessionId)
    return { ok: true, topicId }
  }

  async cleanup(statuses?: string[]): Promise<CleanupResult> {
    const targetStatuses = statuses?.length ? statuses : ['finished', 'error', 'cancelled']
    const records = this.sessionManager.listRecords({ statuses: targetStatuses })
    const targets = records
      .filter(r => !this.isSystemTopic(r))
      .filter(r => targetStatuses.includes(r.status))

    const deleted: string[] = []
    const failed: { sessionId: string; error: string }[] = []

    for (const record of targets) {
      try {
        // Cancel active/initializing sessions to prevent orphaned agent processes
        const isActive = record.status === 'active' || record.status === 'initializing'
        if (isActive) {
          await this.sessionManager.cancelSession(record.sessionId)
        }

        const topicId = (record.platform as Record<string, unknown>)?.topicId as number | undefined
        if (this.adapter && topicId) {
          try {
            await this.adapter.deleteSessionThread?.(record.sessionId)
          } catch (err) {
            log.warn({ err, sessionId: record.sessionId }, 'Failed to delete platform thread during cleanup')
          }
        }
        await this.sessionManager.removeRecord(record.sessionId)
        deleted.push(record.sessionId)
      } catch (err) {
        failed.push({ sessionId: record.sessionId, error: err instanceof Error ? err.message : String(err) })
      }
    }

    return { deleted, failed }
  }

  private isSystemTopic(record: SessionRecord): boolean {
    const topicId = (record.platform as Record<string, unknown>)?.topicId as number | undefined
    if (!topicId) return false
    return topicId === this.systemTopicIds.notificationTopicId
      || topicId === this.systemTopicIds.assistantTopicId
  }
}
