export interface ActivityConfig {
  thinkingRefreshInterval: number
  maxThinkingDuration: number
}

export interface ActivityCallbacks {
  sendThinkingIndicator(): Promise<void>
  updateThinkingIndicator(): Promise<void>
  removeThinkingIndicator(): Promise<void>
}

interface SessionState {
  callbacks: ActivityCallbacks
  refreshTimer?: ReturnType<typeof setInterval>
  startTime: number
  dismissed: boolean
}

export class ActivityTracker {
  private sessions = new Map<string, SessionState>()

  constructor(private config: ActivityConfig) {}

  onThinkingStart(sessionId: string, callbacks: ActivityCallbacks): void {
    this.cleanup(sessionId)

    const state: SessionState = {
      callbacks,
      startTime: Date.now(),
      dismissed: false,
    }
    this.sessions.set(sessionId, state)

    setTimeout(() => {
      if (state.dismissed) return
      callbacks.sendThinkingIndicator().catch(() => {})
      this.startRefresh(sessionId, state)
    }, 0)
  }

  onTextStart(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state || state.dismissed) return
    state.dismissed = true
    this.stopRefresh(state)
    state.callbacks.removeThinkingIndicator().catch(() => {})
  }

  onSessionEnd(sessionId: string): void {
    this.cleanup(sessionId)
  }

  destroy(): void {
    for (const [id] of this.sessions) {
      this.cleanup(id)
    }
  }

  private cleanup(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.dismissed = true
    this.stopRefresh(state)
    this.sessions.delete(sessionId)
  }

  private startRefresh(sessionId: string, state: SessionState): void {
    state.refreshTimer = setInterval(() => {
      if (state.dismissed) {
        this.stopRefresh(state)
        return
      }
      if (Date.now() - state.startTime >= this.config.maxThinkingDuration) {
        this.stopRefresh(state)
        return
      }
      state.callbacks.updateThinkingIndicator().catch(() => {})
    }, this.config.thinkingRefreshInterval)
  }

  private stopRefresh(state: SessionState): void {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer)
      state.refreshTimer = undefined
    }
  }
}
