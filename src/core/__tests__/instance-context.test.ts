import { describe, it, expect } from 'vitest'
import { generateSlug, createInstanceContext, resolveInstanceRoot } from '../instance-context.js'
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
  it('creates global context with correct paths', () => {
    const ctx = createInstanceContext({ id: 'main', root: path.join(os.homedir(), '.openacp'), isGlobal: true })
    expect(ctx.id).toBe('main')
    expect(ctx.isGlobal).toBe(true)
    expect(ctx.paths.config).toBe(path.join(ctx.root, 'config.json'))
    expect(ctx.paths.sessions).toBe(path.join(ctx.root, 'sessions.json'))
    expect(ctx.paths.agents).toBe(path.join(ctx.root, 'agents.json'))
    expect(ctx.paths.plugins).toBe(path.join(ctx.root, 'plugins'))
    expect(ctx.paths.pluginsData).toBe(path.join(ctx.root, 'plugins', 'data'))
    expect(ctx.paths.pluginRegistry).toBe(path.join(ctx.root, 'plugins.json'))
    expect(ctx.paths.logs).toBe(path.join(ctx.root, 'logs'))
    expect(ctx.paths.pid).toBe(path.join(ctx.root, 'openacp.pid'))
    expect(ctx.paths.running).toBe(path.join(ctx.root, 'running'))
    expect(ctx.paths.apiPort).toBe(path.join(ctx.root, 'api.port'))
    expect(ctx.paths.apiSecret).toBe(path.join(ctx.root, 'api-secret'))
    expect(ctx.paths.bin).toBe(path.join(ctx.root, 'bin'))
    expect(ctx.paths.cache).toBe(path.join(ctx.root, 'cache'))
    expect(ctx.paths.tunnels).toBe(path.join(ctx.root, 'tunnels.json'))
    expect(ctx.paths.agentsDir).toBe(path.join(ctx.root, 'agents'))
    expect(ctx.paths.registryCache).toBe(path.join(ctx.root, 'registry-cache.json'))
  })

  it('creates local context from a project directory', () => {
    const ctx = createInstanceContext({ id: 'my-project', root: '/home/user/project/.openacp', isGlobal: false })
    expect(ctx.id).toBe('my-project')
    expect(ctx.isGlobal).toBe(false)
    expect(ctx.paths.config).toBe('/home/user/project/.openacp/config.json')
    expect(ctx.paths.pid).toBe('/home/user/project/.openacp/openacp.pid')
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
  it('--global flag resolves to ~/.openacp', () => {
    const result = resolveInstanceRoot({ global: true })
    expect(result).toBe(path.join(os.homedir(), '.openacp'))
  })
  it('--dir takes priority over --local', () => {
    const result = resolveInstanceRoot({ dir: '/tmp/custom', local: true, cwd: '/home/user' })
    expect(result).toBe('/tmp/custom/.openacp')
  })
  it('auto-detects .openacp in cwd', () => {
    const dir = path.join(tmpdir(), `test-openacp-${Date.now()}`)
    const dotDir = path.join(dir, '.openacp')
    fs.mkdirSync(dotDir, { recursive: true })
    try {
      const result = resolveInstanceRoot({ cwd: dir })
      expect(result).toBe(dotDir)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
  it('returns null when no flag and no .openacp in cwd (needs prompt)', () => {
    const result = resolveInstanceRoot({ cwd: tmpdir() })
    expect(result).toBeNull()
  })
  it('expands ~ in --dir path', () => {
    const result = resolveInstanceRoot({ dir: '~/my-project' })
    expect(result).toBe(path.join(os.homedir(), 'my-project', '.openacp'))
  })
})
