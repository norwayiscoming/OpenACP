import { TypedEmitter } from "./utils/typed-emitter.js";
import type { AgentEvent, PermissionRequest, SessionStatus, UsageRecordEvent } from "./types.js";

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
    clientOverrides?: { bypassPermissions?: boolean };
  }) => void;
  "session:deleted": (data: { sessionId: string }) => void;
  "agent:event": (data: { sessionId: string; event: AgentEvent }) => void;
  "permission:request": (data: {
    sessionId: string;
    permission: PermissionRequest;
  }) => void;
  "permission:resolved": (data: {
    sessionId: string;
    requestId: string;
    decision: string;
  }) => void;

  // System lifecycle
  "kernel:booted": () => void;
  "system:ready": () => void;
  "system:shutdown": () => void;
  "system:commands-ready": (data: {
    commands: Array<{ name: string; description: string }>;
  }) => void;

  // Plugin lifecycle
  "plugin:loaded": (data: { name: string; version: string }) => void;
  "plugin:failed": (data: { name: string; error: string }) => void;
  "plugin:disabled": (data: { name: string; reason: string }) => void;
  "plugin:unloaded": (data: { name: string }) => void;

  // Session (additional)
  "session:ended": (data: { sessionId: string; reason: string }) => void;
  "session:named": (data: { sessionId: string; name: string }) => void;

  // Agent (additional)
  "agent:prompt": (data: {
    sessionId: string;
    text: string;
    attachments?: unknown[];
  }) => void;

  // Usage tracking (consumed by usage plugin)
  "usage:recorded": (data: UsageRecordEvent) => void;

  // Emitted after a new session thread is created and bridge connected
  "session:threadReady": (data: { sessionId: string; channelId: string; threadId: string }) => void;

  // Config changed (used by adapters to update control messages)
  "session:configChanged": (data: { sessionId: string }) => void;

  // Agent switch lifecycle (used by UI & dashboards)
  "session:agentSwitch": (data: {
    sessionId: string;
    fromAgent: string;
    toAgent: string;
    status: "starting" | "succeeded" | "failed";
    resumed?: boolean;
    error?: string;
  }) => void;
}

export class EventBus extends TypedEmitter<EventBusEvents> {}
