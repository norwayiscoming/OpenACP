import * as os from "node:os";
import * as path from "node:path";
import type { ContextProvider, ContextQuery, ContextOptions, ContextResult, SessionListResult } from "./context-provider.js";
import type { HistoryStore } from "./history/history-store.js";
import type { SessionHistory } from "./history/types.js";
import { ContextCache } from "./context-cache.js";

export class ContextManager {
  private providers: ContextProvider[] = [];
  private cache: ContextCache;
  private historyStore?: HistoryStore;
  private sessionFlusher?: (sessionId: string) => Promise<void>;

  constructor(cachePath?: string) {
    this.cache = new ContextCache(cachePath ?? path.join(os.homedir(), ".openacp", "cache", "entire"));
  }

  setHistoryStore(store: HistoryStore): void {
    this.historyStore = store;
  }

  /** Register a callback that flushes in-memory recorder state for a session to disk. */
  registerFlusher(fn: (sessionId: string) => Promise<void>): void {
    this.sessionFlusher = fn;
  }

  /**
   * Flush the recorder state for a session to disk before reading its context.
   * Call this before buildContext() when switching agents to avoid a race
   * where the last turn hasn't been persisted yet.
   */
  async flushSession(sessionId: string): Promise<void> {
    if (this.sessionFlusher) await this.sessionFlusher(sessionId);
  }

  async getHistory(sessionId: string): Promise<SessionHistory | null> {
    if (!this.historyStore) return null;
    return this.historyStore.read(sessionId);
  }

  register(provider: ContextProvider): void {
    this.providers.push(provider);
  }

  async getProvider(repoPath: string): Promise<ContextProvider | null> {
    for (const provider of this.providers) {
      if (await provider.isAvailable(repoPath)) return provider;
    }
    return null;
  }

  async listSessions(query: ContextQuery): Promise<SessionListResult | null> {
    for (const provider of this.providers) {
      if (!(await provider.isAvailable(query.repoPath))) continue;
      const result = await provider.listSessions(query);
      if (result.sessions.length > 0) return result;
    }
    return null;
  }

  async buildContext(query: ContextQuery, options?: ContextOptions): Promise<ContextResult | null> {
    const queryKey = `${query.type}:${query.value}:${options?.limit ?? ""}:${options?.maxTokens ?? ""}:${options?.labelAgent ?? ""}`;

    if (!options?.noCache) {
      const cached = this.cache.get(query.repoPath, queryKey);
      if (cached) return cached;
    }

    for (const provider of this.providers) {
      if (!(await provider.isAvailable(query.repoPath))) continue;
      const result = await provider.buildContext(query, options);
      if (result && result.markdown) {
        if (!options?.noCache) {
          this.cache.set(query.repoPath, queryKey, result);
        }
        return result;
      }
    }
    return null;
  }
}
