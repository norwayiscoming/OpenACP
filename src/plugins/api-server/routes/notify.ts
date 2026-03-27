import type { Router } from "../router.js";
import type { RouteDeps } from "../api-server.js";

export function registerNotifyRoutes(router: Router, deps: RouteDeps): void {
  router.post("/api/notify", async (req, res) => {
    const body = await deps.readBody(req);
    let message: string | undefined;
    if (body) {
      try {
        const parsed = JSON.parse(body);
        message = parsed.message;
      } catch {
        deps.sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }
    }

    if (!message) {
      deps.sendJson(res, 400, { error: "Missing message" });
      return;
    }

    await deps.core.notificationManager.notifyAll({
      sessionId: "system",
      type: "completed",
      summary: message,
    });
    deps.sendJson(res, 200, { ok: true });
  });
}
