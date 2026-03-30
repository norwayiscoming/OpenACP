import fs from 'node:fs'
import path from 'node:path'

export interface InstanceRegistryEntry {
  id: string
  root: string
}

interface RegistryData {
  version: 1
  instances: Record<string, InstanceRegistryEntry>
}

export class InstanceRegistry {
  private data: RegistryData = { version: 1, instances: {} }

  constructor(private registryPath: string) {}

  async load(): Promise<void> {
    try {
      const raw = fs.readFileSync(this.registryPath, 'utf-8')
      const parsed = JSON.parse(raw) as RegistryData
      if (parsed.version === 1 && parsed.instances) {
        this.data = parsed
      }
    } catch {
      // File doesn't exist or invalid — start fresh
    }
  }

  async save(): Promise<void> {
    const dir = path.dirname(this.registryPath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.registryPath, JSON.stringify(this.data, null, 2))
  }

  register(id: string, root: string): void {
    this.data.instances[id] = { id, root }
  }

  remove(id: string): void {
    delete this.data.instances[id]
  }

  get(id: string): InstanceRegistryEntry | undefined {
    return this.data.instances[id]
  }

  getByRoot(root: string): InstanceRegistryEntry | undefined {
    return Object.values(this.data.instances).find((e) => e.root === root)
  }

  list(): InstanceRegistryEntry[] {
    return Object.values(this.data.instances)
  }

  uniqueId(baseId: string): string {
    if (!this.data.instances[baseId]) return baseId
    let n = 2
    while (this.data.instances[`${baseId}-${n}`]) n++
    return `${baseId}-${n}`
  }
}
