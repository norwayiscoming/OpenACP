import * as fs from "node:fs";
import * as path from "node:path";
import type { Config } from "./config.js";
import { getGlobalRoot } from "../instance/instance-context.js";
import type { SettingsManager } from "../plugin/settings-manager.js";

export interface ConfigFieldDef {
  path: string;
  displayName: string;
  group: string;
  type: "toggle" | "select" | "number" | "string";
  options?: string[] | ((config: Config) => string[]);
  scope: "safe" | "sensitive";
  hotReload: boolean;
  /** If set, this field lives in plugin settings rather than config.json */
  plugin?: {
    name: string;
    key: string;
  };
}

export const CONFIG_REGISTRY: ConfigFieldDef[] = [
  {
    path: "defaultAgent",
    displayName: "Default Agent",
    group: "agent",
    type: "select",
    options: (config) => {
      try {
        const agentsPath = path.join(getGlobalRoot(), "agents.json");
        if (fs.existsSync(agentsPath)) {
          const data = JSON.parse(fs.readFileSync(agentsPath, "utf-8"));
          return Object.keys(data.installed ?? {});
        }
      } catch {
        /* fallback */
      }
      return Object.keys(config.agents ?? {});
    },
    scope: "safe",
    hotReload: true,
  },
  {
    path: "channels.telegram.outputMode",
    displayName: "Telegram Output Mode",
    group: "display",
    type: "select",
    options: ["low", "medium", "high"],
    scope: "safe",
    hotReload: true,
  },
  {
    path: "channels.discord.outputMode",
    displayName: "Discord Output Mode",
    group: "display",
    type: "select",
    options: ["low", "medium", "high"],
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
    path: "tunnel.enabled",
    displayName: "Tunnel",
    group: "tunnel",
    type: "toggle",
    scope: "safe",
    hotReload: false,
    plugin: { name: "@openacp/tunnel", key: "enabled" },
  },
  {
    path: "security.maxConcurrentSessions",
    displayName: "Max Concurrent Sessions",
    group: "security",
    type: "number",
    scope: "safe",
    hotReload: true,
    plugin: { name: "@openacp/security", key: "maxConcurrentSessions" },
  },
  {
    path: "security.sessionTimeoutMinutes",
    displayName: "Session Timeout (min)",
    group: "security",
    type: "number",
    scope: "safe",
    hotReload: true,
    plugin: { name: "@openacp/security", key: "sessionTimeoutMinutes" },
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
    path: "speech.stt.provider",
    displayName: "Speech to Text",
    group: "speech",
    type: "select",
    options: ["groq"],
    scope: "safe",
    hotReload: true,
    plugin: { name: "@openacp/speech", key: "sttProvider" },
  },
  {
    path: "speech.stt.apiKey",
    displayName: "STT API Key",
    group: "speech",
    type: "string",
    scope: "sensitive",
    hotReload: true,
    plugin: { name: "@openacp/speech", key: "groqApiKey" },
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

export async function getFieldValueAsync(
  field: ConfigFieldDef,
  configManager: { get(): Record<string, unknown> },
  settingsManager?: SettingsManager,
): Promise<unknown> {
  if (field.plugin && settingsManager) {
    const settings = await settingsManager.loadSettings(field.plugin.name);
    return settings[field.plugin.key];
  }
  return getConfigValue(configManager.get() as any, field.path);
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
  settingsManager?: SettingsManager,
): Promise<{ needsRestart: boolean }> {
  validateFieldValue(field, value);
  if (field.plugin && settingsManager) {
    await settingsManager.updatePluginSettings(field.plugin.name, {
      [field.plugin.key]: value,
    });
    // Emit config:changed so hot-reload handlers can pick up the change
    if (configManager.emit) {
      configManager.emit('config:changed', { path: field.path, value, oldValue: undefined });
    }
    return { needsRestart: !field.hotReload };
  }
  await configManager.setPath(field.path, value);
  return { needsRestart: !field.hotReload };
}
