import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthError } from './error-handler.js';
import { verifyToken } from '../auth/jwt.js';
import { getRoleScopes } from '../auth/roles.js';
import type { TokenStore } from '../auth/token-store.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: {
      type: 'secret' | 'jwt';
      tokenId?: string;
      role: string;
      scopes: string[];
    };
  }
}

function constantTimeSecretCheck(token: string, secret: string): boolean {
  // Hash both to fixed-length to prevent length leaking
  const tokenHash = createHmac('sha256', 'openacp-auth').update(token).digest();
  const secretHash = createHmac('sha256', 'openacp-auth').update(secret).digest();
  return timingSafeEqual(tokenHash, secretHash);
}

export function createAuthPreHandler(
  getSecret: () => string,
  getJwtSecret: () => string,
  tokenStore: TokenStore,
): preHandlerHookHandler {
  return async function authPreHandler(request: FastifyRequest, _reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    const queryToken = (request.query as Record<string, string>)?.token;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

    if (!token) {
      throw new AuthError('UNAUTHORIZED', 'Missing authentication token');
    }

    // 1. Check secret token (constant-time compare) — full admin access
    const secret = getSecret();
    if (constantTimeSecretCheck(token, secret)) {
      request.auth = { type: 'secret', role: 'admin', scopes: ['*'] };
      return;
    }

    // 2. Try JWT verification
    let payload;
    try {
      const jwtSecret = getJwtSecret();
      payload = verifyToken(token, jwtSecret);
    } catch {
      throw new AuthError('UNAUTHORIZED', 'Invalid authentication token');
    }

    // 3. Check if token is revoked in TokenStore
    const stored = tokenStore.get(payload.sub);
    if (!stored || stored.revoked) {
      throw new AuthError('UNAUTHORIZED', 'Token has been revoked');
    }

    // 4. Update lastUsedAt
    tokenStore.updateLastUsed(payload.sub);

    // 5. Resolve scopes from token override or role defaults
    const scopes = payload.scopes ?? getRoleScopes(payload.role);

    request.auth = {
      type: 'jwt',
      tokenId: payload.sub,
      role: payload.role,
      scopes,
    };
  };
}

export function requireScopes(...scopes: string[]): preHandlerHookHandler {
  return async function scopeCheck(request: FastifyRequest, _reply: FastifyReply) {
    const { scopes: userScopes } = request.auth;
    if (userScopes.includes('*')) return;

    const missing = scopes.filter((s) => !userScopes.includes(s));
    if (missing.length > 0) {
      throw new AuthError('FORBIDDEN', `Missing scopes: ${missing.join(', ')}`, 403);
    }
  };
}

export function requireRole(role: string): preHandlerHookHandler {
  const roleHierarchy: Record<string, number> = { viewer: 0, operator: 1, admin: 2 };

  return async function roleCheck(request: FastifyRequest, _reply: FastifyReply) {
    const userLevel = roleHierarchy[request.auth.role] ?? -1;
    const requiredLevel = roleHierarchy[role] ?? 999;

    if (userLevel < requiredLevel) {
      throw new AuthError('FORBIDDEN', `Requires ${role} role`, 403);
    }
  };
}
