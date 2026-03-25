import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AgentStore } from "./agent-store.js";
import { installAgent, uninstallAgent, resolveDistribution } from "./agent-installer.js";
import { getAgentAlias, checkDependencies } from "./agent-dependencies.js";
import type {
  AgentDefinition,
  RegistryAgent,
  AgentListItem,
  AvailabilityResult,
  InstallProgress,
  InstallResult,
  InstalledAgent,
} from "./types.js";
import { createChildLogger } from "./log.js";

const log = createChildLogger({ module: "agent-catalog" });

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CACHE_PATH = path.join(os.homedir(), ".openacp", "registry-cache.json");
const DEFAULT_TTL_HOURS = 24;

interface RegistryCache {
  fetchedAt: string;
  ttlHours: number;
  data: { agents: RegistryAgent[] };
}

export class AgentCatalog {
  private store: AgentStore;
  private registryAgents: RegistryAgent[] = [];

  constructor(store?: AgentStore) {
    this.store = store ?? new AgentStore();
  }

  load(): void {
    this.store.load();
    this.loadRegistryFromCacheOrSnapshot();
    this.enrichInstalledFromRegistry();
  }

  // --- Registry ---

  async fetchRegistry(): Promise<void> {
    try {
      log.info("Fetching agent registry from CDN...");
      const response = await fetch(REGISTRY_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { agents: RegistryAgent[] };
      this.registryAgents = data.agents ?? [];

      const cache: RegistryCache = {
        fetchedAt: new Date().toISOString(),
        ttlHours: DEFAULT_TTL_HOURS,
        data,
      };
      fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
      log.info({ count: this.registryAgents.length }, "Registry updated");
    } catch (err) {
      log.warn({ err }, "Failed to fetch registry, using cached data");
    }
  }

  async refreshRegistryIfStale(): Promise<void> {
    if (this.isCacheStale()) {
      await this.fetchRegistry();
    }
  }

  getRegistryAgents(): RegistryAgent[] {
    return this.registryAgents;
  }

  getRegistryAgent(registryId: string): RegistryAgent | undefined {
    return this.registryAgents.find((a) => a.id === registryId);
  }

  findRegistryAgent(keyOrId: string): RegistryAgent | undefined {
    const byId = this.registryAgents.find((a) => a.id === keyOrId);
    if (byId) return byId;
    return this.registryAgents.find((a) => getAgentAlias(a.id) === keyOrId);
  }

  // --- Installed ---

  getInstalled(): InstalledAgent[] {
    return Object.values(this.store.getInstalled());
  }

  getInstalledEntries(): Record<string, InstalledAgent> {
    return this.store.getInstalled();
  }

  getInstalledAgent(key: string): InstalledAgent | undefined {
    return this.store.getAgent(key);
  }

  // --- Discovery ---

  getAvailable(): AgentListItem[] {
    const installed = this.store.getInstalled();
    const items: AgentListItem[] = [];
    const seenKeys = new Set<string>();

    for (const [key, agent] of Object.entries(installed)) {
      seenKeys.add(key);
      const availability = agent.registryId
        ? checkDependencies(agent.registryId)
        : { available: true };
      const registryEntry = agent.registryId
        ? this.registryAgents.find((a) => a.id === agent.registryId)
        : undefined;
      items.push({
        key,
        registryId: agent.registryId ?? key,
        name: agent.name,
        version: agent.version,
        description: registryEntry?.description,
        distribution: agent.distribution,
        installed: true,
        available: availability.available,
        missingDeps: availability.missing?.map((m) => m.label),
      });
    }

    for (const agent of this.registryAgents) {
      const alias = getAgentAlias(agent.id);
      if (seenKeys.has(alias)) continue;
      seenKeys.add(alias);

      const dist = resolveDistribution(agent);
      const availability = checkDependencies(agent.id);

      items.push({
        key: alias,
        registryId: agent.id,
        name: agent.name,
        version: agent.version,
        description: agent.description,
        distribution: dist?.type ?? "binary",
        installed: false,
        available: dist !== null && availability.available,
        missingDeps: availability.missing?.map((m) => m.label),
      });
    }

    return items;
  }

  checkAvailability(keyOrId: string): AvailabilityResult {
    const agent = this.findRegistryAgent(keyOrId);
    if (!agent) return { available: false, reason: "Not found in the agent registry." };

    const dist = resolveDistribution(agent);
    if (!dist) {
      return { available: false, reason: `Not available for your system. Check ${agent.website ?? agent.repository ?? "their website"} for other options.` };
    }

    return checkDependencies(agent.id);
  }

  // --- Install/Uninstall ---

  async install(keyOrId: string, progress?: InstallProgress, force?: boolean): Promise<InstallResult> {
    const agent = this.findRegistryAgent(keyOrId);
    if (!agent) {
      const msg = `"${keyOrId}" was not found in the agent registry. Run "openacp agents" to see what's available.`;
      await progress?.onError(msg);
      return { ok: false, agentKey: keyOrId, error: msg };
    }

    const agentKey = getAgentAlias(agent.id);
    if (this.store.hasAgent(agentKey) && !force) {
      const existing = this.store.getAgent(agentKey)!;
      const msg = `${agent.name} is already installed (v${existing.version}). Use --force to reinstall.`;
      await progress?.onError(msg);
      return { ok: false, agentKey, error: msg };
    }

    return installAgent(agent, this.store, progress);
  }

  async uninstall(key: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.store.hasAgent(key)) {
      return { ok: false, error: `"${key}" is not installed.` };
    }
    await uninstallAgent(key, this.store);
    return { ok: true };
  }

  // --- Resolution (for AgentManager) ---

  resolve(key: string): AgentDefinition | undefined {
    const agent = this.store.getAgent(key);
    if (!agent) return undefined;
    return {
      name: key,
      command: agent.command,
      args: agent.args,
      workingDirectory: agent.workingDirectory,
      env: agent.env,
    };
  }

  // --- Internal ---

  /**
   * Enrich installed agents (especially migrated ones) with registry data.
   * Fixes agents that were migrated with version:"unknown", distribution:"custom",
   * or generic names by matching them to registry entries.
   */
  private enrichInstalledFromRegistry(): void {
    const installed = this.store.getInstalled();
    let changed = false;

    for (const [key, agent] of Object.entries(installed)) {
      const regAgent = agent.registryId
        ? this.registryAgents.find((a) => a.id === agent.registryId)
        : this.registryAgents.find((a) => getAgentAlias(a.id) === key);

      if (!regAgent) continue;

      let updated = false;

      // Enrich name if it's a generic capitalized key (e.g. "Claude" from migration)
      if (agent.name !== regAgent.name) {
        agent.name = regAgent.name;
        updated = true;
      }

      // Enrich version if unknown
      if (agent.version === "unknown") {
        agent.version = regAgent.version;
        updated = true;
      }

      // Enrich registryId if missing
      if (!agent.registryId) {
        agent.registryId = regAgent.id;
        updated = true;
      }

      // Enrich distribution from "custom" to actual type
      if (agent.distribution === "custom") {
        const dist = resolveDistribution(regAgent);
        if (dist) {
          agent.distribution = dist.type;
          updated = true;
        }
      }

      if (updated) {
        this.store.addAgent(key, agent);
        changed = true;
      }
    }

    if (changed) {
      log.info("Enriched installed agents with registry data");
    }
  }

  private isCacheStale(): boolean {
    if (!fs.existsSync(CACHE_PATH)) return true;
    try {
      const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8") as string) as RegistryCache;
      const fetchedAt = new Date(raw.fetchedAt).getTime();
      const ttlMs = (raw.ttlHours ?? DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
      return Date.now() - fetchedAt > ttlMs;
    } catch {
      return true;
    }
  }

  private loadRegistryFromCacheOrSnapshot(): void {
    // Try cache first
    if (fs.existsSync(CACHE_PATH)) {
      try {
        const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8") as string) as RegistryCache;
        if (raw.data?.agents) {
          this.registryAgents = raw.data.agents;
          log.debug({ count: this.registryAgents.length }, "Loaded registry from cache");
          return;
        }
      } catch {
        log.warn("Failed to load registry cache");
      }
    }

    // Fallback: bundled snapshot
    try {
      // Try multiple paths for tsc and tsup builds
      const candidates = [
        path.join(import.meta.dirname, "data", "registry-snapshot.json"),
        path.join(import.meta.dirname, "..", "data", "registry-snapshot.json"),
        path.join(import.meta.dirname, "..", "..", "data", "registry-snapshot.json"),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          const raw = JSON.parse(fs.readFileSync(candidate, "utf-8") as string);
          this.registryAgents = raw.agents ?? [];
          log.debug({ count: this.registryAgents.length }, "Loaded registry from bundled snapshot");
          return;
        }
      }

      log.warn("No registry data available (no cache, no snapshot)");
    } catch {
      log.warn("Failed to load bundled registry snapshot");
    }
  }
}
