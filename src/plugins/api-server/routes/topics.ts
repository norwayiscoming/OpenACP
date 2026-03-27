import type { Router } from "../router.js";
import type { RouteDeps } from "../api-server.js";

export function registerTopicRoutes(router: Router, deps: RouteDeps): void {
  router.get("/api/topics", async (req, res) => {
    if (!deps.topicManager) {
      deps.sendJson(res, 501, { error: "Topic management not available" });
      return;
    }
    const url = req.url || "";
    const params = new URL(url, "http://localhost").searchParams;
    const statusParam = params.get("status");
    const filter = statusParam
      ? { statuses: statusParam.split(",") }
      : undefined;
    const topics = deps.topicManager.listTopics(filter);
    deps.sendJson(res, 200, { topics });
  });

  router.post("/api/topics/cleanup", async (req, res) => {
    if (!deps.topicManager) {
      deps.sendJson(res, 501, { error: "Topic management not available" });
      return;
    }
    const body = await deps.readBody(req);
    let statuses: string[] | undefined;
    if (body) {
      try {
        statuses = JSON.parse(body).statuses;
      } catch {
        /* use defaults */
      }
    }
    const result = await deps.topicManager.cleanup(statuses);
    deps.sendJson(res, 200, result);
  });

  router.delete("/api/topics/:sessionId", async (req, res, params) => {
    if (!deps.topicManager) {
      deps.sendJson(res, 501, { error: "Topic management not available" });
      return;
    }
    const sessionId = decodeURIComponent(params.sessionId);
    const url = req.url || "";
    const urlParams = new URL(url, "http://localhost").searchParams;
    const force = urlParams.get("force") === "true";
    const result = await deps.topicManager.deleteTopic(
      sessionId,
      force ? { confirmed: true } : undefined,
    );
    if (result.ok) {
      deps.sendJson(res, 200, result);
    } else if (result.needsConfirmation) {
      deps.sendJson(res, 409, {
        error: "Session is active",
        needsConfirmation: true,
        session: result.session,
      });
    } else if (result.error === "Cannot delete system topic") {
      deps.sendJson(res, 403, { error: result.error });
    } else {
      deps.sendJson(res, 404, { error: result.error ?? "Not found" });
    }
  });
}
