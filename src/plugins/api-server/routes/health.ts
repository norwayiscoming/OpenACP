import type { Router } from "../router.js";
import type { RouteDeps } from "../api-server.js";

export function registerHealthRoutes(router: Router, deps: RouteDeps): void {
  router.get("/api/health", async (_req, res) => {
    const activeSessions = deps.core.sessionManager.listSessions();
    const allRecords = deps.core.sessionManager.listRecords();
    const mem = process.memoryUsage();
    const tunnel = deps.core.tunnelService;

    deps.sendJson(res, 200, {
      status: "ok",
      uptime: Date.now() - deps.startedAt,
      version: deps.getVersion(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      sessions: {
        active: activeSessions.filter(
          (s) => s.status === "active" || s.status === "initializing",
        ).length,
        total: allRecords.length,
      },
      adapters: Array.from(deps.core.adapters.keys()),
      tunnel: tunnel
        ? { enabled: true, url: tunnel.getPublicUrl() }
        : { enabled: false },
    });
  });

  router.get("/api/version", async (_req, res) => {
    deps.sendJson(res, 200, { version: deps.getVersion() });
  });

  router.post("/api/restart", async (_req, res) => {
    if (!deps.core.requestRestart) {
      deps.sendJson(res, 501, { error: "Restart not available" });
      return;
    }

    deps.sendJson(res, 200, { ok: true, message: "Restarting..." });
    setImmediate(() => deps.core.requestRestart!());
  });

  router.get("/api/adapters", async (_req, res) => {
    const adapters = Array.from(deps.core.adapters.entries()).map(([name]) => ({
      name,
      type: "built-in" as const,
    }));
    deps.sendJson(res, 200, { adapters });
  });
}
