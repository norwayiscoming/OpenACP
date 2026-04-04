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

  load(): void {
    try {
      const raw = fs.readFileSync(this.registryPath, 'utf-8')
      const parsed = JSON.parse(raw) as RegistryData
      if (parsed.version === 1 && parsed.instances) {
        this.data = parsed
        this.deduplicate()
      }
    } catch {
      // File doesn't exist or invalid — start fresh
    }
  }

  /** Remove duplicate entries that point to the same root, keeping the first one */
  private deduplicate(): void {
    const seen = new Set<string>()
    const toRemove: string[] = []
    for (const [id, entry] of Object.entries(this.data.instances)) {
      if (seen.has(entry.root)) {
        toRemove.push(id)
      } else {
        seen.add(entry.root)
      }
    }
    if (toRemove.length > 0) {
      for (const id of toRemove) delete this.data.instances[id]
      this.save() // auto-clean on load
    }
  }

  save(): void {
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
