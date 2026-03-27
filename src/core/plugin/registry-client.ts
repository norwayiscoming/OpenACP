const REGISTRY_URL = 'https://raw.githubusercontent.com/Open-ACP/plugin-registry/main/registry.json'
const CACHE_TTL = 60 * 1000  // 1 minute

export interface RegistryPlugin {
  name: string
  displayName?: string
  description: string
  npm: string
  version: string
  minCliVersion: string
  category: string
  tags: string[]
  icon: string
  author: string
  repository: string
  license: string
  verified: boolean
  featured: boolean
}

export interface Registry {
  version: number
  generatedAt: string
  pluginCount: number
  plugins: RegistryPlugin[]
  categories: Array<{ id: string; name: string; icon: string }>
}

export class RegistryClient {
  private cache: { data: Registry; fetchedAt: number } | null = null
  private registryUrl: string

  constructor(registryUrl?: string) {
    this.registryUrl = registryUrl ?? REGISTRY_URL
  }

  async getRegistry(): Promise<Registry> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL) {
      return this.cache.data
    }
    const res = await fetch(this.registryUrl)
    if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status}`)
    const data = await res.json() as Registry
    this.cache = { data, fetchedAt: Date.now() }
    return data
  }

  async search(query: string): Promise<RegistryPlugin[]> {
    const registry = await this.getRegistry()
    const q = query.toLowerCase()
    return registry.plugins.filter(p => {
      const text = `${p.name} ${p.displayName ?? ''} ${p.description} ${p.tags?.join(' ') ?? ''}`.toLowerCase()
      return text.includes(q)
    })
  }

  async resolve(name: string): Promise<string | null> {
    const registry = await this.getRegistry()
    const plugin = registry.plugins.find(p => p.name === name)
    return plugin?.npm ?? null
  }

  clearCache(): void {
    this.cache = null
  }
}
