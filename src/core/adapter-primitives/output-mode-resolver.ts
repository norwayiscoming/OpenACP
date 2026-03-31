// src/core/adapter-primitives/output-mode-resolver.ts
import type { OutputMode } from "./format-types.js";

interface ConfigManagerLike {
  get(): Record<string, unknown>;
}

interface SessionManagerLike {
  getSessionRecord(id: string): { outputMode?: OutputMode } | undefined;
}

const VALID_MODES = new Set<string>(["low", "medium", "high"]);
function toOutputMode(v: unknown): OutputMode | undefined {
  return typeof v === "string" && VALID_MODES.has(v) ? (v as OutputMode) : undefined;
}

export class OutputModeResolver {
  resolve(
    configManager: ConfigManagerLike,
    adapterName: string,
    sessionId?: string,
    sessionManager?: SessionManagerLike,
  ): OutputMode {
    const config = configManager.get();
    // 1. Global default
    let mode: OutputMode = toOutputMode(config.outputMode) ?? "medium";
    // 2. Per-adapter override
    const channels = config.channels as Record<string, unknown> | undefined;
    const channelCfg = channels?.[adapterName] as Record<string, unknown> | undefined;
    const adapterMode = toOutputMode(channelCfg?.outputMode);
    if (adapterMode) mode = adapterMode;
    // 3. Per-session override (most specific)
    if (sessionId && sessionManager) {
      const record = sessionManager.getSessionRecord(sessionId);
      const sessionMode = toOutputMode(record?.outputMode);
      if (sessionMode) mode = sessionMode;
    }
    return mode;
  }
}
