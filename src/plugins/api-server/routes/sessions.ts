import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';
import { NotFoundError } from '../middleware/error-handler.js';
import { requireScopes } from '../middleware/auth.js';
import { createChildLogger } from '../../../core/utils/log.js';
import {
  SessionIdParamSchema,
  CreateSessionBodySchema,
  AdoptSessionBodySchema,
  PromptBodySchema,
  PermissionResponseBodySchema,
  DangerousModeBodySchema,
  UpdateSessionBodySchema,
} from '../schemas/sessions.js';

const log = createChildLogger({ module: 'api-server' });

export async function sessionRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  // GET /sessions — list all sessions
  app.get('/', { preHandler: requireScopes('sessions:read') }, async () => {
    const sessions = deps.core.sessionManager.listSessions();
    return {
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
          deps.core.sessionManager.getSessionRecord(s.id)?.lastActiveAt ?? null,
      })),
    };
  });

  // GET /sessions/:sessionId — get session details
  app.get<{ Params: { sessionId: string } }>(
    '/:sessionId',
    { preHandler: requireScopes('sessions:read') },
    async (request) => {
      const { sessionId } = SessionIdParamSchema.parse(request.params);
      const session = deps.core.sessionManager.getSession(
        decodeURIComponent(sessionId),
      );
      if (!session) {
        throw new NotFoundError(
          'SESSION_NOT_FOUND',
          `Session "${sessionId}" not found`,
        );
      }

      return {
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
      };
    },
  );

  // POST /sessions — create a new session
  app.post('/', { preHandler: requireScopes('sessions:write') }, async (request, reply) => {
    const body = CreateSessionBodySchema.parse(request.body ?? {});

    // Check max concurrent sessions
    const config = deps.core.configManager.get();
    const activeSessions = deps.core.sessionManager
      .listSessions()
      .filter((s) => s.status === 'active' || s.status === 'initializing');
    if (activeSessions.length >= config.security.maxConcurrentSessions) {
      return reply.status(429).send({
        error: `Max concurrent sessions (${config.security.maxConcurrentSessions}) reached. Cancel a session first.`,
      });
    }

    // Resolve adapter: use explicit channel if provided, otherwise fall back to first registered adapter
    let adapterId: string | null = null;
    let adapter: InstanceType<any> | null = null;

    if (body.channel) {
      if (!deps.core.adapters.has(body.channel)) {
        const available =
          Array.from(deps.core.adapters.keys()).join(', ') || 'none';
        return reply.status(400).send({
          error: `Adapter '${body.channel}' is not connected. Available: ${available}`,
        });
      }
      adapterId = body.channel;
      adapter = deps.core.adapters.get(body.channel) ?? null;
    } else {
      const firstEntry = deps.core.adapters.entries().next().value;
      if (firstEntry) {
        [adapterId, adapter] = firstEntry;
      }
    }

    const channelId = adapterId ?? 'api';

    const resolvedAgent = body.agent || config.defaultAgent;
    const agentDef = deps.core.agentCatalog.resolve(resolvedAgent);
    const resolvedWorkspace = deps.core.configManager.resolveWorkspace(
      body.workspace || agentDef?.workingDirectory,
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
      session.agentInstance.onPermissionRequest = async (permRequest) => {
        const allowOption = permRequest.options.find((o) => o.isAllow);
        log.debug(
          {
            sessionId: session.id,
            permissionId: permRequest.id,
            option: allowOption?.id,
          },
          'Auto-approving permission for API session',
        );
        return allowOption?.id ?? permRequest.options[0]?.id ?? '';
      };
    }

    // Warmup in background so session moves from 'initializing' to 'active'
    session
      .warmup()
      .catch((err) =>
        log.warn({ err, sessionId: session.id }, 'API session warmup failed'),
      );

    return {
      sessionId: session.id,
      agent: session.agentName,
      status: session.status,
      workspace: session.workingDirectory,
    };
  });

  // POST /sessions/adopt — adopt an existing agent session
  app.post<{ Body: { agent: string; agentSessionId: string; cwd?: string; channel?: string } }>(
    '/adopt',
    { preHandler: requireScopes('sessions:write') },
    async (request, reply) => {
      const body = AdoptSessionBodySchema.parse(request.body);

      const result = await deps.core.adoptSession(
        body.agent,
        body.agentSessionId,
        body.cwd ?? process.cwd(),
        body.channel,
      );

      if (result.ok) {
        return result;
      } else {
        const status =
          result.error === 'session_limit'
            ? 429
            : result.error === 'agent_not_supported'
              ? 400
              : 500;
        return reply.status(status).send(result);
      }
    },
  );

  // POST /sessions/:sessionId/prompt — send a prompt to a session
  app.post<{ Params: { sessionId: string } }>(
    '/:sessionId/prompt',
    { preHandler: requireScopes('sessions:prompt') },
    async (request, reply) => {
      const { sessionId: rawId } = SessionIdParamSchema.parse(request.params);
      const sessionId = decodeURIComponent(rawId);
      const session = deps.core.sessionManager.getSession(sessionId);
      if (!session) {
        throw new NotFoundError(
          'SESSION_NOT_FOUND',
          `Session "${sessionId}" not found`,
        );
      }

      if (
        session.status === 'cancelled' ||
        session.status === 'finished' ||
        session.status === 'error'
      ) {
        return reply.status(400).send({ error: `Session is ${session.status}` });
      }

      const body = PromptBodySchema.parse(request.body);

      await session.enqueuePrompt(body.prompt);
      return {
        ok: true,
        sessionId,
        queueDepth: session.queueDepth,
      };
    },
  );

  // POST /sessions/:sessionId/permission — resolve a pending permission request
  app.post<{ Params: { sessionId: string } }>(
    '/:sessionId/permission',
    { preHandler: requireScopes('sessions:permission') },
    async (request, reply) => {
      const { sessionId: rawId } = SessionIdParamSchema.parse(request.params);
      const sessionId = decodeURIComponent(rawId);
      const session = deps.core.sessionManager.getSession(sessionId);
      if (!session) {
        throw new NotFoundError(
          'SESSION_NOT_FOUND',
          `Session "${sessionId}" not found`,
        );
      }

      const body = PermissionResponseBodySchema.parse(request.body);

      if (
        !session.permissionGate.isPending ||
        session.permissionGate.requestId !== body.permissionId
      ) {
        return reply.status(400).send({
          error: 'No matching pending permission request',
        });
      }

      session.permissionGate.resolve(body.optionId);
      return { ok: true };
    },
  );

  // PATCH /sessions/:sessionId — update session (agent, voice, dangerous mode)
  app.patch<{ Params: { sessionId: string } }>(
    '/:sessionId',
    { preHandler: requireScopes('sessions:write') },
    async (request) => {
      const { sessionId: rawId } = SessionIdParamSchema.parse(request.params);
      const sessionId = decodeURIComponent(rawId);
      const session = deps.core.sessionManager.getSession(sessionId);
      if (!session) {
        throw new NotFoundError(
          'SESSION_NOT_FOUND',
          `Session "${sessionId}" not found`,
        );
      }

      const body = UpdateSessionBodySchema.parse(request.body);
      const changes: Record<string, unknown> = {};

      if (body.agentName !== undefined) {
        const result = await deps.core.switchSessionAgent(sessionId, body.agentName);
        changes.agentName = body.agentName;
        changes.resumed = result.resumed;
      }

      if (body.voiceMode !== undefined) {
        session.setVoiceMode(body.voiceMode);
        changes.voiceMode = body.voiceMode;
      }

      if (body.dangerousMode !== undefined) {
        session.dangerousMode = body.dangerousMode;
        await deps.core.sessionManager.patchRecord(sessionId, {
          dangerousMode: body.dangerousMode,
        });
        changes.dangerousMode = body.dangerousMode;
      }

      return { ok: true, ...changes };
    },
  );

  // PATCH /sessions/:sessionId/dangerous — toggle dangerous mode
  app.patch<{ Params: { sessionId: string } }>(
    '/:sessionId/dangerous',
    { preHandler: requireScopes('sessions:write') },
    async (request) => {
      const { sessionId: rawId } = SessionIdParamSchema.parse(request.params);
      const sessionId = decodeURIComponent(rawId);
      const session = deps.core.sessionManager.getSession(sessionId);
      if (!session) {
        throw new NotFoundError(
          'SESSION_NOT_FOUND',
          `Session "${sessionId}" not found`,
        );
      }

      const body = DangerousModeBodySchema.parse(request.body);

      session.dangerousMode = body.enabled;
      await deps.core.sessionManager.patchRecord(sessionId, {
        dangerousMode: body.enabled,
      });
      return { ok: true, dangerousMode: body.enabled };
    },
  );

  // POST /sessions/:sessionId/archive — archive a session
  app.post<{ Params: { sessionId: string } }>(
    '/:sessionId/archive',
    { preHandler: requireScopes('sessions:write') },
    async (request, reply) => {
      const { sessionId: rawId } = SessionIdParamSchema.parse(request.params);
      const sessionId = decodeURIComponent(rawId);
      const result = await deps.core.archiveSession(sessionId);
      if (result.ok) {
        return result;
      } else {
        return reply.status(400).send(result);
      }
    },
  );

  // DELETE /sessions/:sessionId — cancel a session
  app.delete<{ Params: { sessionId: string } }>(
    '/:sessionId',
    { preHandler: requireScopes('sessions:write') },
    async (request) => {
      const { sessionId: rawId } = SessionIdParamSchema.parse(request.params);
      const sessionId = decodeURIComponent(rawId);
      const session = deps.core.sessionManager.getSession(sessionId);
      if (!session) {
        throw new NotFoundError(
          'SESSION_NOT_FOUND',
          `Session "${sessionId}" not found`,
        );
      }
      await deps.core.sessionManager.cancelSession(sessionId);
      return { ok: true };
    },
  );
}
