import { describe, it, expect, afterEach } from 'vitest'
import { createApiServer } from '../server.js'
import { TokenStore } from '../auth/token-store.js'
import { pluginRoutes } from '../routes/plugins.js'
import type { RouteDeps } from '../routes/types.js'
import type { LifecycleManager } from '../../../core/plugin/lifecycle-manager.js'
import type { PluginRegistry, PluginEntry } from '../../../core/plugin/plugin-registry.js'
import type { OpenACPPlugin } from '../../../core/plugin/types.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const SECRET = 'b'.repeat(64)
const JWT_SECRET = 'plugin-test-jwt-secret'

function authHeaders() {
  return { authorization: `Bearer ${SECRET}` }
}

function makeRegistry(entries: Record<string, Partial<PluginEntry>>): PluginRegistry {
  return {
    list: () => new Map(Object.entries(entries).map(([name, e]) => [name, {
      version: '1.0.0',
      installedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      source: 'builtin' as const,
      enabled: true,
      settingsPath: '/tmp/settings.json',
      ...e,
    }])),
    get: (name: string) => {
      const e = entries[name]
      if (!e) return undefined
      return {
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        source: 'builtin' as const,
        enabled: true,
        settingsPath: '/tmp/settings.json',
        ...e,
      }
    },
    setEnabled: () => {},
    remove: () => {},
    save: async () => {},
    register: () => {},
  } as unknown as PluginRegistry
}

function makeLifecycleManager(opts: {
  registryEntries?: Record<string, Partial<PluginEntry>>
  loadedPlugins?: string[]
  failedPlugins?: string[]
  pluginDefs?: OpenACPPlugin[]
  instanceRoot?: string
  bootFn?: (plugins: OpenACPPlugin[]) => Promise<void>
  unloadFn?: (name: string) => Promise<void>
}): LifecycleManager {
  return {
    registry: makeRegistry(opts.registryEntries ?? {}),
    loadedPlugins: opts.loadedPlugins ?? [],
    failedPlugins: opts.failedPlugins ?? [],
    plugins: opts.pluginDefs ?? [],
    instanceRoot: opts.instanceRoot,
    boot: opts.bootFn ?? (async () => {}),
    unloadPlugin: opts.unloadFn ?? (async () => {}),
  } as unknown as LifecycleManager
}

describe('plugin routes', () => {
  let server: Awaited<ReturnType<typeof createApiServer>> | null = null
  let tokenStore: TokenStore
  let tmpDir: string

  async function buildServer(lm: LifecycleManager) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-routes-test-'))
    const tokensFile = path.join(tmpDir, 'tokens.json')
    tokenStore = new TokenStore(tokensFile)
    await tokenStore.load()

    server = await createApiServer({
      port: 0,
      host: '127.0.0.1',
      getSecret: () => SECRET,
      getJwtSecret: () => JWT_SECRET,
      tokenStore,
    })

    const deps: Partial<RouteDeps> = {
      lifecycleManager: lm,
    }

    server.registerPlugin('/api/v1/plugins', async (app) => {
      await pluginRoutes(app, deps as RouteDeps)
    })

    await server.app.ready()
  }

  afterEach(async () => {
    if (server) {
      await server.app.close()
      server = null
    }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('GET /api/v1/plugins', () => {
    it('returns installed plugins with runtime state', async () => {
      const lm = makeLifecycleManager({
        registryEntries: {
          '@openacp/telegram': { source: 'builtin', enabled: true },
          '@openacp/translator': { source: 'npm', enabled: false },
        },
        loadedPlugins: ['@openacp/telegram'],
        failedPlugins: [],
        pluginDefs: [
          { name: '@openacp/telegram', version: '1.0.0', essential: true, configure: async () => {}, setup: async () => {} } as unknown as OpenACPPlugin,
        ],
      })
      await buildServer(lm)

      const res = await server!.app.inject({
        method: 'GET',
        url: '/api/v1/plugins',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.plugins).toHaveLength(2)

      const telegram = body.plugins.find((p: any) => p.name === '@openacp/telegram')
      expect(telegram).toMatchObject({
        name: '@openacp/telegram',
        source: 'builtin',
        enabled: true,
        loaded: true,
        failed: false,
        essential: true,
        hasConfigure: true,
      })

      const translator = body.plugins.find((p: any) => p.name === '@openacp/translator')
      expect(translator).toMatchObject({
        name: '@openacp/translator',
        source: 'npm',
        enabled: false,
        loaded: false,
        failed: false,
        essential: false,
        hasConfigure: false,
      })
    })

    it('returns 401 without auth', async () => {
      await buildServer(makeLifecycleManager({}))
      const res = await server!.app.inject({ method: 'GET', url: '/api/v1/plugins' })
      expect(res.statusCode).toBe(401)
    })
  })
})
