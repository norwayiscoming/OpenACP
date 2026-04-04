import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

export interface InstanceContext {
  id: string
  root: string
  isGlobal: boolean
  paths: {
    config: string
    sessions: string
    agents: string
    registryCache: string
    plugins: string
    pluginsData: string
    pluginRegistry: string
    logs: string
    pid: string
    running: string
    apiPort: string
    apiSecret: string
    bin: string
    cache: string
    tunnels: string
    agentsDir: string
  }
}

export interface CreateInstanceContextOpts {
  id: string
  root: string
  isGlobal: boolean
}

export function createInstanceContext(opts: CreateInstanceContextOpts): InstanceContext {
  const { id, root, isGlobal } = opts
  return {
    id, root, isGlobal,
    paths: {
      config: path.join(root, 'config.json'),
      sessions: path.join(root, 'sessions.json'),
      agents: path.join(root, 'agents.json'),
      registryCache: path.join(root, 'registry-cache.json'),
      plugins: path.join(root, 'plugins'),
      pluginsData: path.join(root, 'plugins', 'data'),
      pluginRegistry: path.join(root, 'plugins.json'),
      logs: path.join(root, 'logs'),
      pid: path.join(root, 'openacp.pid'),
      running: path.join(root, 'running'),
      apiPort: path.join(root, 'api.port'),
      apiSecret: path.join(root, 'api-secret'),
      bin: path.join(root, 'bin'),
      cache: path.join(root, 'cache'),
      tunnels: path.join(root, 'tunnels.json'),
      agentsDir: path.join(root, 'agents'),
    },
  }
}

export function generateSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return slug || 'openacp'
}

function expandHome(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1))
  return p
}

export interface ResolveOpts {
  dir?: string
  local?: boolean
  global?: boolean
  cwd?: string
}

export function resolveInstanceRoot(opts: ResolveOpts): string | null {
  const cwd = opts.cwd ?? process.cwd()
  if (opts.dir) return path.join(expandHome(opts.dir), '.openacp')
  if (opts.local) return path.join(cwd, '.openacp')
  if (opts.global) return path.join(os.homedir(), '.openacp')
  const localRoot = path.join(cwd, '.openacp')
  if (fs.existsSync(localRoot)) return localRoot
  // Inherit instance root from parent process (e.g. restart respawn)
  if (process.env.OPENACP_INSTANCE_ROOT) return process.env.OPENACP_INSTANCE_ROOT
  return null
}

export function getGlobalRoot(): string {
  return path.join(os.homedir(), '.openacp')
}
