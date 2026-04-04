import type { FastifyInstance } from 'fastify';
import { CreateTokenBodySchema, RevokeTokenParamSchema, RefreshBodySchema, CreateCodeBodySchema, RevokeCodeParamSchema } from '../schemas/auth.js';
import { signToken, verifyForRefresh } from '../auth/jwt.js';
import { parseDuration, type TokenStore } from '../auth/token-store.js';
import { getRoleScopes } from '../auth/roles.js';
import { AuthError, NotFoundError } from '../middleware/error-handler.js';
import { requireScopes, requireRole } from '../middleware/auth.js';

export interface AuthRouteDeps {
  tokenStore: TokenStore;
  getJwtSecret: () => string;
}

export async function authRoutes(
  app: FastifyInstance,
  deps: AuthRouteDeps,
): Promise<void> {
  const { tokenStore, getJwtSecret } = deps;

  // POST /tokens — generate a new JWT (secret token auth only)
  app.post('/tokens', async (request) => {
    if (request.auth.type !== 'secret') {
      throw new AuthError('FORBIDDEN', 'Only secret token can create new tokens', 403);
    }
    const body = CreateTokenBodySchema.parse(request.body);
    const stored = tokenStore.create({
      role: body.role,
      name: body.name,
      expire: body.expire,
      scopes: body.scopes,
    });

    const durationMs = parseDuration(body.expire);
    const rfd = new Date(stored.refreshDeadline).getTime() / 1000;

    const accessToken = signToken(
      { sub: stored.id, role: stored.role, scopes: stored.scopes, rfd },
      getJwtSecret(),
      body.expire,
    );

    const expiresAt = new Date(Date.now() + durationMs).toISOString();

    return {
      tokenId: stored.id,
      accessToken,
      expiresAt,
      refreshDeadline: stored.refreshDeadline,
    };
  });

  // GET /tokens — list active tokens
  app.get('/tokens', {
    preHandler: [requireScopes('auth:manage')],
  }, async () => {
    const tokens = tokenStore.list();
    return {
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        scopes: t.scopes,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        refreshDeadline: t.refreshDeadline,
      })),
    };
  });

  // DELETE /tokens/:id — revoke a token
  app.delete('/tokens/:id', {
    preHandler: [requireScopes('auth:manage')],
  }, async (request) => {
    const { id } = RevokeTokenParamSchema.parse(request.params);
    const stored = tokenStore.get(id);
    if (!stored) {
      throw new NotFoundError('TOKEN_NOT_FOUND', `Token ${id} not found`);
    }
    tokenStore.revoke(id);
    return { revoked: true, id };
  });

  // POST /refresh — refresh an expired JWT (within refresh deadline)
  app.post('/refresh', async (request) => {
    const { token } = RefreshBodySchema.parse(request.body);

    let payload;
    try {
      payload = verifyForRefresh(token, getJwtSecret());
    } catch {
      throw new AuthError('UNAUTHORIZED', 'Invalid token for refresh');
    }

    // Check refresh deadline
    const now = Date.now() / 1000;
    if (now > payload.rfd) {
      throw new AuthError('UNAUTHORIZED', 'Refresh deadline exceeded, re-authenticate required');
    }

    // Check if revoked
    const stored = tokenStore.get(payload.sub);
    if (!stored || stored.revoked) {
      throw new AuthError('UNAUTHORIZED', 'Token has been revoked');
    }

    // Compute original duration from the token's exp - iat
    const originalDurationSec = payload.exp - payload.iat;
    const expiresIn = `${originalDurationSec}s`;

    // Issue new token with same params
    const accessToken = signToken(
      { sub: payload.sub, role: payload.role, scopes: payload.scopes, rfd: payload.rfd },
      getJwtSecret(),
      expiresIn,
    );

    const expiresAt = new Date(Date.now() + originalDurationSec * 1000).toISOString();

    return {
      tokenId: payload.sub,
      accessToken,
      expiresAt,
      refreshDeadline: stored.refreshDeadline,
    };
  });

  // GET /me — current auth info
  app.get('/me', async (request) => {
    const { auth } = request;
    return {
      type: auth.type,
      tokenId: auth.tokenId,
      role: auth.role,
      scopes: auth.scopes,
    };
  });

  // POST /codes — generate one-time code (secret token only)
  app.post('/codes', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    if (request.auth.type !== 'secret') {
      throw new AuthError('FORBIDDEN', 'Only secret token can create codes', 403);
    }
    const body = CreateCodeBodySchema.parse(request.body);
    const code = tokenStore.createCode({
      role: body.role,
      name: body.name,
      expire: body.expire,
      scopes: body.scopes,
    });
    return reply.send({ code: code.code, expiresAt: code.expiresAt });
  });

  // GET /codes — list active codes (auth:manage scope)
  app.get('/codes', {
    preHandler: [requireScopes('auth:manage')],
  }, async (_request, reply) => {
    const codes = tokenStore.listCodes().map(c => ({
      ...c,
      code: c.code.slice(0, 8) + '...',
    }));
    return reply.send({ codes });
  });

  // DELETE /codes/:code — revoke unused code (auth:manage scope)
  app.delete<{ Params: { code: string } }>('/codes/:code', {
    preHandler: [requireScopes('auth:manage')],
  }, async (request, reply) => {
    const { code } = RevokeCodeParamSchema.parse(request.params);
    tokenStore.revokeCode(code);
    return reply.send({ revoked: true, code });
  });
}
