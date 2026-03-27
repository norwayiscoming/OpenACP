import type { Router } from "../router.js";
import type { RouteDeps } from "../api-server.js";

export function registerTunnelRoutes(router: Router, deps: RouteDeps): void {
  router.get("/api/tunnel", async (_req, res) => {
    const tunnel = deps.core.tunnelService;
    if (tunnel) {
      deps.sendJson(res, 200, {
        enabled: true,
        url: tunnel.getPublicUrl(),
        provider: deps.core.configManager.get().tunnel.provider,
      });
    } else {
      deps.sendJson(res, 200, { enabled: false });
    }
  });

  router.get("/api/tunnel/list", async (_req, res) => {
    const tunnel = deps.core.tunnelService;
    if (!tunnel) {
      deps.sendJson(res, 200, []);
      return;
    }
    deps.sendJson(res, 200, tunnel.listTunnels());
  });

  router.post("/api/tunnel", async (req, res) => {
    const tunnel = deps.core.tunnelService;
    if (!tunnel) {
      deps.sendJson(res, 400, { error: "Tunnel service is not enabled" });
      return;
    }
    const body = await deps.readBody(req);
    if (body === null) {
      deps.sendJson(res, 413, { error: "Request body too large" });
      return;
    }
    if (!body) {
      deps.sendJson(res, 400, { error: "Missing request body" });
      return;
    }
    try {
      const { port, label, sessionId } = JSON.parse(body);
      if (!port || typeof port !== "number") {
        deps.sendJson(res, 400, {
          error: "port is required and must be a number",
        });
        return;
      }
      const entry = await tunnel.addTunnel(port, { label, sessionId });
      deps.sendJson(res, 200, entry);
    } catch (err) {
      deps.sendJson(res, 400, { error: (err as Error).message });
    }
  });

  router.delete("/api/tunnel/:port", async (_req, res, params) => {
    const tunnel = deps.core.tunnelService;
    if (!tunnel) {
      deps.sendJson(res, 400, { error: "Tunnel service is not enabled" });
      return;
    }
    const port = parseInt(params.port, 10);
    try {
      await tunnel.stopTunnel(port);
      deps.sendJson(res, 200, { ok: true });
    } catch (err) {
      deps.sendJson(res, 400, { error: (err as Error).message });
    }
  });

  router.delete("/api/tunnel", async (_req, res) => {
    const tunnel = deps.core.tunnelService;
    if (!tunnel) {
      deps.sendJson(res, 400, { error: "Tunnel service is not enabled" });
      return;
    }
    const count = tunnel.listTunnels().length;
    await tunnel.stopAllUser();
    deps.sendJson(res, 200, { ok: true, stopped: count });
  });
}
