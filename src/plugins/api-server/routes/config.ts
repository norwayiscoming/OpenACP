import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';
import { requireScopes } from '../middleware/auth.js';
import { UpdateConfigBodySchema } from '../schemas/config.js';

const SENSITIVE_KEYS = [
  'botToken',
  'token',
  'apiKey',
  'secret',
  'password',
  'webhookSecret',
];

function redactConfig(config: unknown): unknown {
  const redacted = structuredClone(config);
  redactDeep(redacted as Record<string, unknown>);
  return redacted;
}

function redactDeep(obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(key) && typeof value === 'string') {
      obj[key] = '***';
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object')
          redactDeep(item as Record<string, unknown>);
      }
    } else if (value && typeof value === 'object') {
      redactDeep(value as Record<string, unknown>);
    }
  }
}

export async function configRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  // GET /config/editable — list safe-to-edit config fields
  app.get('/editable', { preHandler: requireScopes('config:read') }, async () => {
    const { getSafeFields, resolveOptions, getFieldValueAsync } = await import(
      '../../../core/config/config-registry.js'
    );
    const config = deps.core.configManager.get();
    const settingsManager = deps.core.settingsManager;
    const safeFields = getSafeFields();

    const fields = await Promise.all(safeFields.map(async (def) => ({
      path: def.path,
      displayName: def.displayName,
      group: def.group,
      type: def.type,
      options: resolveOptions(def, config),
      value: await getFieldValueAsync(def, deps.core.configManager, settingsManager),
      hotReload: def.hotReload,
    })));

    return { fields };
  });

  // GET /config/schema — get the config JSON schema
  app.get('/schema', { preHandler: requireScopes('config:read') }, async () => {
    const { zodToJsonSchema } = await import('zod-to-json-schema');
    const { ConfigSchema } = await import('../../../core/config/config.js');
    return zodToJsonSchema(ConfigSchema, 'OpenACPConfig');
  });

  // GET /config — get full config (redacted)
  app.get('/', { preHandler: requireScopes('config:read') }, async () => {
    const config = deps.core.configManager.get();
    return { config: redactConfig(config) };
  });

  // PATCH /config — update a config field
  app.patch('/', { preHandler: requireScopes('config:write') }, async (request, reply) => {
    const body = UpdateConfigBodySchema.parse(request.body);
    const configPath = body.path;
    const value = body.value;

    // Block prototype pollution
    const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    if (configPath.split('.').some((p) => BLOCKED_KEYS.has(p))) {
      return reply.status(400).send({ error: 'Invalid config path' });
    }

    // Enforce safe-fields scope — only fields marked 'safe' can be modified via API
    const { getFieldDef, setFieldValueAsync } = await import(
      '../../../core/config/config-registry.js'
    );
    const fieldDef = getFieldDef(configPath);
    if (!fieldDef || fieldDef.scope !== 'safe') {
      return reply.status(403).send({
        error: 'This config field cannot be modified via the API',
      });
    }

    const settingsManager = deps.core.settingsManager;
    const { needsRestart } = await setFieldValueAsync(
      fieldDef, value, deps.core.configManager, settingsManager,
    );

    return {
      ok: true,
      needsRestart,
      config: redactConfig(deps.core.configManager.get()),
    };
  });
}
