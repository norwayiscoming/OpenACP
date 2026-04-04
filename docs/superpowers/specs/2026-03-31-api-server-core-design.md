# Spec 1: API Server Core (Fastify Refactor)

**Date:** 2026-03-31
**Status:** Draft
**Related specs:**
- [Spec 2: Auth System](./2026-03-31-auth-system-design.md)
- [Spec 3: SSE Adapter](./2026-03-31-sse-adapter-design.md)
- [Spec 4: App Connectivity](./2026-03-31-app-connectivity-design.md)

## Overview

Refactor the existing API server plugin (`@openacp/api-server`) from Node.js native `http` module to **Fastify**. The current implementation uses a custom regex-based router, inline auth, and manual JSON parsing. The new implementation provides structured routing, schema validation, proper error handling, and plugin extensibility for third-party route registration.

## Decision: Why Fastify

Evaluated NestJS vs Fastify. Chose Fastify because:
- **Lightweight** (~2MB vs ~15-20MB for NestJS) — important for CLI tool
- **No lifecycle conflict** — Fastify doesn't fight OpenACP's existing LifecycleManager
- **ESM first-class** — matches codebase (ESM-only, NodeNext resolution)
- **Plugin architecture** aligns with OpenACP plugin system
- **Hooks system** maps to existing middleware chain pattern
- **Zod integration** via `fastify-type-provider-zod` for schema validation

## Plugin Structure

```
src/plugins/api-server/
  index.ts              — Plugin definition, setup/teardown
  server.ts             — Fastify instance creation, global hooks, error handler
  service.ts            — ApiServerService implementation (expose for plugins)
  routes/
    sessions.ts         — /api/v1/sessions/*
    agents.ts           — /api/v1/agents/*
    config.ts           — /api/v1/config/*
    system.ts           — /api/v1/system/* (health, version, restart)
    commands.ts         — /api/v1/commands/*
    auth.ts             — /api/v1/auth/* (cross-ref Spec 2)
  middleware/
    auth.ts             — Auth preHandler (cross-ref Spec 2)
    error-handler.ts    — Global error handler
  schemas/              — Zod schemas for request/response validation
  static-server.ts      — Preserved, serves UI dashboard
```

## Fastify Instance Setup

```typescript
// server.ts
const app = Fastify({ logger: false }); // use OpenACP logger instead of pino

// Plugins
app.register(cors, { origin: true });
app.register(fastifySwagger, { openapi: { info: { title: 'OpenACP API', version: '1.0.0' } } });
app.register(fastifySwaggerUi, { routePrefix: '/api/docs' });
app.register(fastifyZod); // Zod type provider
app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });

// Global error handler
app.setErrorHandler(globalErrorHandler);

// Route plugins
app.register(sessionRoutes, { prefix: '/api/v1/sessions' });
app.register(agentRoutes, { prefix: '/api/v1/agents' });
app.register(configRoutes, { prefix: '/api/v1/config' });
app.register(systemRoutes, { prefix: '/api/v1/system' });
app.register(commandRoutes, { prefix: '/api/v1/commands' });
app.register(authRoutes, { prefix: '/api/v1/auth' });
```

## API Versioning

All routes prefixed with `/api/v1/`. This allows adding `/api/v2/` in the future without breaking existing clients.

Plugin-registered routes use `/api/plugins/<plugin-name>/*` prefix.

## Error Handling

Consistent error format across all routes:

```typescript
interface ApiError {
  error: {
    code: string;           // e.g. "SESSION_NOT_FOUND", "VALIDATION_ERROR"
    message: string;
    statusCode: number;
    details?: unknown;      // validation errors, etc.
  }
}
```

Global error handler maps:
- `ZodError` → 400 `VALIDATION_ERROR`
- `NotFoundError` → 404
- `AuthError` → 401/403
- Unknown errors → 500 `INTERNAL_ERROR`

## Service Interface (Plugin Extensibility)

API server exposes a service for other plugins to register their own routes:

```typescript
interface ApiServerService {
  // Plugin route registration — hybrid Fastify plugin pattern
  registerPlugin(prefix: string, plugin: FastifyPluginAsync, opts?: {
    auth?: boolean;          // default true — auto-apply auth preHandler
  }): void;

  // Auth helpers for plugin reuse (cross-ref Spec 2)
  authPreHandler: preHandlerHookHandler;
  requireScopes(...scopes: string[]): preHandlerHookHandler;
  requireRole(role: string): preHandlerHookHandler;

  // Metadata
  getPort(): number;
  getBaseUrl(): string;       // localhost URL
  getTunnelUrl(): string | null; // tunnel URL if available
}
```

**How plugins register routes:**

```typescript
// Example: usage plugin adding API routes
setup(ctx) {
  const api = ctx.getService<ApiServerService>('api-server');

  api.registerPlugin('/api/plugins/usage', async (app) => {
    // Auth helpers from API server — reusable, less code
    app.addHook('onRequest', api.authPreHandler);

    app.get('/stats', { preHandler: api.requireScopes('usage:read') }, getStats);
    app.post('/reset', { preHandler: api.requireRole('admin') }, resetStats);
  });
}
```

When a plugin teardowns, its registered routes are automatically unregistered.

## Route Details (V1)

### Sessions (`/api/v1/sessions`)
| Method | Path | Description | Scopes |
|--------|------|-------------|--------|
| `GET` | `/` | List sessions (filter: status, agentName) | `sessions:read` |
| `GET` | `/:id` | Session detail (metadata, status, prompt count) | `sessions:read` |
| `POST` | `/` | Create session (agentName, workingDirectory?) | `sessions:write` |
| `DELETE` | `/:id` | Cancel session | `sessions:write` |
| `POST` | `/:id/prompt` | Enqueue prompt | `sessions:prompt` |
| `POST` | `/:id/permission` | Resolve permission request | `sessions:permission` |
| `PATCH` | `/:id` | Update session (switch agent, toggle voice/dangerous mode) | `sessions:write` |

### Agents (`/api/v1/agents`)
| Method | Path | Description | Scopes |
|--------|------|-------------|--------|
| `GET` | `/` | List agent catalog with capabilities | `agents:read` |
| `GET` | `/:name` | Agent detail | `agents:read` |

### Config (`/api/v1/config`)
| Method | Path | Description | Scopes |
|--------|------|-------------|--------|
| `GET` | `/` | Full config (safe fields only, unless admin) | `config:read` |
| `PATCH` | `/` | Update config fields | `config:write` |
| `GET` | `/schema` | Zod schema as JSON Schema (for app UI form generation) | `config:read` |

### System (`/api/v1/system`)
| Method | Path | Description | Scopes |
|--------|------|-------------|--------|
| `GET` | `/health` | Health + memory + uptime + adapters (unauthenticated OK) | — |
| `GET` | `/version` | Version info | `system:health` |
| `POST` | `/restart` | Graceful restart | `system:admin` |

### Commands (`/api/v1/commands`)
| Method | Path | Description | Scopes |
|--------|------|-------------|--------|
| `GET` | `/` | List all registered commands | `commands:execute` |
| `POST` | `/execute` | Execute command `{ command: "/help", sessionId?: "..." }` | `commands:execute` |

### Auth (`/api/v1/auth`) — see Spec 2
| Method | Path | Description | Scopes |
|--------|------|-------------|--------|
| `POST` | `/tokens` | Generate JWT (secret token only) | `auth:manage` |
| `GET` | `/tokens` | List active tokens | `auth:manage` |
| `DELETE` | `/tokens/:id` | Revoke token | `auth:manage` |
| `POST` | `/refresh` | Refresh JWT | — (valid JWT) |
| `GET` | `/me` | Current token info | — (valid JWT) |

## Dependencies

New npm packages:
- `fastify`
- `@fastify/cors`
- `@fastify/swagger`
- `@fastify/swagger-ui`
- `@fastify/rate-limit`
- `fastify-type-provider-zod`

## Migration

- Existing API server functionality preserved — all current endpoints migrated to new route structure under `/api/v1/`
- Static server (UI dashboard) preserved as-is
- `api.port` and `api-secret` file management preserved
- Backward-compatible: old clients hitting `/api/*` without `v1` prefix should get 301 redirect to `/api/v1/*` (migration period)
