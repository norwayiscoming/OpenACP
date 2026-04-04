import fs from "node:fs";
import path from "node:path";

export type TraceLayer = "acp" | "core" | "telegram";

// Evaluated once at module load — zero overhead when disabled
const DEBUG_ENABLED = process.env.OPENACP_DEBUG === "true" || process.env.OPENACP_DEBUG === "1";

/**
 * Per-session debug trace logger. Writes JSONL files to <workingDirectory>/.log/.
 * Only active when OPENACP_DEBUG=true. Zero overhead when disabled.
 *
 * Note: Uses appendFileSync for simplicity. This blocks the event loop briefly per write,
 * which is acceptable for a debug-only tool. The DEBUG_ENABLED guard ensures zero overhead
 * in production.
 */
export class DebugTracer {
  private dirCreated = false;
  private logDir: string;

  constructor(
    private sessionId: string,
    private workingDirectory: string,
  ) {
    this.logDir = path.join(workingDirectory, ".log");
  }

  log(layer: TraceLayer, data: Record<string, unknown>): void {
    try {
      if (!this.dirCreated) {
        fs.mkdirSync(this.logDir, { recursive: true });
        this.dirCreated = true;
      }
      const filePath = path.join(this.logDir, `${this.sessionId}_${layer}.jsonl`);
      const seen = new WeakSet();
      const line =
        JSON.stringify({ ts: Date.now(), ...data }, (_key, value) => {
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) return "[Circular]";
            seen.add(value);
          }
          return value;
        }) + "\n";
      fs.appendFileSync(filePath, line);
    } catch {
      // Debug logging must never crash the app
    }
  }

  /** No-op cleanup — establishes the pattern for future async implementations */
  destroy(): void {
    // No file handles to close with appendFileSync
  }
}

/**
 * Create a DebugTracer if debug mode is enabled, otherwise return null.
 * The DEBUG_ENABLED const is evaluated once at module load time from process.env.OPENACP_DEBUG.
 */
export function createDebugTracer(sessionId: string, workingDirectory: string): DebugTracer | null {
  if (!DEBUG_ENABLED) return null;
  return new DebugTracer(sessionId, workingDirectory);
}
