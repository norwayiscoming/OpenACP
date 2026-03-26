import * as http from "node:http";
import type { EventBus, EventBusEvents } from "../../core/event-bus.js";

interface SSEResponse extends http.ServerResponse {
  sessionFilter?: string;
}

interface SessionStats {
  active: number;
  total: number;
}

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
    ] as const;

    for (const eventName of events) {
      const handler = (data: unknown) => {
        this.broadcast(eventName, data);
      };
      this.eventBus.on(eventName, handler);
      this.boundHandlers.push({ event: eventName, handler });
    }

    // Health heartbeat every 30s
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
    }, 30_000);
  }

  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsedUrl = new URL(req.url || "", "http://localhost");
    const sessionFilter = parsedUrl.searchParams.get("sessionId");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    // Store filter metadata on the response for broadcast
    (res as SSEResponse).sessionFilter = sessionFilter ?? undefined;

    this.sseConnections.add(res);

    const cleanup = () => {
      this.sseConnections.delete(res);
      this.sseCleanupHandlers.delete(res);
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
