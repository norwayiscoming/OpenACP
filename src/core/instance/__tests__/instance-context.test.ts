import { describe, it, expect, afterEach } from 'vitest'
import { generateSlug, createInstanceContext, resolveInstanceRoot, getGlobalRoot } from '../instance-context.js'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { tmpdir } from 'node:os'

describe('generateSlug', () => {
  it('converts name to lowercase hyphenated slug', () => {
    expect(generateSlug('My Staging Bot')).toBe('my-staging-bot')
  })
  it('strips special characters', () => {
    expect(generateSlug('Hello World! @#$')).toBe('hello-world')
  })
  it('collapses multiple hyphens', () => {
    expect(generateSlug('foo---bar')).toBe('foo-bar')
  })
  it('trims leading/trailing hyphens', () => {
    expect(generateSlug('--hello--')).toBe('hello')
  })
  it('handles empty string', () => {
    expect(generateSlug('')).toBe('openacp')
  })
})

describe('createInstanceContext', () => {
  const globalRoot = getGlobalRoot()

  it('creates context with correct instance-local paths', () => {
    const ctx = createInstanceContext({ id: 'my-project', root: '/home/user/project/.openacp' })
    expect(ctx.id).toBe('my-project')
    expect(ctx.paths.config).toBe('/home/user/project/.openacp/config.json')
    expect(ctx.paths.sessions).toBe('/home/user/project/.openacp/sessions.json')
    expect(ctx.paths.agents).toBe('/home/user/project/.openacp/agents.json')
    expect(ctx.paths.plugins).toBe('/home/user/project/.openacp/plugins')
    expect(ctx.paths.pluginsData).toBe('/home/user/project/.openacp/plugins/data')
    expect(ctx.paths.pluginRegistry).toBe('/home/user/project/.openacp/plugins.json')
    expect(ctx.paths.logs).toBe('/home/user/project/.openacp/logs')
    expect(ctx.paths.pid).toBe('/home/user/project/.openacp/openacp.pid')
    expect(ctx.paths.running).toBe('/home/user/project/.openacp/running')
    expect(ctx.paths.apiPort).toBe('/home/user/project/.openacp/api.port')
    expect(ctx.paths.apiSecret).toBe('/home/user/project/.openacp/api-secret')
    expect(ctx.paths.cache).toBe('/home/user/project/.openacp/cache')
    expect(ctx.paths.tunnels).toBe('/home/user/project/.openacp/tunnels.json')
  })

  it('shared paths (agentsDir, bin, registryCache) point to global ~/.openacp/', () => {
    const ctx = createInstanceContext({ id: 'my-project', root: '/home/user/project/.openacp' })
    expect(ctx.paths.agentsDir).toBe(path.join(globalRoot, 'agents'))
    expect(ctx.paths.bin).toBe(path.join(globalRoot, 'bin'))
    expect(ctx.paths.registryCache).toBe(path.join(globalRoot, 'cache', 'registry-cache.json'))
  })

  it('shared paths are the same regardless of instance root', () => {
    const ctx1 = createInstanceContext({ id: 'a', root: '/project-a/.openacp' })
    const ctx2 = createInstanceContext({ id: 'b', root: '/project-b/.openacp' })
    expect(ctx1.paths.agentsDir).toBe(ctx2.paths.agentsDir)
    expect(ctx1.paths.bin).toBe(ctx2.paths.bin)
    expect(ctx1.paths.registryCache).toBe(ctx2.paths.registryCache)
  })

  it('does not have isGlobal property', () => {
    const ctx = createInstanceContext({ id: 'test', root: '/tmp/.openacp' })
    expect('isGlobal' in ctx).toBe(false)
  })
})

describe('resolveInstanceRoot', () => {
  it('--dir flag resolves to <path>/.openacp', () => {
    const result = resolveInstanceRoot({ dir: '/tmp/mydir' })
    expect(result).toBe('/tmp/mydir/.openacp')
  })
  it('--local flag resolves to cwd/.openacp', () => {
    const result = resolveInstanceRoot({ local: true, cwd: '/home/user/project' })
    expect(result).toBe('/home/user/project/.openacp')
  })
  it('--dir takes priority over --local', () => {
    const result = resolveInstanceRoot({ dir: '/tmp/custom', local: true, cwd: '/home/user' })
    expect(result).toBe('/tmp/custom/.openacp')
  })
  it('auto-detects .openacp/config.json in cwd', () => {
    const dir = path.join(tmpdir(), `test-openacp-${Date.now()}`)
    const dotDir = path.join(dir, '.openacp')
    fs.mkdirSync(dotDir, { recursive: true })
    fs.writeFileSync(path.join(dotDir, 'config.json'), '{}')
    try {
      const result = resolveInstanceRoot({ cwd: dir })
      expect(result).toBe(dotDir)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
  it('returns null when no flag and no .openacp/config.json in cwd', () => {
    const saved = process.env.OPENACP_INSTANCE_ROOT
    delete process.env.OPENACP_INSTANCE_ROOT
    try {
      const result = resolveInstanceRoot({ cwd: tmpdir() })
      expect(result).toBeNull()
    } finally {
      if (saved !== undefined) process.env.OPENACP_INSTANCE_ROOT = saved
    }
  })
  it('expands ~ in --dir path', () => {
    const result = resolveInstanceRoot({ dir: '~/my-project' })
    expect(result).toBe(path.join(os.homedir(), 'my-project', '.openacp'))
  })

  describe('walk-up resolution', () => {
    let baseDir: string

    afterEach(() => {
      if (baseDir) fs.rmSync(baseDir, { recursive: true, force: true })
    })

    it('walks up to find .openacp/config.json in parent directory', () => {
      baseDir = path.join(tmpdir(), `test-walkup-${Date.now()}`)
      const parentInstance = path.join(baseDir, '.openacp')
      const childDir = path.join(baseDir, 'src', 'deep')
      fs.mkdirSync(childDir, { recursive: true })
      fs.mkdirSync(parentInstance, { recursive: true })
      fs.writeFileSync(path.join(parentInstance, 'config.json'), '{}')

      const saved = process.env.OPENACP_INSTANCE_ROOT
      delete process.env.OPENACP_INSTANCE_ROOT
      try {
        const result = resolveInstanceRoot({ cwd: childDir })
        expect(result).toBe(parentInstance)
      } finally {
        if (saved !== undefined) process.env.OPENACP_INSTANCE_ROOT = saved
      }
    })

    it('walk-up stops at $HOME — does not find instances above $HOME', () => {
      // Use a deep temp directory that is NOT under $HOME
      // Since tmpdir may or may not be under $HOME, we test by creating
      // a structure under $HOME and verifying walk-up doesn't escape it
      const home = os.homedir()
      baseDir = path.join(home, `.test-walkup-boundary-${Date.now()}`)
      const childDir = path.join(baseDir, 'deep', 'nested')
      fs.mkdirSync(childDir, { recursive: true })

      const saved = process.env.OPENACP_INSTANCE_ROOT
      delete process.env.OPENACP_INSTANCE_ROOT
      try {
        // No .openacp/config.json anywhere in the walk-up path (under $HOME)
        const result = resolveInstanceRoot({ cwd: childDir })
        expect(result).toBeNull()
      } finally {
        if (saved !== undefined) process.env.OPENACP_INSTANCE_ROOT = saved
      }
    })

    it('~/.openacp is skipped during walk-up (shared store, not an instance)', () => {
      const home = os.homedir()
      const globalRoot = path.join(home, '.openacp')
      const globalConfigExists = fs.existsSync(path.join(globalRoot, 'config.json'))

      // Create a child dir directly under $HOME
      baseDir = path.join(home, `.test-skip-global-${Date.now()}`)
      fs.mkdirSync(baseDir, { recursive: true })

      const saved = process.env.OPENACP_INSTANCE_ROOT
      delete process.env.OPENACP_INSTANCE_ROOT
      try {
        const result = resolveInstanceRoot({ cwd: baseDir })
        // Even if ~/.openacp/config.json exists, it should not be returned
        // because ~/.openacp is the shared store
        if (globalConfigExists) {
          expect(result).not.toBe(globalRoot)
        }
        // Should return null (nothing found besides the skipped global)
        expect(result).toBeNull()
      } finally {
        if (saved !== undefined) process.env.OPENACP_INSTANCE_ROOT = saved
      }
    })

    it('home dir fallback: returns ~/openacp-workspace/.openacp when config exists', () => {
      const home = os.homedir()
      const wsDir = path.join(home, 'openacp-workspace', '.openacp')
      const configPath = path.join(wsDir, 'config.json')
      const wsExisted = fs.existsSync(configPath)

      // Ensure the workspace config exists for this test
      if (!wsExisted) {
        fs.mkdirSync(wsDir, { recursive: true })
        fs.writeFileSync(configPath, '{}')
      }

      const saved = process.env.OPENACP_INSTANCE_ROOT
      delete process.env.OPENACP_INSTANCE_ROOT
      try {
        const result = resolveInstanceRoot({ cwd: home })
        expect(result).toBe(wsDir)
      } finally {
        if (saved !== undefined) process.env.OPENACP_INSTANCE_ROOT = saved
        else delete process.env.OPENACP_INSTANCE_ROOT
        // Clean up only if we created it
        if (!wsExisted) {
          fs.rmSync(configPath)
          // Only remove dirs if we created them (they may have pre-existed)
          try { fs.rmdirSync(wsDir) } catch {}
        }
      }
    })

    it('home dir fallback: returns null when ~/openacp-workspace/.openacp/config.json does not exist', () => {
      const home = os.homedir()
      const wsConfigPath = path.join(home, 'openacp-workspace', '.openacp', 'config.json')

      // Only run the core assertion if the file genuinely doesn't exist
      // (otherwise this test would be a false positive)
      const saved = process.env.OPENACP_INSTANCE_ROOT
      delete process.env.OPENACP_INSTANCE_ROOT
      try {
        if (!fs.existsSync(wsConfigPath)) {
          const result = resolveInstanceRoot({ cwd: home })
          expect(result).toBeNull()
        } else {
          // If the file does exist in the real environment, create a temp home to test
          baseDir = path.join(tmpdir(), `test-home-fallback-${Date.now()}`)
          fs.mkdirSync(baseDir, { recursive: true })
          // Mock homedir to our temp dir
          const origHomedir = os.homedir
          os.homedir = () => baseDir
          try {
            const result = resolveInstanceRoot({ cwd: baseDir })
            expect(result).toBeNull()
          } finally {
            os.homedir = origHomedir
          }
        }
      } finally {
        if (saved !== undefined) process.env.OPENACP_INSTANCE_ROOT = saved
        else delete process.env.OPENACP_INSTANCE_ROOT
      }
    })

    it('home dir fallback: does NOT check ~/openacp-workspace when CWD is not home dir', () => {
      baseDir = path.join(tmpdir(), `test-not-home-${Date.now()}`)
      fs.mkdirSync(baseDir, { recursive: true })

      const saved = process.env.OPENACP_INSTANCE_ROOT
      delete process.env.OPENACP_INSTANCE_ROOT
      try {
        // Even if ~/openacp-workspace/.openacp/config.json exists, it should
        // not be returned when CWD is not the home directory
        const result = resolveInstanceRoot({ cwd: baseDir })
        expect(result).toBeNull()
      } finally {
        if (saved !== undefined) process.env.OPENACP_INSTANCE_ROOT = saved
        else delete process.env.OPENACP_INSTANCE_ROOT
      }
    })

    it('falls back to OPENACP_INSTANCE_ROOT env when walk-up finds nothing', () => {
      baseDir = path.join(tmpdir(), `test-env-fallback-${Date.now()}`)
      fs.mkdirSync(baseDir, { recursive: true })

      const saved = process.env.OPENACP_INSTANCE_ROOT
      process.env.OPENACP_INSTANCE_ROOT = '/custom/instance/.openacp'
      try {
        const result = resolveInstanceRoot({ cwd: baseDir })
        expect(result).toBe('/custom/instance/.openacp')
      } finally {
        if (saved !== undefined) {
          process.env.OPENACP_INSTANCE_ROOT = saved
        } else {
          delete process.env.OPENACP_INSTANCE_ROOT
        }
      }
    })
  })
})
