import type { ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';

export interface SSEConnection {
  id: string;
  sessionId: string;
  tokenId: string;
  response: ServerResponse;
  connectedAt: Date;
  lastEventId?: string;
  backpressured?: boolean;
}

export class ConnectionManager {
  private connections = new Map<string, SSEConnection>();
  private sessionIndex = new Map<string, Set<string>>();
  private maxConnectionsPerSession: number;
  private maxTotalConnections: number;

  constructor(opts?: { maxPerSession?: number; maxTotal?: number }) {
    this.maxConnectionsPerSession = opts?.maxPerSession ?? 10;
    this.maxTotalConnections = opts?.maxTotal ?? 100;
  }

  addConnection(sessionId: string, tokenId: string, response: ServerResponse): SSEConnection {
    // Enforce global connection limit
    if (this.connections.size >= this.maxTotalConnections) {
      throw new Error('Maximum total connections reached');
    }

    // Enforce per-session connection limit
    const sessionConns = this.sessionIndex.get(sessionId);
    if (sessionConns && sessionConns.size >= this.maxConnectionsPerSession) {
      throw new Error('Maximum connections per session reached');
    }

    const id = `conn_${randomBytes(8).toString('hex')}`;
    const connection: SSEConnection = { id, sessionId, tokenId, response, connectedAt: new Date() };

    this.connections.set(id, connection);

    let sessionConnsSet = this.sessionIndex.get(sessionId);
    if (!sessionConnsSet) {
      sessionConnsSet = new Set();
      this.sessionIndex.set(sessionId, sessionConnsSet);
    }
    sessionConnsSet.add(id);

    response.on('close', () => this.removeConnection(id));

    return connection;
  }

  removeConnection(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    this.connections.delete(connectionId);
    const sessionConns = this.sessionIndex.get(conn.sessionId);
    if (sessionConns) {
      sessionConns.delete(connectionId);
      if (sessionConns.size === 0) this.sessionIndex.delete(conn.sessionId);
    }
  }

  getConnectionsBySession(sessionId: string): SSEConnection[] {
    const connIds = this.sessionIndex.get(sessionId);
    if (!connIds) return [];
    return Array.from(connIds)
      .map((id) => this.connections.get(id))
      .filter((c): c is SSEConnection => c !== undefined);
  }

  broadcast(sessionId: string, serializedEvent: string): void {
    for (const conn of this.getConnectionsBySession(sessionId)) {
      if (conn.response.writableEnded) continue;
      try {
        const ok = conn.response.write(serializedEvent);
        if (!ok) {
          if (conn.backpressured) {
            // Still backpressured from previous write — disconnect to prevent OOM
            conn.response.end();
            this.removeConnection(conn.id);
          } else {
            conn.backpressured = true;
            conn.response.once('drain', () => { conn.backpressured = false; });
          }
        }
      } catch {
        // Connection broken — clean up
        this.removeConnection(conn.id);
      }
    }
  }

  disconnectByToken(tokenId: string): void {
    for (const [id, conn] of this.connections) {
      if (conn.tokenId === tokenId) {
        if (!conn.response.writableEnded) conn.response.end();
        this.removeConnection(id);
      }
    }
  }

  listConnections(): SSEConnection[] {
    return Array.from(this.connections.values());
  }

  cleanup(): void {
    for (const [, conn] of this.connections) {
      if (!conn.response.writableEnded) conn.response.end();
    }
    this.connections.clear();
    this.sessionIndex.clear();
  }
}
