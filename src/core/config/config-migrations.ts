import * as fs from "node:fs";
import * as path from "node:path";
import { createChildLogger } from "../utils/log.js";
import { getGlobalRoot } from "../instance/instance-context.js";
const log = createChildLogger({ module: "config-migrations" });

type RawConfig = Record<string, unknown>;

export interface MigrationContext {
  configDir: string;
}

export interface Migration {
  name: string;
  apply: (raw: RawConfig, ctx?: MigrationContext) => boolean; // returns true if config was modified
}

export const migrations: Migration[] = [
  {
    name: "add-tunnel-section",
    apply(raw) {
      if (raw.tunnel) return false;
      raw.tunnel = {
        enabled: true,
        port: 3100,
        provider: "cloudflare",
        options: {},
        storeTtlMinutes: 60,
        auth: { enabled: false },
      };
      log.info("Added tunnel section to config (enabled by default with cloudflare)");
      return true;
    },
  },
  {
    name: "fix-agent-commands",
    apply(raw) {
      const COMMAND_MIGRATIONS: Record<string, string[]> = {
        "claude-agent-acp": ["claude", "claude-code"],
      };

      const agents = raw.agents;
      if (!agents || typeof agents !== "object") return false;

      let changed = false;
      for (const [agentName, agentDef] of Object.entries(agents as Record<string, unknown>)) {
        if (!agentDef || typeof agentDef !== "object" || !("command" in agentDef)) continue;
        const def = agentDef as Record<string, unknown>;
        if (typeof def.command !== "string") continue;
        for (const [correctCmd, legacyCmds] of Object.entries(COMMAND_MIGRATIONS)) {
          if (legacyCmds.includes(def.command as string)) {
            log.warn(
              { agent: agentName, oldCommand: def.command, newCommand: correctCmd },
              `Auto-migrating agent command: "${def.command}" → "${correctCmd}"`,
            );
            def.command = correctCmd;
            changed = true;
          }
        }
      }
      return changed;
    },
  },
  {
    name: "migrate-agents-to-store",
    apply(raw, ctx?) {
      const agentsJsonPath = path.join(ctx?.configDir ?? getGlobalRoot(), "agents.json");
      if (fs.existsSync(agentsJsonPath)) return false;

      const agents = raw.agents as Record<string, unknown> | undefined;
      if (!agents || Object.keys(agents).length === 0) return false;

      const COMMAND_TO_REGISTRY: Record<string, string> = {
        "claude-agent-acp": "claude-acp",
        "codex": "codex-acp",
      };

      const installed: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(agents)) {
        const cfg = val as Record<string, unknown>;
        const command = typeof cfg.command === "string" ? cfg.command : "";
        const registryId = COMMAND_TO_REGISTRY[command] ?? null;
        installed[key] = {
          registryId,
          name: key.charAt(0).toUpperCase() + key.slice(1),
          version: "unknown",
          distribution: "custom",
          command: cfg.command,
          args: cfg.args ?? [],
          env: cfg.env ?? {},
          workingDirectory: cfg.workingDirectory ?? undefined,
          installedAt: new Date().toISOString(),
          binaryPath: null,
        };
      }

      fs.mkdirSync(path.dirname(agentsJsonPath), { recursive: true });
      fs.writeFileSync(agentsJsonPath, JSON.stringify({ version: 1, installed }, null, 2));

      raw.agents = {};
      return true;
    },
  },
  {
    name: "add-instance-name",
    apply(raw) {
      if (raw.instanceName) return false;
      raw.instanceName = "Main";
      log.info("Added instanceName to config");
      return true;
    },
  },
  {
    name: "migrate-display-verbosity-to-output-mode",
    apply(raw) {
      const channels = raw.channels as Record<string, unknown> | undefined;
      if (!channels) return false;
      let changed = false;
      for (const [, channelCfg] of Object.entries(channels)) {
        if (!channelCfg || typeof channelCfg !== "object") continue;
        const cfg = channelCfg as Record<string, unknown>;
        if (cfg.displayVerbosity && !cfg.outputMode) {
          cfg.outputMode = cfg.displayVerbosity;
          changed = true;
        }
      }
      return changed;
    },
  },
  {
    name: "migrate-tunnel-provider-to-openacp",
    apply(raw) {
      const tunnel = raw.tunnel as Record<string, unknown> | undefined;
      if (!tunnel) return false;
      if (tunnel.provider !== "cloudflare") return false;
      tunnel.provider = "openacp";
      log.info("Migrated tunnel provider: cloudflare → openacp (OpenACP managed tunnel)");
      return true;
    },
  },
];

/**
 * Apply all migrations to raw config (mutates in place).
 * Returns whether any changes were made.
 */
export function applyMigrations(
  raw: RawConfig,
  migrationList: Migration[] = migrations,
  ctx?: MigrationContext,
): { changed: boolean } {
  let changed = false;
  for (const migration of migrationList) {
    if (migration.apply(raw, ctx)) {
      changed = true;
    }
  }
  return { changed };
}
