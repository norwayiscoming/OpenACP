import type { IChannelAdapter, AdapterCapabilities } from '../../core/channel.js';
import type { OutgoingMessage, PermissionRequest, NotificationMessage } from '../../core/types.js';
import type { ConnectionManager } from './connection-manager.js';
import type { EventBuffer } from './event-buffer.js';
import {
  generateEventId,
  serializeOutgoingMessage,
  serializePermissionRequest,
  serializeHeartbeat,
} from './event-serializer.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

export class SSEAdapter implements IChannelAdapter {
  readonly name = 'sse';
  readonly capabilities: AdapterCapabilities = {
    streaming: true,
    richFormatting: false,
    threads: true,
    reactions: false,
    fileUpload: false,
    voice: false,
  };

  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly eventBuffer: EventBuffer,
  ) {}

  async start(): Promise<void> {
    this.heartbeatTimer = setInterval(() => {
      const heartbeat = serializeHeartbeat();
      for (const conn of this.connectionManager.listConnections()) {
        if (!conn.response.writableEnded) {
          try { conn.response.write(heartbeat); } catch { /* closed */ }
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    if (typeof this.heartbeatTimer === 'object' && 'unref' in this.heartbeatTimer) {
      (this.heartbeatTimer as NodeJS.Timeout).unref();
    }
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.connectionManager.cleanup();
  }

  async sendMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
    const eventId = generateEventId();
    const serialized = serializeOutgoingMessage(sessionId, eventId, content);
    this.eventBuffer.push(sessionId, { id: eventId, data: serialized });
    this.connectionManager.broadcast(sessionId, serialized);
  }

  async sendPermissionRequest(sessionId: string, request: PermissionRequest): Promise<void> {
    const eventId = generateEventId();
    const serialized = serializePermissionRequest(sessionId, eventId, request);
    this.eventBuffer.push(sessionId, { id: eventId, data: serialized });
    this.connectionManager.broadcast(sessionId, serialized);
  }

  async sendNotification(notification: NotificationMessage): Promise<void> {
    // Notifications include a sessionId — broadcast to that session's connections if any exist
    if (notification.sessionId) {
      const connections = this.connectionManager.getConnectionsBySession(notification.sessionId);
      if (connections.length > 0) {
        const eventId = generateEventId();
        const { serializeSSE } = await import('./event-serializer.js');
        const serialized = serializeSSE('notification', eventId, notification);
        this.connectionManager.broadcast(notification.sessionId, serialized);
      }
    }
  }

  async createSessionThread(sessionId: string, _name: string): Promise<string> {
    // SSE has no concept of threads — return sessionId as the threadId
    return sessionId;
  }

  async renameSessionThread(_sessionId: string, _newName: string): Promise<void> {
    // No-op for SSE
  }
}
