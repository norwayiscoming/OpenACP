export class ServiceRegistry {
  private services = new Map<string, { implementation: unknown; pluginName: string }>()

  register<T>(name: string, implementation: T, pluginName: string): void {
    if (this.services.has(name)) {
      const existing = this.services.get(name)!
      throw new Error(`Service '${name}' already registered by ${existing.pluginName}. Plugin ${pluginName} cannot register it without override.`)
    }
    this.services.set(name, { implementation, pluginName })
  }

  registerOverride<T>(name: string, implementation: T, pluginName: string): void {
    this.services.set(name, { implementation, pluginName })
  }

  get<T>(name: string): T | undefined {
    return this.services.get(name)?.implementation as T | undefined
  }

  has(name: string): boolean {
    return this.services.has(name)
  }

  list(): Array<{ name: string; pluginName: string }> {
    return [...this.services.entries()].map(([name, { pluginName }]) => ({ name, pluginName }))
  }

  unregister(name: string): void {
    this.services.delete(name)
  }

  unregisterByPlugin(pluginName: string): void {
    for (const [name, entry] of this.services) {
      if (entry.pluginName === pluginName) {
        this.services.delete(name)
      }
    }
  }
}
