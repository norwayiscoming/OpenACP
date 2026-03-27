import fs from 'node:fs'
import path from 'node:path'

export interface PluginEntry {
  version: string
  installedAt: string
  updatedAt: string
  source: 'builtin' | 'npm' | 'local'
  enabled: boolean
  settingsPath: string
  description?: string
}

type RegisterInput = Omit<PluginEntry, 'installedAt' | 'updatedAt'>

interface RegistryData {
  installed: Record<string, PluginEntry>
}

export class PluginRegistry {
  private data: RegistryData = { installed: {} }

  constructor(private registryPath: string) {}

  list(): Map<string, PluginEntry> {
    return new Map(Object.entries(this.data.installed))
  }

  get(name: string): PluginEntry | undefined {
    return this.data.installed[name]
  }

  register(name: string, entry: RegisterInput): void {
    const now = new Date().toISOString()
    this.data.installed[name] = { ...entry, installedAt: now, updatedAt: now }
  }

  remove(name: string): void {
    delete this.data.installed[name]
  }

  setEnabled(name: string, enabled: boolean): void {
    const entry = this.data.installed[name]
    if (!entry) return
    entry.enabled = enabled
    entry.updatedAt = new Date().toISOString()
  }

  updateVersion(name: string, version: string): void {
    const entry = this.data.installed[name]
    if (!entry) return
    entry.version = version
    entry.updatedAt = new Date().toISOString()
  }

  listEnabled(): Map<string, PluginEntry> {
    return new Map(Object.entries(this.data.installed).filter(([, e]) => e.enabled))
  }

  listBySource(source: PluginEntry['source']): Map<string, PluginEntry> {
    return new Map(Object.entries(this.data.installed).filter(([, e]) => e.source === source))
  }

  async load(): Promise<void> {
    try {
      const content = fs.readFileSync(this.registryPath, 'utf-8')
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed.installed === 'object') {
        this.data = parsed
      }
    } catch {
      this.data = { installed: {} }
    }
  }

  async save(): Promise<void> {
    const dir = path.dirname(this.registryPath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.registryPath, JSON.stringify(this.data, null, 2))
  }
}
