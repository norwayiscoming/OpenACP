import type { AgentEvent, Attachment } from "../../../core/types.js";
import type { HistoryStore } from "./history-store.js";
import type {
  HistoryAttachment,
  ResourceLinkStep,
  ResourceStep,
  SessionHistory,
  Step,
  ToolCallStep,
  Turn,
} from "./types.js";

export interface RecorderState {
  history: SessionHistory;
  currentAssistantTurn: Turn | null;
}

function toHistoryAttachment(att: Attachment): HistoryAttachment {
  return {
    type: att.type,
    fileName: att.fileName,
    mimeType: att.mimeType,
    size: att.size,
  };
}

function extractDiff(
  content: unknown,
): { path: string; oldText?: string; newText: string } | null {
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (
      item &&
      typeof item === "object" &&
      (item as Record<string, unknown>).type === "diff"
    ) {
      const d = item as Record<string, unknown>;
      if (typeof d.path === "string" && typeof d.newText === "string") {
        const result: { path: string; oldText?: string; newText: string } = {
          path: d.path,
          newText: d.newText,
        };
        if (typeof d.oldText === "string") result.oldText = d.oldText;
        return result;
      }
    }
  }
  return null;
}

function extractLocations(
  locations: unknown,
): { path: string; line?: number }[] | undefined {
  if (!Array.isArray(locations)) return undefined;
  const result: { path: string; line?: number }[] = [];
  for (const loc of locations) {
    if (loc && typeof loc === "object" && typeof (loc as any).path === "string") {
      const entry: { path: string; line?: number } = { path: (loc as any).path };
      if (typeof (loc as any).line === "number") entry.line = (loc as any).line;
      result.push(entry);
    }
  }
  return result.length > 0 ? result : undefined;
}

const IGNORED_TYPES = new Set([
  "session_end",
  "error",
  "system_message",
  "commands_update",
  "session_info_update",
  "model_update",
  "user_message_chunk",
  "tts_strip",
]);

export class HistoryRecorder {
  private states = new Map<string, RecorderState>();

  constructor(private readonly store: HistoryStore) {}

  onBeforePrompt(
    sessionId: string,
    text: string,
    attachments: Attachment[] | undefined,
  ): void {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        history: { version: 1, sessionId, turns: [] },
        currentAssistantTurn: null,
      };
      this.states.set(sessionId, state);
    }

    const userTurn: Turn = {
      index: state.history.turns.length,
      role: "user",
      timestamp: new Date().toISOString(),
      content: text,
    };
    if (attachments && attachments.length > 0) {
      userTurn.attachments = attachments.map(toHistoryAttachment);
    }
    state.history.turns.push(userTurn);

    const assistantTurn: Turn = {
      index: state.history.turns.length,
      role: "assistant",
      timestamp: new Date().toISOString(),
      steps: [],
    };
    state.history.turns.push(assistantTurn);
    state.currentAssistantTurn = assistantTurn;
  }

  onAfterEvent(sessionId: string, event: AgentEvent): void {
    const state = this.states.get(sessionId);
    if (!state || !state.currentAssistantTurn) return;

    const turn = state.currentAssistantTurn;
    const steps = turn.steps!;

    if (IGNORED_TYPES.has(event.type)) return;

    switch (event.type) {
      case "text": {
        const last = steps[steps.length - 1];
        if (last && last.type === "text") {
          last.content += event.content;
        } else {
          steps.push({ type: "text", content: event.content });
        }
        break;
      }

      case "thought": {
        const last = steps[steps.length - 1];
        if (last && last.type === "thinking") {
          last.content += event.content;
        } else {
          steps.push({ type: "thinking", content: event.content });
        }
        break;
      }

      case "tool_call": {
        const step: ToolCallStep = {
          type: "tool_call",
          id: event.id,
          name: event.name,
          status: event.status,
        };
        if (event.kind) step.kind = event.kind;
        steps.push(step);
        break;
      }

      case "tool_update": {
        const existing = this.findToolCall(steps, event.id);
        if (!existing) break;
        existing.status = event.status;
        if (event.rawInput !== undefined) existing.input = event.rawInput;
        if (event.rawOutput !== undefined) existing.output = event.rawOutput;
        if (event.content !== undefined) {
          const diff = extractDiff(event.content);
          if (diff) existing.diff = diff;
        }
        if (event.locations !== undefined) {
          const locs = extractLocations(event.locations);
          if (locs) existing.locations = locs;
        }
        break;
      }

      case "plan": {
        steps.push({
          type: "plan",
          entries: event.entries.map((e) => ({
            content: e.content,
            priority: e.priority,
            status: e.status,
          })),
        });
        break;
      }

      case "usage": {
        turn.usage = {};
        if (event.tokensUsed !== undefined) turn.usage.tokensUsed = event.tokensUsed;
        if (event.contextSize !== undefined) turn.usage.contextSize = event.contextSize;
        if (event.cost) turn.usage.cost = event.cost;
        break;
      }

      case "image_content": {
        steps.push({
          type: "image",
          mimeType: event.mimeType,
          filePath: "",
        });
        break;
      }

      case "audio_content": {
        steps.push({
          type: "audio",
          mimeType: event.mimeType,
          filePath: "",
        });
        break;
      }

      case "resource_content": {
        const step: ResourceStep = {
          type: "resource",
          uri: event.uri,
          name: event.name,
        };
        if (event.text !== undefined) step.text = event.text;
        steps.push(step);
        break;
      }

      case "resource_link": {
        const step: ResourceLinkStep = {
          type: "resource_link",
          uri: event.uri,
          name: event.name,
        };
        if (event.title !== undefined) step.title = event.title;
        if (event.description !== undefined)
          step.description = event.description;
        steps.push(step);
        break;
      }

      case "config_option_update": {
        for (const opt of event.options) {
          steps.push({
            type: "config_change",
            configId: opt.id,
            value: String(opt.currentValue),
          });
        }
        break;
      }
    }
  }

  onPermissionResolved(
    sessionId: string,
    requestId: string,
    decision: string,
  ): void {
    const state = this.states.get(sessionId);
    if (!state || !state.currentAssistantTurn) return;
    const step = this.findToolCall(state.currentAssistantTurn.steps!, requestId);
    if (!step) return;
    step.permission = { requested: true, outcome: decision };
  }

  async onTurnEnd(sessionId: string, stopReason: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state || !state.currentAssistantTurn) return;
    state.currentAssistantTurn.stopReason = stopReason;
    state.currentAssistantTurn = null;
    await this.store.write(state.history);
  }

  finalize(sessionId: string): void {
    this.states.delete(sessionId);
  }

  getState(sessionId: string): RecorderState | undefined {
    return this.states.get(sessionId);
  }

  private findToolCall(steps: Step[], id: string): ToolCallStep | undefined {
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (s.type === "tool_call" && s.id === id) return s;
    }
    return undefined;
  }
}
