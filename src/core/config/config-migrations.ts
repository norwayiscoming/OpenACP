import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createChildLogger } from "../utils/log.js";
const log = createChildLogger({ module: "config-migrations" });

type RawConfig = Record<string, unknown>;

export interface MigrationContext {
  configDir: string;
}

export interface Migration {
  name: string;
  apply: (raw: RawConfig, ctx?: MigrationContext) => boolean;
}

export const migrations: Migration[] = [
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
    name: "delete-display-verbosity",
    apply(raw) {
      if (!("displayVerbosity" in raw)) return false;
      delete raw.displayVerbosity;
      log.info("Removed legacy displayVerbosity key from config");
      return true;
    },
  },
  {
    name: "add-instance-id",
    apply(raw, ctx) {
      if (raw.id) return false; // already has id, skip
      if (!ctx?.configDir) return false; // no context, can't look up

      // ctx.configDir === instanceRoot (config.json lives at instanceRoot/config.json)
      const instanceRoot = ctx.configDir;

      try {
        const registryPath = path.join(os.homedir(), ".openacp", "instances.json");
        const data = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
        const instances = data?.instances ?? {};
        const entry = Object.values(instances).find(
          (e: any) => e.root === instanceRoot,
        ) as { id?: string } | undefined;
        if (entry?.id) {
          raw.id = entry.id;
          log.info({ instanceRoot }, "Migrated: added id to config from registry");
          return true;
        }
      } catch {
        /* best-effort — registry may not exist on fresh installs */
      }

      return false;
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
