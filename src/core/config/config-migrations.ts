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
