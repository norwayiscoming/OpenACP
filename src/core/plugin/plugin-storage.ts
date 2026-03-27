import fs from 'node:fs'
import path from 'node:path'
import type { PluginStorage } from './types.js'

export class PluginStorageImpl implements PluginStorage {
  private readonly kvPath: string
  private readonly dataDir: string
  private writeChain: Promise<void> = Promise.resolve()

  constructor(baseDir: string) {
    this.dataDir = path.join(baseDir, 'data')
    this.kvPath = path.join(baseDir, 'kv.json')
    fs.mkdirSync(baseDir, { recursive: true })
  }

  private readKv(): Record<string, unknown> {
    try {
      const raw = fs.readFileSync(this.kvPath, 'utf-8')
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private writeKv(data: Record<string, unknown>): void {
    fs.writeFileSync(this.kvPath, JSON.stringify(data), 'utf-8')
  }

  async get<T>(key: string): Promise<T | undefined> {
    const data = this.readKv()
    return key in data ? (data[key] as T) : undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.writeChain = this.writeChain.then(() => {
      const data = this.readKv()
      data[key] = value
      this.writeKv(data)
    })
    return this.writeChain
  }

  async delete(key: string): Promise<void> {
    this.writeChain = this.writeChain.then(() => {
      const data = this.readKv()
      delete data[key]
      this.writeKv(data)
    })
    return this.writeChain
  }

  async list(): Promise<string[]> {
    return Object.keys(this.readKv())
  }

  getDataDir(): string {
    fs.mkdirSync(this.dataDir, { recursive: true })
    return this.dataDir
  }
}
