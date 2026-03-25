import type { ToolCallMeta } from '../format-types.js'

export interface TrackedToolCall extends ToolCallMeta {
  messageId: string
}

export class ToolCallTracker {
  private sessions = new Map<string, Map<string, TrackedToolCall>>()

  track(sessionId: string, meta: ToolCallMeta, messageId: string): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map())
    }
    this.sessions.get(sessionId)!.set(meta.id, { ...meta, messageId })
  }

  update(
    sessionId: string,
    toolId: string,
    status: string,
    patch?: Partial<Pick<ToolCallMeta, 'viewerLinks' | 'viewerFilePath' | 'name' | 'kind'>>,
  ): TrackedToolCall | null {
    const tool = this.sessions.get(sessionId)?.get(toolId)
    if (!tool) return null

    tool.status = status
    if (patch?.viewerLinks) tool.viewerLinks = patch.viewerLinks
    if (patch?.viewerFilePath) tool.viewerFilePath = patch.viewerFilePath
    if (patch?.name) tool.name = patch.name
    if (patch?.kind) tool.kind = patch.kind

    return tool
  }

  getActive(sessionId: string): TrackedToolCall[] {
    const session = this.sessions.get(sessionId)
    return session ? [...session.values()] : []
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  clearAll(): void {
    this.sessions.clear()
  }
}
