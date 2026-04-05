import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { applyMigrations } from "./config-migrations.js";
import { createChildLogger } from "../utils/log.js";
import type { SettingsManager } from "../plugin/settings-manager.js";
const log = createChildLogger({ module: "config" });

const LoggingSchema = z
  .object({
    level: z
      .enum(["silent", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    logDir: z.string().default("~/.openacp/logs"),
    maxFileSize: z.union([z.string(), z.number()]).default("10m"),
    maxFiles: z.number().default(7),
    sessionLogRetentionDays: z.number().default(30),
  })
  .default({});

export type LoggingConfig = z.infer<typeof LoggingSchema>;

export const ConfigSchema = z.object({
  instanceName: z.string().optional(),
  defaultAgent: z.string(),
  workspace: z
    .object({
      baseDir: z.string().default("~/openacp-workspace"),
      security: z
        .object({
          allowedPaths: z.array(z.string()).default([]),
          envWhitelist: z.array(z.string()).default([]),
        })
        .default({}),
    })
    .default({}),
  logging: LoggingSchema,
  runMode: z.enum(["foreground", "daemon"]).default("foreground"),
  autoStart: z.boolean().default(false),
  sessionStore: z
    .object({
      ttlDays: z.number().default(30),
    })
    .default({}),
  integrations: z
    .record(
      z.string(),
      z.object({
        installed: z.boolean(),
        installedAt: z.string().optional(),
      }),
    )
    .default({}),
  outputMode: z.enum(["low", "medium", "high"]).default("medium").optional(),
  agentSwitch: z.object({
    labelHistory: z.boolean().default(true),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export function expandHome(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

const DEFAULT_CONFIG = {
  defaultAgent: "claude",
  workspace: { baseDir: "~/openacp-workspace" },
  sessionStore: { ttlDays: 30 },
};

export class ConfigManager extends EventEmitter {
  private config!: Config;
  private configPath: string;

  constructor(configPath?: string) {
    super();
    this.configPath =
      process.env.OPENACP_CONFIG_PATH || configPath || expandHome("~/.openacp/config.json");
  }

  async load(): Promise<void> {
    // 1. Ensure directory exists
    const dir = path.dirname(this.configPath);
    fs.mkdirSync(dir, { recursive: true });

    // 2. If config file doesn't exist, create default
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(DEFAULT_CONFIG, null, 2),
      );
      log.info({ configPath: this.configPath }, "Config created");
      log.info(
        "Run 'openacp setup' to configure channels and agents, then restart.",
      );
      process.exit(1);
    }

    // 3. Read and parse
    const raw = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));

    // 3.5. Auto-migrate config
    const { changed: configUpdated } = applyMigrations(raw, undefined, { configDir: path.dirname(this.configPath) });
    if (configUpdated) {
      fs.writeFileSync(this.configPath, JSON.stringify(raw, null, 2));
    }

    // 4. Apply env var overrides
    this.applyEnvOverrides(raw);

    // 5. Validate with Zod
    const result = ConfigSchema.safeParse(raw);
    if (!result.success) {
      log.error("Config validation failed");
      for (const issue of result.error.issues) {
        log.error(
          { path: issue.path.join("."), message: issue.message },
          "Validation error",
        );
      }
      process.exit(1);
    }
    this.config = result.data;
  }

  get(): Config {
    return structuredClone(this.config);
  }

  async save(
    updates: Record<string, unknown>,
    changePath?: string,
  ): Promise<void> {
    const oldConfig = this.config ? structuredClone(this.config) : undefined;
    // Read current file, merge updates
    const raw = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
    this.deepMerge(raw, updates);
    // Validate BEFORE writing to disk
    const result = ConfigSchema.safeParse(raw);
    if (!result.success) {
      log.error({ errors: result.error.issues }, "Config validation failed, not saving");
      return;
    }
    const tmpPath = this.configPath + `.tmp.${randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpPath, JSON.stringify(raw, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.configPath);
    this.config = result.data;
    // Emit change event if path provided
    if (changePath) {
      const { getConfigValue } = await import("./config-registry.js");
      const value = getConfigValue(this.config, changePath);
      const oldValue = oldConfig
        ? getConfigValue(oldConfig, changePath)
        : undefined;
      this.emit("config:changed", { path: changePath, value, oldValue });
    }
  }

  /**
   * Set a single config value by dot-path (e.g. "logging.level").
   * Builds the nested update object, validates, and saves.
   * Throws if the path contains blocked keys or the value fails Zod validation.
   */
  async setPath(dotPath: string, value: unknown): Promise<void> {
    const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const parts = dotPath.split('.');
    if (parts.some((p) => BLOCKED_KEYS.has(p))) {
      throw new Error(`Invalid config path: ${dotPath}`);
    }

    // Build nested updates object from dot-path
    const updates: Record<string, unknown> = {};
    let target = updates;
    for (let i = 0; i < parts.length - 1; i++) {
      target[parts[i]!] = {};
      target = target[parts[i]!] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]!] = value;

    await this.save(updates, dotPath);
  }

  resolveWorkspace(input?: string): string {
    if (!input) {
      const resolved = expandHome(this.config.workspace.baseDir);
      fs.mkdirSync(resolved, { recursive: true });
      return resolved;
    }

    // Absolute or tilde paths: must resolve under baseDir
    if (input.startsWith("/") || input.startsWith("~")) {
      const resolved = expandHome(input);
      const base = expandHome(this.config.workspace.baseDir);
      // Allow baseDir itself and paths under it
      if (resolved === base || resolved.startsWith(base + path.sep)) {
        fs.mkdirSync(resolved, { recursive: true });
        return resolved;
      }
      throw new Error(
        `Workspace path "${input}" is outside base directory "${this.config.workspace.baseDir}".`,
      );
    }

    // Named workspace: alphanumeric, hyphens, underscores only
    const name = input.replace(/[^a-zA-Z0-9_-]/g, "");
    if (name !== input) {
      throw new Error(
        `Invalid workspace name: "${input}". Only alphanumeric characters, hyphens, and underscores are allowed.`,
      );
    }
    const resolved = path.join(
      expandHome(this.config.workspace.baseDir),
      name.toLowerCase(),
    );
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  async exists(): Promise<boolean> {
    return fs.existsSync(this.configPath);
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async writeNew(config: Config): Promise<void> {
    const dir = path.dirname(this.configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  async applyEnvToPluginSettings(settingsManager: SettingsManager): Promise<void> {
    const pluginOverrides: Array<{
      envVar: string;
      pluginName: string;
      key: string;
      transform?: (v: string) => unknown;
    }> = [
      { envVar: 'OPENACP_TUNNEL_ENABLED', pluginName: '@openacp/tunnel', key: 'enabled', transform: v => v === 'true' },
      { envVar: 'OPENACP_TUNNEL_PORT', pluginName: '@openacp/tunnel', key: 'port', transform: v => Number(v) },
      { envVar: 'OPENACP_TUNNEL_PROVIDER', pluginName: '@openacp/tunnel', key: 'provider' },
      { envVar: 'OPENACP_API_PORT', pluginName: '@openacp/api-server', key: 'port', transform: v => Number(v) },
      { envVar: 'OPENACP_SPEECH_STT_PROVIDER', pluginName: '@openacp/speech', key: 'sttProvider' },
      { envVar: 'OPENACP_SPEECH_GROQ_API_KEY', pluginName: '@openacp/speech', key: 'groqApiKey' },
      { envVar: 'OPENACP_TELEGRAM_BOT_TOKEN', pluginName: '@openacp/telegram', key: 'botToken' },
      { envVar: 'OPENACP_TELEGRAM_CHAT_ID', pluginName: '@openacp/telegram', key: 'chatId', transform: v => Number(v) },
      // Future adapters — no-ops if plugin settings don't exist
      { envVar: 'OPENACP_DISCORD_BOT_TOKEN', pluginName: '@openacp/discord-adapter', key: 'botToken' },
      { envVar: 'OPENACP_DISCORD_GUILD_ID', pluginName: '@openacp/discord-adapter', key: 'guildId' },
      { envVar: 'OPENACP_SLACK_BOT_TOKEN', pluginName: '@openacp/slack-adapter', key: 'botToken' },
      { envVar: 'OPENACP_SLACK_APP_TOKEN', pluginName: '@openacp/slack-adapter', key: 'appToken' },
      { envVar: 'OPENACP_SLACK_SIGNING_SECRET', pluginName: '@openacp/slack-adapter', key: 'signingSecret' },
    ];

    for (const { envVar, pluginName, key, transform } of pluginOverrides) {
      const value = process.env[envVar];
      if (value !== undefined) {
        const resolved = transform ? transform(value) : value;
        await settingsManager.updatePluginSettings(pluginName, { [key]: resolved });
        log.debug({ envVar, pluginName, key }, 'Env var override applied to plugin settings');
      }
    }
  }

  private applyEnvOverrides(raw: Record<string, unknown>): void {
    const overrides: [string, string[]][] = [
      ["OPENACP_DEFAULT_AGENT", ["defaultAgent"]],
      ["OPENACP_RUN_MODE", ["runMode"]],
    ];
    for (const [envVar, configPath] of overrides) {
      const value = process.env[envVar];
      if (value !== undefined) {
        let target: Record<string, unknown> = raw;
        for (let i = 0; i < configPath.length - 1; i++) {
          if (!target[configPath[i]]) target[configPath[i]] = {};
          target = target[configPath[i]] as Record<string, unknown>;
        }
        const key = configPath[configPath.length - 1];
        target[key] = value;
      }
    }

    // Logging env var overrides
    if (process.env.OPENACP_LOG_LEVEL) {
      raw.logging = raw.logging || {};
      (raw.logging as Record<string, unknown>).level =
        process.env.OPENACP_LOG_LEVEL;
    }
    if (process.env.OPENACP_LOG_DIR) {
      raw.logging = raw.logging || {};
      (raw.logging as Record<string, unknown>).logDir =
        process.env.OPENACP_LOG_DIR;
    }
    if (process.env.OPENACP_DEBUG && !process.env.OPENACP_LOG_LEVEL) {
      raw.logging = raw.logging || {};
      (raw.logging as Record<string, unknown>).level = "debug";
    }
  }

  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): void {
    const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    for (const key of Object.keys(source)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const val = source[key];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        if (!target[key]) target[key] = {};
        this.deepMerge(
          target[key] as Record<string, unknown>,
          val as Record<string, unknown>,
        );
      } else {
        target[key] = val;
      }
    }
  }
}
