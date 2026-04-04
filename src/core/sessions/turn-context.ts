import { nanoid } from "nanoid";
import type { AgentEvent } from "../types.js";

export interface TurnContext {
  turnId: string;
  sourceAdapterId: string;
  responseAdapterId?: string | null; // null = silent, undefined = use sourceAdapterId
}

export interface TurnRouting {
  sourceAdapterId: string;
  responseAdapterId?: string | null;
}

/**
 * Create a new TurnContext. Called when a prompt is dequeued from the queue.
 * If a pre-generated turnId is provided (from enqueuePrompt), it is used; otherwise a new one is generated.
 */
export function createTurnContext(
  sourceAdapterId: string,
  responseAdapterId?: string | null,
  turnId?: string,
): TurnContext {
  return {
    turnId: turnId ?? nanoid(8),
    sourceAdapterId,
    responseAdapterId,
  };
}

/**
 * Get the effective response adapter for a turn.
 * - null → silent (no adapter renders)
 * - undefined → fallback to sourceAdapterId
 * - string → explicit target
 */
export function getEffectiveTarget(ctx: TurnContext): string | null {
  if (ctx.responseAdapterId === null) return null;
  return ctx.responseAdapterId ?? ctx.sourceAdapterId;
}

/**
 * System events are broadcast to ALL attached adapters.
 * Turn events are routed only to the response adapter.
 */
const SYSTEM_EVENT_TYPES = new Set([
  "session_end",
  "system_message",
  "session_info_update",
  "config_option_update",
  "commands_update",
  "tts_strip",
]);

export function isSystemEvent(event: AgentEvent): boolean {
  return SYSTEM_EVENT_TYPES.has(event.type);
}
