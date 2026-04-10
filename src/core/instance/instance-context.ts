import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

export interface InstanceContext {
  id: string
  root: string
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
}

export function createInstanceContext(opts: CreateInstanceContextOpts): InstanceContext {
  const { id, root } = opts
  const globalRoot = getGlobalRoot()
  return {
    id, root,
    paths: {
      config: path.join(root, 'config.json'),
      sessions: path.join(root, 'sessions.json'),
      agents: path.join(root, 'agents.json'),
      registryCache: path.join(globalRoot, 'cache', 'registry-cache.json'),
      plugins: path.join(root, 'plugins'),
      pluginsData: path.join(root, 'plugins', 'data'),
      pluginRegistry: path.join(root, 'plugins.json'),
      logs: path.join(root, 'logs'),
      pid: path.join(root, 'openacp.pid'),
      running: path.join(root, 'running'),
      apiPort: path.join(root, 'api.port'),
      apiSecret: path.join(root, 'api-secret'),
      bin: path.join(globalRoot, 'bin'),
      cache: path.join(root, 'cache'),
      tunnels: path.join(root, 'tunnels.json'),
      agentsDir: path.join(globalRoot, 'agents'),
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
  cwd?: string
}

export function resolveInstanceRoot(opts: ResolveOpts): string | null {
  const cwd = opts.cwd ?? process.cwd()
  const home = os.homedir()
  const globalRoot = getGlobalRoot()

  // 1. --dir flag → return <dir>/.openacp
  if (opts.dir) return path.join(expandHome(opts.dir), '.openacp')

  // 2. --local flag → return cwd/.openacp
  if (opts.local) return path.join(cwd, '.openacp')

  // 3. CWD has .openacp/config.json → return it
  const cwdRoot = path.join(cwd, '.openacp')
  if (fs.existsSync(path.join(cwdRoot, 'config.json'))) return cwdRoot

  // 4. Walk-up parent dirs (stop at $HOME inclusive)
  let dir = path.resolve(cwd)
  while (true) {
    const parent = path.dirname(dir)
    if (parent === dir) break // filesystem root
    dir = parent
    const candidate = path.join(dir, '.openacp')
    // Skip ~/.openacp (shared store, not an instance)
    if (candidate === globalRoot) {
      // If we've reached $HOME, stop after checking (skip it)
      if (dir === home) break
      continue
    }
    if (fs.existsSync(path.join(candidate, 'config.json'))) return candidate
    // Stop at $HOME (inclusive — we checked it above)
    if (dir === home) break
  }

  // 5. Home directory fallback: check ~/openacp-workspace/.openacp/config.json
  if (path.resolve(cwd) === path.resolve(home)) {
    const defaultWs = path.join(home, 'openacp-workspace', '.openacp')
    if (fs.existsSync(path.join(defaultWs, 'config.json'))) return defaultWs
  }

  // 6. Check OPENACP_INSTANCE_ROOT env
  if (process.env.OPENACP_INSTANCE_ROOT) return process.env.OPENACP_INSTANCE_ROOT

  // 7. return null
  return null
}

export function getGlobalRoot(): string {
  return path.join(os.homedir(), '.openacp')
}

/**
 * Walk up directory tree from `cwd` looking for a running `.openacp/` instance.
 * Skips instances that exist but aren't running (dead daemon).
 * Skips `~/.openacp` (shared store, not an instance).
 * Stops at $HOME (inclusive). Returns null if nothing is running.
 */
export async function resolveRunningInstance(cwd: string): Promise<string | null> {
  const globalRoot = getGlobalRoot()
  const home = os.homedir()
  let dir = path.resolve(cwd)

  while (true) {
    const candidate = path.join(dir, '.openacp')
    // Skip ~/.openacp (shared store, not an instance)
    if (candidate !== globalRoot && fs.existsSync(candidate)) {
      if (await isInstanceRunning(candidate)) return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) break // filesystem root
    // Stop at $HOME (inclusive — we already checked it)
    if (dir === home) break
    dir = parent
  }

  return null
}

async function isInstanceRunning(instanceRoot: string): Promise<boolean> {
  const portFile = path.join(instanceRoot, 'api.port')
  try {
    const content = fs.readFileSync(portFile, 'utf-8').trim()
    const port = parseInt(content, 10)
    if (isNaN(port)) return false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/system/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}
