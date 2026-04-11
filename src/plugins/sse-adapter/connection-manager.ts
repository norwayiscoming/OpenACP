import type { ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * Represents a single active SSE connection from a web client.
 *
 * `tokenId` is the auth token that opened this connection — used to forcibly
 * disconnect all connections when a token is revoked.
 * `lastEventId` tracks the most recent event delivered, for reconnection replay.
 * `backpressured` indicates that the last `response.write()` returned false,
 * meaning the OS send buffer is full.
 * `userId` is set for user-level connections not tied to a specific session.
 */
export interface SSEConnection {
  id: string;
  sessionId: string;
  tokenId: string;
  userId?: string;  // Set for user-level connections
  response: ServerResponse;
  connectedAt: Date;
  lastEventId?: string;
  backpressured?: boolean;
}

/**
 * Tracks all active SSE connections and provides session-scoped broadcast.
 *
 * Connections are indexed both globally (by connection ID) and by session ID
 * so that `broadcast` can efficiently reach only the connections for a given session
 * without scanning the entire connection set.
 *
 * Limits are enforced to prevent resource exhaustion:
 * - Per-session limit prevents a single session from consuming all file descriptors.
 * - Global limit caps total memory and FD usage regardless of distribution.
 */
export class ConnectionManager {
  private connections = new Map<string, SSEConnection>();
  // Secondary index: sessionId → Set of connection IDs for O(1) broadcast targeting
  private sessionIndex = new Map<string, Set<string>>();
  // Secondary index: userId → Set of connection IDs for user-level event delivery
  private userIndex = new Map<string, Set<string>>();
  private maxConnectionsPerSession: number;
  private maxTotalConnections: number;

  constructor(opts?: { maxPerSession?: number; maxTotal?: number }) {
    this.maxConnectionsPerSession = opts?.maxPerSession ?? 10;
    this.maxTotalConnections = opts?.maxTotal ?? 100;
  }

  /**
   * Registers a new SSE connection for the given session.
   *
   * Wires a `close` listener on the response so the connection is automatically
   * removed when the client disconnects (browser tab closed, network drop, etc.).
   *
   * @throws if the global or per-session connection limit is reached.
   */
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

  /**
   * Registers a user-level SSE connection (not tied to a specific session).
   * Used for notifications and system events delivered to a user.
   *
   * @throws if the global connection limit is reached.
   */
  addUserConnection(userId: string, tokenId: string, response: ServerResponse): SSEConnection {
    if (this.connections.size >= this.maxTotalConnections) {
      throw new Error('Maximum total connections reached');
    }

    const id = `conn_${randomBytes(8).toString('hex')}`;
    const connection: SSEConnection = {
      id, sessionId: '', tokenId, userId, response, connectedAt: new Date()
    };

    this.connections.set(id, connection);

    let userConns = this.userIndex.get(userId);
    if (!userConns) {
      userConns = new Set();
      this.userIndex.set(userId, userConns);
    }
    userConns.add(id);

    response.on('close', () => this.removeConnection(id));
    return connection;
  }

  /**
   * Writes a serialized SSE event to all connections for a given user.
   *
   * Uses the same backpressure strategy as `broadcast`: flag on first overflow,
   * forcibly close if still backpressured on the next write.
   */
  pushToUser(userId: string, serializedEvent: string): void {
    const connIds = this.userIndex.get(userId);
    if (!connIds) return;
    for (const connId of connIds) {
      const conn = this.connections.get(connId);
      if (!conn || conn.response.writableEnded) continue;
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

  /** Remove a connection from all indexes. Called automatically on client disconnect. */
  removeConnection(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    this.connections.delete(connectionId);
    const sessionConns = this.sessionIndex.get(conn.sessionId);
    if (sessionConns) {
      sessionConns.delete(connectionId);
      if (sessionConns.size === 0) this.sessionIndex.delete(conn.sessionId);
    }
    // Clean user index
    if (conn.userId) {
      const userConns = this.userIndex.get(conn.userId);
      if (userConns) {
        userConns.delete(connectionId);
        if (userConns.size === 0) this.userIndex.delete(conn.userId);
      }
    }
  }

  /** Returns all active connections for a session. */
  getConnectionsBySession(sessionId: string): SSEConnection[] {
    const connIds = this.sessionIndex.get(sessionId);
    if (!connIds) return [];
    return Array.from(connIds)
      .map((id) => this.connections.get(id))
      .filter((c): c is SSEConnection => c !== undefined);
  }

  /**
   * Writes a serialized SSE event to all connections for the given session.
   *
   * Backpressure handling: if `response.write()` returns false (OS send buffer full),
   * the connection is flagged as `backpressured`. On the next write attempt, if it is
   * still backpressured, the connection is forcibly closed to prevent unbounded memory
   * growth from queuing writes on a slow or stalled client.
   */
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

  /**
   * Force-close all connections associated with a given auth token.
   * Called when a token is revoked to immediately terminate those streams.
   */
  disconnectByToken(tokenId: string): void {
    for (const [id, conn] of this.connections) {
      if (conn.tokenId === tokenId) {
        if (!conn.response.writableEnded) conn.response.end();
        this.removeConnection(id);
      }
    }
  }

  /** Returns a snapshot of all active connections (used by the admin endpoint). */
  listConnections(): SSEConnection[] {
    return Array.from(this.connections.values());
  }

  /** Close all connections and clear all indexes. Called on plugin teardown. */
  cleanup(): void {
    for (const [, conn] of this.connections) {
      if (!conn.response.writableEnded) conn.response.end();
    }
    this.connections.clear();
    this.sessionIndex.clear();
    this.userIndex.clear();
  }
}
