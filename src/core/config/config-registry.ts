import * as fs from "node:fs";
import * as path from "node:path";
import type { Config } from "./config.js";
import { getGlobalRoot } from "../instance/instance-context.js";

export interface ConfigFieldDef {
  path: string;
  displayName: string;
  group: string;
  type: "toggle" | "select" | "number" | "string";
  options?: string[] | ((config: Config) => string[]);
  scope: "safe" | "sensitive";
  hotReload: boolean;
}

export const CONFIG_REGISTRY: ConfigFieldDef[] = [
  {
    path: "defaultAgent",
    displayName: "Default Agent",
    group: "agent",
    type: "select",
    options: () => {
      try {
        const agentsPath = path.join(getGlobalRoot(), "agents.json");
        if (fs.existsSync(agentsPath)) {
          const data = JSON.parse(fs.readFileSync(agentsPath, "utf-8"));
          return Object.keys(data.installed ?? {});
        }
      } catch {
        /* fallback */
      }
      return [];
    },
    scope: "safe",
    hotReload: true,
  },
  {
    path: "logging.level",
    displayName: "Log Level",
    group: "logging",
    type: "select",
    options: ["silent", "debug", "info", "warn", "error", "fatal"],
    scope: "safe",
    hotReload: true,
  },
  {
    path: "workspace.baseDir",
    displayName: "Workspace Directory",
    group: "workspace",
    type: "string",
    scope: "safe",
    hotReload: true,
  },
  {
    path: "sessionStore.ttlDays",
    displayName: "Session Store TTL (days)",
    group: "storage",
    type: "number",
    scope: "safe",
    hotReload: true,
  },
  {
    path: "agentSwitch.labelHistory",
    displayName: "Label Agent in History",
    group: "agent",
    type: "toggle",
    scope: "safe",
    hotReload: true,
  },
];

export function getFieldDef(path: string): ConfigFieldDef | undefined {
  return CONFIG_REGISTRY.find((f) => f.path === path);
}

export function getSafeFields(): ConfigFieldDef[] {
  return CONFIG_REGISTRY.filter((f) => f.scope === "safe");
}

export function isHotReloadable(path: string): boolean {
  const def = getFieldDef(path);
  return def?.hotReload ?? false;
}

export function resolveOptions(
  def: ConfigFieldDef,
  config: Config,
): string[] | undefined {
  if (!def.options) return undefined;
  return typeof def.options === "function" ? def.options(config) : def.options;
}

export function getConfigValue(config: Config, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

function validateFieldValue(field: ConfigFieldDef, value: unknown): void {
  switch (field.type) {
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new ConfigValidationError(`"${field.path}" expects a number, got ${typeof value}`);
      }
      break;
    case "toggle":
      if (typeof value !== "boolean") {
        throw new ConfigValidationError(`"${field.path}" expects a boolean, got ${typeof value}`);
      }
      break;
    case "string":
      if (typeof value !== "string") {
        throw new ConfigValidationError(`"${field.path}" expects a string, got ${typeof value}`);
      }
      break;
    case "select": {
      if (typeof value !== "string") {
        throw new ConfigValidationError(`"${field.path}" expects a string, got ${typeof value}`);
      }
      break;
    }
  }
}

export async function setFieldValueAsync(
  field: ConfigFieldDef,
  value: unknown,
  configManager: { setPath(path: string, value: unknown): Promise<void>; emit?(event: string, data: unknown): void },
): Promise<{ needsRestart: boolean }> {
  validateFieldValue(field, value);
  await configManager.setPath(field.path, value);
  return { needsRestart: !field.hotReload };
}
