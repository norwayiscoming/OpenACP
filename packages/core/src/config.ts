import { z } from 'zod'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { log } from './log.js'

const BaseChannelSchema = z.object({
  enabled: z.boolean().default(false),
  adapter: z.string().optional(),  // package name for plugin adapters
}).passthrough()

export const PLUGINS_DIR = path.join(os.homedir(), '.openacp', 'plugins')

const AgentSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  workingDirectory: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
})

export const ConfigSchema = z.object({
  channels: z.record(z.string(), BaseChannelSchema),
  agents: z.record(z.string(), AgentSchema),
  defaultAgent: z.string(),
  workspace: z.object({
    baseDir: z.string().default('~/openacp-workspace'),
  }).default({}),
  security: z.object({
    allowedUserIds: z.array(z.string()).default([]),
    maxConcurrentSessions: z.number().default(5),
    sessionTimeoutMinutes: z.number().default(60),
  }).default({}),
})

export type Config = z.infer<typeof ConfigSchema>

export function expandHome(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1))
  }
  return p
}

const DEFAULT_CONFIG = {
  channels: {
    telegram: {
      enabled: false,
      botToken: "YOUR_BOT_TOKEN_HERE",
      chatId: 0,
      notificationTopicId: null,
      assistantTopicId: null
    }
  },
  agents: {
    claude: { command: "claude-agent-acp", args: [], env: {} },
    codex: { command: "codex", args: ["--acp"], env: {} }
  },
  defaultAgent: "claude",
  workspace: { baseDir: "~/openacp-workspace" },
  security: { allowedUserIds: [], maxConcurrentSessions: 5, sessionTimeoutMinutes: 60 }
}

export class ConfigManager {
  private config!: Config
  private configPath: string

  constructor() {
    this.configPath = process.env.OPENACP_CONFIG_PATH || expandHome('~/.openacp/config.json')
  }

  async load(): Promise<void> {
    // 1. Ensure directory exists
    const dir = path.dirname(this.configPath)
    fs.mkdirSync(dir, { recursive: true })

    // 2. If config file doesn't exist, create default
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
      log.info(`Config created at ${this.configPath}`)
      log.info('Please edit it with your Telegram bot token and chat ID, then restart.')
      process.exit(1)
    }

    // 3. Read and parse
    const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'))

    // 4. Apply env var overrides
    this.applyEnvOverrides(raw)

    // 5. Validate with Zod
    const result = ConfigSchema.safeParse(raw)
    if (!result.success) {
      log.error('Config validation failed:')
      for (const issue of result.error.issues) {
        log.error(`  ${issue.path.join('.')}: ${issue.message}`)
      }
      process.exit(1)
    }
    this.config = result.data
  }

  get(): Config {
    return this.config
  }

  async save(updates: Record<string, unknown>): Promise<void> {
    // Read current file, merge updates, write back
    const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'))
    this.deepMerge(raw, updates)
    fs.writeFileSync(this.configPath, JSON.stringify(raw, null, 2))
    // Re-validate and update in-memory config
    const result = ConfigSchema.safeParse(raw)
    if (result.success) {
      this.config = result.data
    }
  }

  resolveWorkspace(input?: string): string {
    if (!input) {
      const resolved = expandHome(this.config.workspace.baseDir)
      fs.mkdirSync(resolved, { recursive: true })
      return resolved
    }
    if (input.startsWith('/') || input.startsWith('~')) {
      const resolved = expandHome(input)
      fs.mkdirSync(resolved, { recursive: true })
      return resolved
    }
    // Named workspace → lowercase, under baseDir
    const name = input.toLowerCase()
    const resolved = path.join(expandHome(this.config.workspace.baseDir), name)
    fs.mkdirSync(resolved, { recursive: true })
    return resolved
  }

  async exists(): Promise<boolean> {
    return fs.existsSync(this.configPath)
  }

  getConfigPath(): string {
    return this.configPath
  }

  async writeNew(config: Config): Promise<void> {
    const dir = path.dirname(this.configPath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2))
  }

  private applyEnvOverrides(raw: Record<string, unknown>): void {
    const overrides: [string, string[]][] = [
      ['OPENACP_TELEGRAM_BOT_TOKEN', ['channels', 'telegram', 'botToken']],
      ['OPENACP_TELEGRAM_CHAT_ID', ['channels', 'telegram', 'chatId']],
      ['OPENACP_DEFAULT_AGENT', ['defaultAgent']],
    ]
    for (const [envVar, configPath] of overrides) {
      const value = process.env[envVar]
      if (value !== undefined) {
        let target = raw as Record<string, any>
        for (let i = 0; i < configPath.length - 1; i++) {
          if (!target[configPath[i]]) target[configPath[i]] = {}
          target = target[configPath[i]]
        }
        const key = configPath[configPath.length - 1]
        // Convert chatId to number
        target[key] = key === 'chatId' ? Number(value) : value
      }
    }
  }

  private deepMerge(target: Record<string, any>, source: Record<string, any>): void {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {}
        this.deepMerge(target[key], source[key])
      } else {
        target[key] = source[key]
      }
    }
  }
}
