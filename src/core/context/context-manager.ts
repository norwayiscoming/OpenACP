import * as os from "node:os";
import * as path from "node:path";
import type { ContextProvider, ContextQuery, ContextOptions, ContextResult, SessionListResult } from "./context-provider.js";
import { ContextCache } from "./context-cache.js";

export class ContextManager {
  private providers: ContextProvider[] = [];
  private cache: ContextCache;

  constructor() {
    this.cache = new ContextCache(path.join(os.homedir(), ".openacp", "cache", "entire"));
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
    const provider = await this.getProvider(query.repoPath);
    if (!provider) return null;
    return provider.listSessions(query);
  }

  async buildContext(query: ContextQuery, options?: ContextOptions): Promise<ContextResult | null> {
    const queryKey = `${query.type}:${query.value}:${options?.limit ?? ""}:${options?.maxTokens ?? ""}`;
    const cached = this.cache.get(query.repoPath, queryKey);
    if (cached) return cached;

    const provider = await this.getProvider(query.repoPath);
    if (!provider) return null;
    const result = await provider.buildContext(query, options);
    if (result) this.cache.set(query.repoPath, queryKey, result);
    return result;
  }
}
