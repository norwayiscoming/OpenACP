import type { OutgoingMessage } from "../../core/types.js";
import type { DisplayVerbosity } from "./format-types.js";

export interface MessageHandlers<TCtx = unknown> {
  onText(ctx: TCtx, content: OutgoingMessage): Promise<void>;
  onThought(ctx: TCtx, content: OutgoingMessage): Promise<void>;
  onToolCall(ctx: TCtx, content: OutgoingMessage): Promise<void>;
  onToolUpdate(ctx: TCtx, content: OutgoingMessage): Promise<void>;
  onPlan(ctx: TCtx, content: OutgoingMessage): Promise<void>;
  onUsage(ctx: TCtx, content: OutgoingMessage): Promise<void>;
  onSessionEnd(ctx: TCtx, content: OutgoingMessage): Promise<void>;
  onError(ctx: TCtx, content: OutgoingMessage): Promise<void>;
  onAttachment(ctx: TCtx, content: OutgoingMessage): Promise<void>;
  onSystemMessage(ctx: TCtx, content: OutgoingMessage): Promise<void>;
}

const HIDDEN_ON_LOW: Set<string> = new Set(["thought", "plan", "usage"]);

export function shouldDispatch(
  type: string,
  verbosity: DisplayVerbosity,
): boolean {
  if (verbosity === "low" && HIDDEN_ON_LOW.has(type)) return false;
  return true;
}

export async function dispatchMessage<TCtx>(
  handlers: MessageHandlers<TCtx>,
  ctx: TCtx,
  content: OutgoingMessage,
  verbosity: DisplayVerbosity = "medium",
): Promise<void> {
  if (!shouldDispatch(content.type, verbosity)) return;

  switch (content.type) {
    case "text":
      return handlers.onText(ctx, content);
    case "thought":
      return handlers.onThought(ctx, content);
    case "tool_call":
      return handlers.onToolCall(ctx, content);
    case "tool_update":
      return handlers.onToolUpdate(ctx, content);
    case "plan":
      return handlers.onPlan(ctx, content);
    case "usage":
      return handlers.onUsage(ctx, content);
    case "session_end":
      return handlers.onSessionEnd(ctx, content);
    case "error":
      return handlers.onError(ctx, content);
    case "attachment":
      return handlers.onAttachment(ctx, content);
    case "system_message":
      return handlers.onSystemMessage(ctx, content);
    default:
      return;
  }
}
