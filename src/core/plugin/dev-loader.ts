import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { OpenACPPlugin } from './types.js'

let loadCounter = 0

export class DevPluginLoader {
  private pluginPath: string

  constructor(pluginPath: string) {
    this.pluginPath = path.resolve(pluginPath)
  }

  async load(): Promise<OpenACPPlugin> {
    const distIndex = path.join(this.pluginPath, 'dist', 'index.js')
    const srcIndex = path.join(this.pluginPath, 'src', 'index.ts')

    if (!fs.existsSync(distIndex) && !fs.existsSync(srcIndex)) {
      throw new Error(`Plugin not found at ${this.pluginPath}. Expected dist/index.js or src/index.ts`)
    }

    if (!fs.existsSync(distIndex)) {
      throw new Error(`Built plugin not found at ${distIndex}. Run 'npm run build' first.`)
    }

    // Node.js caches ESM imports by URL. To support reloading, copy the file
    // to a unique temp path so each load() gets a fresh module.
    const tmpDir = path.join(os.tmpdir(), 'openacp-dev-loader')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, `plugin-${Date.now()}-${++loadCounter}.mjs`)
    fs.copyFileSync(distIndex, tmpFile)

    try {
      const mod = await import(`file://${tmpFile}`)
      const plugin = mod.default as OpenACPPlugin

      if (!plugin || !plugin.name || !plugin.setup) {
        throw new Error(`Invalid plugin at ${distIndex}. Must export default OpenACPPlugin with name and setup().`)
      }

      return plugin
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  getPluginPath(): string {
    return this.pluginPath
  }

  getDistPath(): string {
    return path.join(this.pluginPath, 'dist')
  }
}
