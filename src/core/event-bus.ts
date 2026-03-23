import { TypedEmitter } from "./typed-emitter.js";
import type { AgentEvent, PermissionRequest, SessionStatus } from "./types.js";

export interface EventBusEvents {
  "session:created": (data: {
    sessionId: string;
    agent: string;
    status: SessionStatus;
  }) => void;
  "session:updated": (data: {
    sessionId: string;
    status?: SessionStatus;
    name?: string;
    dangerousMode?: boolean;
  }) => void;
  "session:deleted": (data: { sessionId: string }) => void;
  "agent:event": (data: { sessionId: string; event: AgentEvent }) => void;
  "permission:request": (data: {
    sessionId: string;
    permission: PermissionRequest;
  }) => void;
}

export class EventBus extends TypedEmitter<EventBusEvents> {}
