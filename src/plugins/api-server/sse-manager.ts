import * as http from "node:http";
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { EventBus, EventBusEvents } from "../../core/event-bus.js";

interface SSEResponse extends http.ServerResponse {
  sessionFilter?: string;
}

interface SessionStats {
  active: number;
  total: number;
}

// Maximum concurrent SSE connections. Beyond this the server returns 503 to
// prevent resource exhaustion (file-descriptor / memory DoS) from a single
// attacker opening many persistent connections via the public tunnel.
const MAX_SSE_CONNECTIONS = 50;

export class SSEManager {
  private sseConnections = new Set<http.ServerResponse>();
  private sseCleanupHandlers = new Map<http.ServerResponse, () => void>();
  private healthInterval?: ReturnType<typeof setInterval>;
  private boundHandlers: Array<{
    event: keyof EventBusEvents;
    handler: (data: unknown) => void;
  }> = [];

  constructor(
    private eventBus: EventBus | undefined,
    private getSessionStats: () => SessionStats,
    private startedAt: number,
  ) {}

  setup(): void {
    if (!this.eventBus) return;

    const events = [
      "session:created",
      "session:updated",
      "session:deleted",
      "agent:event",
      "permission:request",
      "message:queued",
      "message:processing",
    ] as const;

    for (const eventName of events) {
      const handler = (data: unknown) => {
        this.broadcast(eventName, data);
      };
      this.eventBus.on(eventName, handler);
      this.boundHandlers.push({ event: eventName, handler });
    }

    // Health heartbeat every 15s
    this.healthInterval = setInterval(() => {
      const mem = process.memoryUsage();
      const stats = this.getSessionStats();
      this.broadcast("health", {
        uptime: Date.now() - this.startedAt,
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
        },
        sessions: stats,
      });
    }, 15_000);
  }

  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (this.sseConnections.size >= MAX_SSE_CONNECTIONS) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Too many SSE connections" }));
      return;
    }

    const parsedUrl = new URL(req.url || "", "http://localhost");
    const sessionFilter = parsedUrl.searchParams.get("sessionId");
    console.log(`[sse] +connection total=${this.sseConnections.size + 1}`);

    const origin = req.headers.origin;
    const corsHeaders: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable buffering in Nginx/Cloudflare/other reverse proxies
      "X-Accel-Buffering": "no",
    };
    // SSE is authenticated via Bearer/query token — no credentials (cookies) involved,
    // so Access-Control-Allow-Credentials is not needed and must not be set alongside
    // a reflected origin (that combination is a known CORS misconfiguration).
    if (origin) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
    }
    // Disable Nagle's algorithm so small SSE chunks are sent immediately
    res.socket?.setNoDelay(true);
    res.writeHead(200, corsHeaders);
    res.flushHeaders();
    // Send initial comment immediately so proxies (Cloudflare, nginx) flush headers to client
    res.write(': connected\n\n');

    // Store filter metadata on the response for broadcast
    (res as SSEResponse).sessionFilter = sessionFilter ?? undefined;

    this.sseConnections.add(res);

    const cleanup = () => {
      this.sseConnections.delete(res);
      this.sseCleanupHandlers.delete(res);
      console.log(`[sse] -connection remaining=${this.sseConnections.size}`);
    };
    this.sseCleanupHandlers.set(res, cleanup);
    req.on("close", cleanup);
  }

  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    // Events that carry sessionId and should be filtered
    const sessionEvents = [
      "agent:event",
      "permission:request",
      "session:updated",
      "message:queued",
      "message:processing",
    ];
    for (const res of this.sseConnections) {
      const filter = (res as SSEResponse).sessionFilter;
      if (filter && sessionEvents.includes(event)) {
        const eventData = data as { sessionId: string };
        if (eventData.sessionId !== filter) continue;
      }
      try {
        if (res.writable) res.write(payload);
      } catch {
        /* connection closed */
      }
    }
  }

  /**
   * Returns a Fastify route handler that hijacks the response
   * and delegates to the raw http SSE handler.
   */
  createFastifyHandler() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      reply.hijack();
      this.handleRequest(request.raw, reply.raw);
    };
  }

  stop(): void {
    if (this.healthInterval) clearInterval(this.healthInterval);

    // Remove only our own event bus listeners
    if (this.eventBus) {
      for (const { event, handler } of this.boundHandlers) {
        this.eventBus.off(event, handler);
      }
    }
    this.boundHandlers = [];

    // Copy to avoid modifying Map while iterating
    const entries = [...this.sseCleanupHandlers];
    for (const [res, cleanup] of entries) {
      res.end();
      cleanup();
    }
  }
}

export type { SessionStats };
