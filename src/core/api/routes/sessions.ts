import type { Router } from "../router.js";
import type { RouteDeps } from "../index.js";
import { createChildLogger } from "../../log.js";

const log = createChildLogger({ module: "api-server" });

export function registerSessionRoutes(router: Router, deps: RouteDeps): void {
  router.post("/api/sessions/adopt", async (req, res) => {
    const body = await deps.readBody(req);
    if (body === null) {
      return deps.sendJson(res, 413, { error: "Request body too large" });
    }
    if (!body) {
      return deps.sendJson(res, 400, {
        error: "bad_request",
        message: "Empty request body",
      });
    }

    let parsed: { agent?: string; agentSessionId?: string; cwd?: string; channel?: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      return deps.sendJson(res, 400, {
        error: "bad_request",
        message: "Invalid JSON",
      });
    }

    const { agent, agentSessionId, cwd, channel } = parsed;

    if (!agent || !agentSessionId) {
      return deps.sendJson(res, 400, {
        error: "bad_request",
        message: "Missing required fields: agent, agentSessionId",
      });
    }

    const result = await deps.core.adoptSession(
      agent,
      agentSessionId,
      cwd ?? process.cwd(),
      channel,
    );

    if (result.ok) {
      return deps.sendJson(res, 200, result);
    } else {
      const status =
        result.error === "session_limit"
          ? 429
          : result.error === "agent_not_supported"
            ? 400
            : 500;
      return deps.sendJson(res, status, result);
    }
  });

  router.post("/api/sessions", async (req, res) => {
    const body = await deps.readBody(req);
    let agent: string | undefined;
    let workspace: string | undefined;

    if (body) {
      try {
        const parsed = JSON.parse(body);
        agent = parsed.agent;
        workspace = parsed.workspace;
      } catch {
        deps.sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }
    }

    // Check max concurrent sessions
    const config = deps.core.configManager.get();
    const activeSessions = deps.core.sessionManager
      .listSessions()
      .filter((s) => s.status === "active" || s.status === "initializing");
    if (activeSessions.length >= config.security.maxConcurrentSessions) {
      deps.sendJson(res, 429, {
        error: `Max concurrent sessions (${config.security.maxConcurrentSessions}) reached. Cancel a session first.`,
      });
      return;
    }

    // Use the first registered adapter (e.g. Telegram) so API sessions appear in the channel
    const [adapterId, adapter] = deps.core.adapters.entries().next().value ?? [
      null,
      null,
    ];
    const channelId = adapterId ?? "api";

    const resolvedAgent = agent || config.defaultAgent;
    const resolvedWorkspace = deps.core.configManager.resolveWorkspace(
      workspace || config.agents[resolvedAgent]?.workingDirectory,
    );

    const session = await deps.core.createSession({
      channelId,
      agentName: resolvedAgent,
      workingDirectory: resolvedWorkspace,
      createThread: !!adapter,
      initialName: `🔄 ${resolvedAgent} — New Session`,
    });

    // If no adapter wired events (headless), auto-approve permissions
    if (!adapter) {
      session.agentInstance.onPermissionRequest = async (request) => {
        const allowOption = request.options.find((o) => o.isAllow);
        log.debug(
          {
            sessionId: session.id,
            permissionId: request.id,
            option: allowOption?.id,
          },
          "Auto-approving permission for API session",
        );
        return allowOption?.id ?? request.options[0]?.id ?? "";
      };
    }

    // Warmup in background so session moves from 'initializing' to 'active'
    session
      .warmup()
      .catch((err) =>
        log.warn({ err, sessionId: session.id }, "API session warmup failed"),
      );

    deps.sendJson(res, 200, {
      sessionId: session.id,
      agent: session.agentName,
      status: session.status,
      workspace: session.workingDirectory,
    });
  });

  router.post("/api/sessions/:sessionId/prompt", async (req, res, params) => {
    const sessionId = decodeURIComponent(params.sessionId);
    const session = deps.core.sessionManager.getSession(sessionId);
    if (!session) {
      deps.sendJson(res, 404, { error: `Session "${sessionId}" not found` });
      return;
    }

    if (
      session.status === "cancelled" ||
      session.status === "finished" ||
      session.status === "error"
    ) {
      deps.sendJson(res, 400, { error: `Session is ${session.status}` });
      return;
    }

    const body = await deps.readBody(req);
    let prompt: string | undefined;
    if (body) {
      try {
        const parsed = JSON.parse(body);
        prompt = parsed.prompt;
      } catch {
        deps.sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }
    }

    if (!prompt) {
      deps.sendJson(res, 400, { error: "Missing prompt" });
      return;
    }

    session.enqueuePrompt(prompt).catch(() => {});
    deps.sendJson(res, 200, {
      ok: true,
      sessionId,
      queueDepth: session.queueDepth,
    });
  });

  router.post(
    "/api/sessions/:sessionId/permission",
    async (req, res, params) => {
      const sessionId = decodeURIComponent(params.sessionId);
      const session = deps.core.sessionManager.getSession(sessionId);
      if (!session) {
        deps.sendJson(res, 404, { error: `Session "${sessionId}" not found` });
        return;
      }

      const body = await deps.readBody(req);
      let permissionId: string | undefined;
      let optionId: string | undefined;
      if (body) {
        try {
          const parsed = JSON.parse(body);
          permissionId = parsed.permissionId;
          optionId = parsed.optionId;
        } catch {
          deps.sendJson(res, 400, { error: "Invalid JSON body" });
          return;
        }
      }

      if (!permissionId || !optionId) {
        deps.sendJson(res, 400, {
          error: "Missing permissionId or optionId",
        });
        return;
      }

      if (
        !session.permissionGate.isPending ||
        session.permissionGate.requestId !== permissionId
      ) {
        deps.sendJson(res, 400, {
          error: "No matching pending permission request",
        });
        return;
      }

      session.permissionGate.resolve(optionId);
      deps.sendJson(res, 200, { ok: true });
    },
  );

  router.patch(
    "/api/sessions/:sessionId/dangerous",
    async (req, res, params) => {
      const sessionId = decodeURIComponent(params.sessionId);
      const session = deps.core.sessionManager.getSession(sessionId);
      if (!session) {
        deps.sendJson(res, 404, { error: `Session "${sessionId}" not found` });
        return;
      }

      const body = await deps.readBody(req);
      let enabled: boolean | undefined;
      if (body) {
        try {
          const parsed = JSON.parse(body);
          enabled = parsed.enabled;
        } catch {
          deps.sendJson(res, 400, { error: "Invalid JSON body" });
          return;
        }
      }

      if (typeof enabled !== "boolean") {
        deps.sendJson(res, 400, { error: "Missing enabled boolean" });
        return;
      }

      session.dangerousMode = enabled;
      await deps.core.sessionManager.patchRecord(sessionId, {
        dangerousMode: enabled,
      });
      deps.sendJson(res, 200, { ok: true, dangerousMode: enabled });
    },
  );

  router.get("/api/sessions/:sessionId", async (_req, res, params) => {
    const sessionId = decodeURIComponent(params.sessionId);
    const session = deps.core.sessionManager.getSession(sessionId);
    if (!session) {
      deps.sendJson(res, 404, { error: `Session "${sessionId}" not found` });
      return;
    }

    deps.sendJson(res, 200, {
      session: {
        id: session.id,
        agent: session.agentName,
        status: session.status,
        name: session.name ?? null,
        workspace: session.workingDirectory,
        createdAt: session.createdAt.toISOString(),
        dangerousMode: session.dangerousMode,
        queueDepth: session.queueDepth,
        promptRunning: session.promptRunning,
        threadId: session.threadId,
        channelId: session.channelId,
        agentSessionId: session.agentSessionId,
      },
    });
  });

  router.post("/api/sessions/:sessionId/summary", async (_req, res, params) => {
    const sessionId = decodeURIComponent(params.sessionId);
    const result = await deps.core.summarizeSession(sessionId);
    if (result.ok) {
      deps.sendJson(res, 200, result);
    } else {
      deps.sendJson(res, 400, result);
    }
  });

  router.post("/api/sessions/:sessionId/archive", async (_req, res, params) => {
    const sessionId = decodeURIComponent(params.sessionId);
    const result = await deps.core.archiveSession(sessionId);
    if (result.ok) {
      deps.sendJson(res, 200, result);
    } else {
      deps.sendJson(res, 400, result);
    }
  });

  router.delete("/api/sessions/:sessionId", async (_req, res, params) => {
    const sessionId = decodeURIComponent(params.sessionId);
    const session = deps.core.sessionManager.getSession(sessionId);
    if (!session) {
      deps.sendJson(res, 404, { error: `Session "${sessionId}" not found` });
      return;
    }
    await deps.core.sessionManager.cancelSession(sessionId);
    deps.sendJson(res, 200, { ok: true });
  });

  router.get("/api/sessions", async (_req, res) => {
    const sessions = deps.core.sessionManager.listSessions();
    deps.sendJson(res, 200, {
      sessions: sessions.map((s) => ({
        id: s.id,
        agent: s.agentName,
        status: s.status,
        name: s.name ?? null,
        workspace: s.workingDirectory,
        createdAt: s.createdAt.toISOString(),
        dangerousMode: s.dangerousMode,
        queueDepth: s.queueDepth,
        promptRunning: s.promptRunning,
        lastActiveAt:
          deps.core.sessionManager.getSessionRecord(s.id)?.lastActiveAt ??
          null,
      })),
    });
  });
}
