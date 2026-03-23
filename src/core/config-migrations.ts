import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createChildLogger } from "./log.js";
const log = createChildLogger({ module: "config-migrations" });

type RawConfig = Record<string, unknown>;

export interface Migration {
  name: string;
  apply: (raw: RawConfig) => boolean; // returns true if config was modified
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
      for (const [agentName, agentDef] of Object.entries(agents as Record<string, any>)) {
        if (!agentDef?.command) continue;
        for (const [correctCmd, legacyCmds] of Object.entries(COMMAND_MIGRATIONS)) {
          if (legacyCmds.includes(agentDef.command)) {
            log.warn(
              { agent: agentName, oldCommand: agentDef.command, newCommand: correctCmd },
              `Auto-migrating agent command: "${agentDef.command}" → "${correctCmd}"`,
            );
            agentDef.command = correctCmd;
            changed = true;
          }
        }
      }
      return changed;
    },
  },
  {
    name: "migrate-agents-to-store",
    apply(raw) {
      const agentsJsonPath = path.join(os.homedir(), ".openacp", "agents.json");
      if (fs.existsSync(agentsJsonPath)) return false;

      const agents = raw.agents as Record<string, any> | undefined;
      if (!agents || Object.keys(agents).length === 0) return false;

      const COMMAND_TO_REGISTRY: Record<string, string> = {
        "claude-agent-acp": "claude-acp",
        "codex": "codex-acp",
      };

      const installed: Record<string, any> = {};
      for (const [key, cfg] of Object.entries(agents)) {
        const registryId = COMMAND_TO_REGISTRY[cfg.command] ?? null;
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
];

/**
 * Apply all migrations to raw config (mutates in place).
 * Returns whether any changes were made.
 */
export function applyMigrations(
  raw: RawConfig,
  migrationList: Migration[] = migrations,
): { changed: boolean } {
  let changed = false;
  for (const migration of migrationList) {
    if (migration.apply(raw)) {
      changed = true;
    }
  }
  return { changed };
}
