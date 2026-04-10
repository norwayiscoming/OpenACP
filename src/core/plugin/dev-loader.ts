import fs from 'node:fs'
import path from 'node:path'
import type { OpenACPPlugin } from './types.js'

/** Monotonic counter appended to import URLs to bust Node's ESM module cache on reload. */
let loadCounter = 0

/**
 * Loads a plugin from a local directory path instead of npm.
 *
 * Used by `openacp dev --plugin <path>` for plugin development.
 * Expects the plugin to be pre-built (dist/index.js must exist).
 * Supports hot-reload by appending a cache-busting query string to the
 * import URL — Node.js caches ESM modules by URL, so unique URLs force re-import.
 */
export class DevPluginLoader {
  private pluginPath: string

  constructor(pluginPath: string) {
    this.pluginPath = path.resolve(pluginPath)
  }

  /**
   * Import the plugin's default export from dist/index.js.
   * Each call uses a unique URL query to bypass Node's ESM cache.
   */
  async load(): Promise<OpenACPPlugin> {
    const distIndex = path.join(this.pluginPath, 'dist', 'index.js')
    const srcIndex = path.join(this.pluginPath, 'src', 'index.ts')

    if (!fs.existsSync(distIndex) && !fs.existsSync(srcIndex)) {
      throw new Error(`Plugin not found at ${this.pluginPath}. Expected dist/index.js or src/index.ts`)
    }

    if (!fs.existsSync(distIndex)) {
      throw new Error(`Built plugin not found at ${distIndex}. Run 'npm run build' first.`)
    }

    // Node.js caches ESM imports by URL. Use a unique query string to bust
    // the cache on each reload while keeping the file in its original directory
    // so that relative imports (e.g., './adapter.js') still resolve correctly.
    const cacheBuster = `v=${Date.now()}-${++loadCounter}`
    const mod = await import(`file://${distIndex}?${cacheBuster}`)
    const plugin = mod.default as OpenACPPlugin

    if (!plugin || !plugin.name || !plugin.setup) {
      throw new Error(`Invalid plugin at ${distIndex}. Must export default OpenACPPlugin with name and setup().`)
    }

    return plugin
  }

  /** Returns the resolved absolute path to the plugin's root directory. */
  getPluginPath(): string {
    return this.pluginPath
  }

  /** Returns the path to the plugin's dist directory. */
  getDistPath(): string {
    return path.join(this.pluginPath, 'dist')
  }
}
