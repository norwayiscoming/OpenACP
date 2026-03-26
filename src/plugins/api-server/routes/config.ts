import type { Router } from "../router.js";
import type { RouteDeps } from "../api-server.js";

const SENSITIVE_KEYS = [
  "botToken",
  "token",
  "apiKey",
  "secret",
  "password",
  "webhookSecret",
];

function redactConfig(config: unknown): unknown {
  const redacted = structuredClone(config);
  redactDeep(redacted as Record<string, unknown>);
  return redacted;
}

function redactDeep(obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(key) && typeof value === "string") {
      obj[key] = "***";
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object")
          redactDeep(item as Record<string, unknown>);
      }
    } else if (value && typeof value === "object") {
      redactDeep(value as Record<string, unknown>);
    }
  }
}

export function registerConfigRoutes(router: Router, deps: RouteDeps): void {
  router.get("/api/config/editable", async (_req, res) => {
    const { getSafeFields, resolveOptions, getConfigValue } =
      await import("../../../core/config/config-registry.js");
    const config = deps.core.configManager.get();
    const safeFields = getSafeFields();

    const fields = safeFields.map((def) => ({
      path: def.path,
      displayName: def.displayName,
      group: def.group,
      type: def.type,
      options: resolveOptions(def, config),
      value: getConfigValue(config, def.path),
      hotReload: def.hotReload,
    }));

    deps.sendJson(res, 200, { fields });
  });

  router.get("/api/config", async (_req, res) => {
    const config = deps.core.configManager.get();
    deps.sendJson(res, 200, { config: redactConfig(config) });
  });

  router.patch("/api/config", async (req, res) => {
    const body = await deps.readBody(req);
    let configPath: string | undefined;
    let value: unknown;

    if (body) {
      try {
        const parsed = JSON.parse(body);
        configPath = parsed.path;
        value = parsed.value;
      } catch {
        deps.sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }
    }

    if (!configPath) {
      deps.sendJson(res, 400, { error: "Missing path" });
      return;
    }

    // Block prototype pollution
    const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    const parts = configPath.split(".");
    if (parts.some((p) => BLOCKED_KEYS.has(p))) {
      deps.sendJson(res, 400, { error: "Invalid config path" });
      return;
    }

    // Enforce safe-fields scope — only fields marked 'safe' can be modified via API
    const { getFieldDef } = await import("../../../core/config/config-registry.js");
    const fieldDef = getFieldDef(configPath);
    if (!fieldDef || fieldDef.scope !== "safe") {
      deps.sendJson(res, 403, {
        error: "This config field cannot be modified via the API",
      });
      return;
    }

    // Pre-validate by cloning config and applying the change
    const currentConfig = deps.core.configManager.get();
    const cloned = structuredClone(currentConfig) as Record<string, unknown>;
    let target: Record<string, unknown> = cloned;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (
        target[part] &&
        typeof target[part] === "object" &&
        !Array.isArray(target[part])
      ) {
        target = target[part] as Record<string, unknown>;
      } else if (target[part] === undefined || target[part] === null) {
        // Create intermediate objects for new paths (e.g. speech.stt.providers.groq.apiKey)
        target[part] = {};
        target = target[part] as Record<string, unknown>;
      } else {
        deps.sendJson(res, 400, { error: "Invalid config path" });
        return;
      }
    }

    const lastKey = parts[parts.length - 1];
    target[lastKey] = value;

    // Validate with Zod
    const { ConfigSchema } = await import("../../../core/config/config.js");
    const result = ConfigSchema.safeParse(cloned);
    if (!result.success) {
      deps.sendJson(res, 400, {
        error: "Validation failed",
        details: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    // Convert dot-path to nested object for save
    const updates: Record<string, unknown> = {};
    let updateTarget = updates;
    for (let i = 0; i < parts.length - 1; i++) {
      updateTarget[parts[i]] = {};
      updateTarget = updateTarget[parts[i]] as Record<string, unknown>;
    }
    updateTarget[lastKey] = value;

    await deps.core.configManager.save(updates, configPath);

    const { isHotReloadable } = await import("../../../core/config/config-registry.js");
    const needsRestart = !isHotReloadable(configPath!);

    deps.sendJson(res, 200, {
      ok: true,
      needsRestart,
      config: redactConfig(deps.core.configManager.get()),
    });
  });
}
