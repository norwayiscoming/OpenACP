import type { OutgoingMessage } from '../../core/types.js';

export interface SSEEvent {
  event: string;
  id?: string;
  data: unknown;
  sessionId?: string;
  timestamp: string;
}

let eventCounter = 0;

export function generateEventId(): string {
  return `evt_${Date.now()}_${++eventCounter}`;
}

export function serializeSSE(event: string, id: string | undefined, data: unknown): string {
  let result = `event: ${event}\n`;
  if (id) {
    result += `id: ${id}\n`;
  }
  result += `data: ${JSON.stringify(data)}\n\n`;
  return result;
}

export function serializeOutgoingMessage(
  sessionId: string,
  eventId: string,
  message: OutgoingMessage,
): string {
  return serializeSSE('message', eventId, {
    type: message.type,
    sessionId,
    text: message.text,
    metadata: message.metadata,
    timestamp: new Date().toISOString(),
  });
}

export function serializePermissionRequest(
  sessionId: string,
  eventId: string,
  request: { id: string; description: string; options: Array<{ id: string; label: string; isAllow: boolean }> },
): string {
  return serializeSSE('permission_request', eventId, { sessionId, ...request });
}

export function serializeSessionUpdate(
  sessionId: string,
  eventId: string,
  update: { status: string; name?: string },
): string {
  return serializeSSE('session_update', eventId, { sessionId, ...update });
}

export function serializeHeartbeat(): string {
  return serializeSSE('heartbeat', undefined, {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}

export function serializeConnected(connectionId: string, sessionId: string): string {
  return serializeSSE('connected', undefined, {
    connectionId,
    sessionId,
    connectedAt: new Date().toISOString(),
  });
}

export function serializeError(eventId: string, code: string, details?: unknown): string {
  return serializeSSE('error', eventId, { code, ...((details && typeof details === 'object') ? details : {}) });
}
