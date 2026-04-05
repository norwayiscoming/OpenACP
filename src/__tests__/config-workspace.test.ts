import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ConfigManager, expandHome } from '../core/config/config.js'

describe('expandHome', () => {
  it('expands ~ to home directory', () => {
    const result = expandHome('~/test')
    expect(result).toBe(path.join(os.homedir(), 'test'))
  })

  it('does not modify absolute paths', () => {
    expect(expandHome('/absolute/path')).toBe('/absolute/path')
  })

  it('does not modify relative paths', () => {
    expect(expandHome('relative/path')).toBe('relative/path')
  })

  it('expands ~ at the start only', () => {
    const result = expandHome('~/Documents/code')
    expect(result).toBe(path.join(os.homedir(), 'Documents/code'))
  })
})

describe('ConfigManager.resolveWorkspace', () => {
  let configManager: ConfigManager
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openacp-test-'))
    const configPath = path.join(tmpDir, 'config.json')
    process.env.OPENACP_CONFIG_PATH = configPath

    // Write a valid config
    const config = {
      defaultAgent: 'claude',
      workspace: { baseDir: path.join(tmpDir, 'workspace') },
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

    configManager = new ConfigManager()
  })

  afterEach(() => {
    delete process.env.OPENACP_CONFIG_PATH
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resolves to baseDir when no input', async () => {
    await configManager.load()
    const result = configManager.resolveWorkspace()
    expect(result).toBe(path.join(tmpDir, 'workspace'))
    expect(fs.existsSync(result)).toBe(true)
  })

  it('rejects absolute path outside baseDir', async () => {
    await configManager.load()
    expect(() => configManager.resolveWorkspace('/tmp/outside-workspace')).toThrow(/outside base directory/)
  })

  it('rejects tilde path outside baseDir', async () => {
    await configManager.load()
    // Use a tilde path that resolves outside the tmpDir-based baseDir
    expect(() => configManager.resolveWorkspace('~/outside-workspace-openacp-test')).toThrow(/outside base directory/)
  })

  it('allows absolute path under baseDir', async () => {
    await configManager.load()
    const underBase = path.join(tmpDir, 'workspace', 'sub-project')
    const result = configManager.resolveWorkspace(underBase)
    expect(result).toBe(underBase)
    expect(fs.existsSync(result)).toBe(true)
  })

  it('allows baseDir itself as absolute path', async () => {
    await configManager.load()
    const base = path.join(tmpDir, 'workspace')
    const result = configManager.resolveWorkspace(base)
    expect(result).toBe(base)
    expect(fs.existsSync(result)).toBe(true)
  })

  it('resolves named workspace under baseDir', async () => {
    await configManager.load()
    const result = configManager.resolveWorkspace('MyProject')
    expect(result).toBe(path.join(tmpDir, 'workspace', 'myproject'))
    expect(fs.existsSync(result)).toBe(true)
  })

  it('lowercases named workspace', async () => {
    await configManager.load()
    const result = configManager.resolveWorkspace('MyProject')
    expect(result).toContain('myproject')
    expect(result).not.toContain('MyProject')
  })

  it('creates directories recursively', async () => {
    await configManager.load()
    const result = configManager.resolveWorkspace()
    expect(fs.existsSync(result)).toBe(true)
  })
})

describe('ConfigManager.applyEnvOverrides', () => {
  let tmpDir: string

  function createConfigAndManager(config: Record<string, unknown>): ConfigManager {
    const configPath = path.join(tmpDir, 'config.json')
    process.env.OPENACP_CONFIG_PATH = configPath
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    return new ConfigManager()
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openacp-env-test-'))
  })

  afterEach(() => {
    delete process.env.OPENACP_CONFIG_PATH
    delete process.env.OPENACP_DEFAULT_AGENT
    delete process.env.OPENACP_RUN_MODE
    delete process.env.OPENACP_LOG_LEVEL
    delete process.env.OPENACP_LOG_DIR
    delete process.env.OPENACP_DEBUG
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const baseConfig = {
    defaultAgent: 'claude',
  }

  it('overrides defaultAgent from env', async () => {
    process.env.OPENACP_DEFAULT_AGENT = 'codex'
    const manager = createConfigAndManager(baseConfig)
    await manager.load()
    expect(manager.get().defaultAgent).toBe('codex')
  })

  it('overrides runMode from env', async () => {
    process.env.OPENACP_RUN_MODE = 'daemon'
    const manager = createConfigAndManager(baseConfig)
    await manager.load()
    expect(manager.get().runMode).toBe('daemon')
  })

  it('overrides log level from env', async () => {
    process.env.OPENACP_LOG_LEVEL = 'debug'
    const manager = createConfigAndManager(baseConfig)
    await manager.load()
    expect(manager.get().logging.level).toBe('debug')
  })

  it('overrides log dir from env', async () => {
    process.env.OPENACP_LOG_DIR = '/tmp/custom-logs'
    const manager = createConfigAndManager(baseConfig)
    await manager.load()
    expect(manager.get().logging.logDir).toBe('/tmp/custom-logs')
  })

  it('OPENACP_DEBUG sets log level to debug when OPENACP_LOG_LEVEL not set', async () => {
    process.env.OPENACP_DEBUG = '1'
    const manager = createConfigAndManager(baseConfig)
    await manager.load()
    expect(manager.get().logging.level).toBe('debug')
  })

  it('OPENACP_DEBUG does NOT override explicit OPENACP_LOG_LEVEL', async () => {
    process.env.OPENACP_DEBUG = '1'
    process.env.OPENACP_LOG_LEVEL = 'warn'
    const manager = createConfigAndManager(baseConfig)
    await manager.load()
    expect(manager.get().logging.level).toBe('warn')
  })
})

describe('ConfigManager.save and hot-reload', () => {
  let configManager: ConfigManager
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openacp-save-test-'))
    const configPath = path.join(tmpDir, 'config.json')
    process.env.OPENACP_CONFIG_PATH = configPath

    const config = {
      defaultAgent: 'claude',
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    configManager = new ConfigManager()
    await configManager.load()
  })

  afterEach(() => {
    delete process.env.OPENACP_CONFIG_PATH
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('saves updates and persists to disk', async () => {
    await configManager.save({ defaultAgent: 'codex' })
    expect(configManager.get().defaultAgent).toBe('codex')

    // Verify on disk
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'))
    expect(raw.defaultAgent).toBe('codex')
  })

  it('emits config:changed event with path and value', async () => {
    const events: any[] = []
    configManager.on('config:changed', (e) => events.push(e))

    await configManager.save(
      { defaultAgent: 'codex' },
      'defaultAgent',
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      path: 'defaultAgent',
      value: 'codex',
    })
  })

  it('does not emit event when changePath not provided', async () => {
    const events: any[] = []
    configManager.on('config:changed', (e) => events.push(e))

    await configManager.save({ defaultAgent: 'codex' })

    expect(events).toHaveLength(0)
  })

  it('deep merges nested config', async () => {
    await configManager.save({ workspace: { baseDir: '~/custom-workspace' } })
    // Other workspace fields should still exist after deep merge
    expect(configManager.get().workspace.baseDir).toBe('~/custom-workspace')
  })
})
