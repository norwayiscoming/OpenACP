import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import type { InstalledAgent } from "./types.js";
import { createChildLogger } from "./log.js";

const log = createChildLogger({ module: "agent-store" });

const InstalledAgentSchema = z.object({
  registryId: z.string().nullable(),
  name: z.string(),
  version: z.string(),
  distribution: z.enum(["npx", "uvx", "binary", "custom"]),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  workingDirectory: z.string().optional(),
  installedAt: z.string(),
  binaryPath: z.string().nullable().default(null),
});

const AgentStoreSchema = z.object({
  version: z.number().default(1),
  installed: z.record(z.string(), InstalledAgentSchema).default({}),
});

type AgentStoreData = z.infer<typeof AgentStoreSchema>;

export class AgentStore {
  private data: AgentStoreData = { version: 1, installed: {} };
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(os.homedir(), ".openacp", "agents.json");
  }

  load(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      this.data = { version: 1, installed: {} };
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8") as string);
      const result = AgentStoreSchema.safeParse(raw);
      if (result.success) {
        this.data = result.data;
      } else {
        log.warn({ errors: result.error.issues }, "Invalid agents.json, starting fresh");
        this.data = { version: 1, installed: {} };
      }
    } catch (err) {
      log.warn({ err }, "Failed to read agents.json, starting fresh");
      this.data = { version: 1, installed: {} };
    }
  }

  exists(): boolean {
    return fs.existsSync(this.filePath);
  }

  getInstalled(): Record<string, InstalledAgent> {
    return this.data.installed;
  }

  getAgent(key: string): InstalledAgent | undefined {
    return this.data.installed[key];
  }

  addAgent(key: string, agent: InstalledAgent): void {
    this.data.installed[key] = agent;
    this.save();
  }

  removeAgent(key: string): void {
    delete this.data.installed[key];
    this.save();
  }

  hasAgent(key: string): boolean {
    return key in this.data.installed;
  }

  private save(): void {
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }
}
