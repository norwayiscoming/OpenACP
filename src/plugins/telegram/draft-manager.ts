import type { Bot } from "grammy";
import { MessageDraft } from "./streaming.js";
import type { SendQueue } from "../../core/adapter-primitives/primitives/send-queue.js";
import type { DebugTracer } from "../../core/utils/debug-tracer.js";

interface FinalizedDraft {
  messageId: number;
  draft: MessageDraft;
}

export class DraftManager {
  private drafts: Map<string, MessageDraft> = new Map();
  private textBuffers: Map<string, string> = new Map();
  private finalizedDrafts: Map<string, FinalizedDraft> = new Map();

  constructor(
    private bot: Bot,
    private chatId: number,
    private sendQueue: SendQueue,
  ) {}

  getOrCreate(sessionId: string, threadId: number, tracer: DebugTracer | null = null): MessageDraft {
    let draft = this.drafts.get(sessionId);
    if (!draft) {
      draft = new MessageDraft(
        this.bot,
        this.chatId,
        threadId,
        this.sendQueue,
        sessionId,
        tracer,
      );
      this.drafts.set(sessionId, draft);
    }
    return draft;
  }

  hasDraft(sessionId: string): boolean {
    return this.drafts.has(sessionId);
  }

  getDraft(sessionId: string): MessageDraft | undefined {
    return this.drafts.get(sessionId);
  }

  appendText(sessionId: string, text: string): void {
    this.textBuffers.set(
      sessionId,
      (this.textBuffers.get(sessionId) ?? "") + text,
    );
  }

  /**
   * Finalize the current draft and return the message ID.
   */
  async finalize(
    sessionId: string,
    _assistantSessionId?: string,
  ): Promise<void> {
    const draft = this.drafts.get(sessionId);
    if (!draft) return;

    // Delete BEFORE awaiting to prevent concurrent finalizeDraft() calls
    // from double-finalizing the same draft
    this.drafts.delete(sessionId);
    const finalMsgId = await draft.finalize();

    // Keep finalized draft reference so tts_strip can edit after finalization
    if (finalMsgId) {
      this.finalizedDrafts.set(sessionId, { messageId: finalMsgId, draft });
    }

    this.textBuffers.delete(sessionId);
  }

  /**
   * Strip a regex pattern from the active or finalized draft for a session.
   * Used by tts_strip to remove [TTS]...[/TTS] blocks after TTS audio is sent.
   */
  async stripPattern(sessionId: string, pattern: RegExp): Promise<void> {
    const draft = this.drafts.get(sessionId);
    if (draft) {
      await draft.stripPattern(pattern);
      return;
    }
    const finalized = this.finalizedDrafts.get(sessionId);
    if (finalized) {
      await finalized.draft.stripPattern(pattern);
    }
    // If no draft found (e.g., TTS synthesis slower than next prompt cycle), the
    // [TTS] block will remain visible. This is a rare edge case — log for debugging.
  }

  cleanup(sessionId: string): void {
    this.drafts.delete(sessionId);
    this.textBuffers.delete(sessionId);
    this.finalizedDrafts.delete(sessionId);
  }
}
