export interface DraftConfig {
  flushInterval: number
  maxLength: number
  onFlush: (sessionId: string, text: string, isEdit: boolean) => Promise<string | undefined>
  onError?: (sessionId: string, error: Error) => void
}

export class Draft {
  private buffer = ''
  private _messageId?: string
  private firstFlushPending = false
  private flushTimer?: ReturnType<typeof setTimeout>
  private flushPromise: Promise<void> = Promise.resolve()

  constructor(
    private sessionId: string,
    private config: DraftConfig,
  ) {}

  get isEmpty(): boolean { return !this.buffer }
  get messageId(): string | undefined { return this._messageId }

  append(text: string): void {
    if (!text) return
    this.buffer += text
    this.scheduleFlush()
  }

  async finalize(): Promise<string | undefined> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    await this.flushPromise
    if (this.buffer) {
      await this.flush()
    }
    return this._messageId
  }

  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    this.buffer = ''
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flushPromise = this.flushPromise
        .then(() => this.flush())
        .catch(() => {})
    }, this.config.flushInterval)
  }

  private async flush(): Promise<void> {
    if (!this.buffer || this.firstFlushPending) return

    const snapshot = this.buffer
    const isEdit = !!this._messageId

    if (!this._messageId) {
      this.firstFlushPending = true
    }

    try {
      const result = await this.config.onFlush(this.sessionId, snapshot, isEdit)
      if (!isEdit && result) {
        this._messageId = result
      }
    } catch (err) {
      this.config.onError?.(this.sessionId, err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.firstFlushPending = false
    }
  }
}

export class DraftManager {
  private drafts = new Map<string, Draft>()

  constructor(private config: DraftConfig) {}

  getOrCreate(sessionId: string): Draft {
    let draft = this.drafts.get(sessionId)
    if (!draft) {
      draft = new Draft(sessionId, this.config)
      this.drafts.set(sessionId, draft)
    }
    return draft
  }

  async finalize(sessionId: string): Promise<void> {
    const draft = this.drafts.get(sessionId)
    if (!draft) return
    await draft.finalize()
    this.drafts.delete(sessionId)
  }

  async finalizeAll(): Promise<void> {
    await Promise.all([...this.drafts.values()].map(d => d.finalize()))
  }

  destroy(sessionId: string): void {
    const draft = this.drafts.get(sessionId)
    if (draft) {
      draft.destroy()
      this.drafts.delete(sessionId)
    }
  }

  destroyAll(): void {
    for (const draft of this.drafts.values()) {
      draft.destroy()
    }
    this.drafts.clear()
  }
}
