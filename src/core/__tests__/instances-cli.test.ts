import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

// We test the pure data-mapping logic extracted from the command
// by mocking readInstanceInfo and InstanceRegistry

vi.mock('../../cli/commands/status.js', () => ({
  readInstanceInfo: vi.fn(),
}))

vi.mock('../../core/instance/instance-registry.js', () => ({
  InstanceRegistry: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  })),
}))

vi.mock('../../core/instance/instance-context.js', () => ({
  getGlobalRoot: vi.fn().mockReturnValue('/Users/user/.openacp'),
  generateSlug: vi.fn().mockImplementation((name: string) => name.toLowerCase().replace(/[^a-z0-9-]/g, '-')),
}))

vi.mock('node:fs')

import { buildInstanceListEntries, cmdInstancesCreate } from '../../cli/commands/instances.js'
import { readInstanceInfo } from '../../cli/commands/status.js'
import { InstanceRegistry } from '../../core/instance/instance-registry.js'
import fs from 'node:fs'

describe('buildInstanceListEntries', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns empty array when no instances registered', async () => {
    const mockRegistry = { load: vi.fn(), list: vi.fn().mockReturnValue([]) }
    vi.mocked(InstanceRegistry).mockImplementation(function() { return mockRegistry } as any)
    const result = await buildInstanceListEntries()
    expect(result).toEqual([])
  })

  it('maps registry entries to InstanceListEntry with correct fields', async () => {
    const mockRegistry = {
      load: vi.fn(),
      list: vi.fn().mockReturnValue([
        { id: 'main', root: '/Users/user/.openacp' },
      ]),
    }
    vi.mocked(InstanceRegistry).mockImplementation(function() { return mockRegistry } as any)
    vi.mocked(readInstanceInfo).mockReturnValue({
      name: 'Main', pid: 1234, apiPort: 21420,
      tunnelPort: null, runMode: 'daemon', channels: [],
    })

    const result = await buildInstanceListEntries()
    expect(result).toEqual([{
      id: 'main',
      name: 'Main',
      directory: '/Users/user',
      root: '/Users/user/.openacp',
      status: 'running',
      port: 21420,
    }])
  })

  it('sets status stopped when pid is null', async () => {
    const mockRegistry = {
      load: vi.fn(),
      list: vi.fn().mockReturnValue([{ id: 'dev', root: '/project/.openacp' }]),
    }
    vi.mocked(InstanceRegistry).mockImplementation(function() { return mockRegistry } as any)
    vi.mocked(readInstanceInfo).mockReturnValue({
      name: 'Dev', pid: null, apiPort: null,
      tunnelPort: null, runMode: null, channels: [],
    })

    const result = await buildInstanceListEntries()
    expect(result[0]!.status).toBe('stopped')
    expect(result[0]!.port).toBeNull()
  })

  it('computes directory as path.dirname(root)', async () => {
    const mockRegistry = {
      load: vi.fn(),
      list: vi.fn().mockReturnValue([
        { id: 'proj', root: '/Users/user/my-project/.openacp' },
      ]),
    }
    vi.mocked(InstanceRegistry).mockImplementation(function() { return mockRegistry } as any)
    vi.mocked(readInstanceInfo).mockReturnValue({
      name: 'Proj', pid: null, apiPort: null,
      tunnelPort: null, runMode: null, channels: [],
    })

    const result = await buildInstanceListEntries()
    expect(result[0]!.directory).toBe('/Users/user/my-project')
    expect(result[0]!.root).toBe('/Users/user/my-project/.openacp')
  })
})

describe('cmdInstancesCreate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('errors when --dir is missing', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as any)
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(cmdInstancesCreate([])).rejects.toThrow('exit')
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('--dir'))
    mockExit.mockRestore()
    mockError.mockRestore()
  })

  it('errors when .openacp already exists and is registered', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const mockRegistry = {
      load: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      getByRoot: vi.fn().mockReturnValue({ id: 'existing', root: '/path/.openacp' }),
    }
    vi.mocked(InstanceRegistry).mockImplementation(function() { return mockRegistry } as any)

    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as any)
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(cmdInstancesCreate(['--dir', '/path'])).rejects.toThrow('exit')
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('existing'))
    mockExit.mockRestore()
    mockError.mockRestore()
  })

  it('registers .openacp that exists but is not in registry', async () => {
    // .openacp exists but registry has no entry for it
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ instanceName: 'My Project' }))
    const mockRegistry = {
      load: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      getByRoot: vi.fn().mockReturnValue(undefined),
      uniqueId: vi.fn().mockReturnValue('my-project'),
      register: vi.fn(),
      save: vi.fn(),
    }
    vi.mocked(InstanceRegistry).mockImplementation(function() { return mockRegistry } as any)
    vi.mocked(readInstanceInfo).mockReturnValue({
      name: 'My Project', pid: null, apiPort: null,
      tunnelPort: null, runMode: null, channels: [],
    })

    const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await cmdInstancesCreate(['--dir', '/Users/user/my-project'])
    expect(mockRegistry.register).toHaveBeenCalledWith('my-project', '/Users/user/my-project/.openacp')
    expect(mockRegistry.save).toHaveBeenCalled()
    mockLog.mockRestore()
  })

  it('creates minimal config with --no-interactive flag', async () => {
    // .openacp does not exist
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined)
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined)
    const mockRegistry = {
      load: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      getByRoot: vi.fn().mockReturnValue(undefined),
      uniqueId: vi.fn().mockReturnValue('my-instance'),
      register: vi.fn(),
      save: vi.fn(),
    }
    vi.mocked(InstanceRegistry).mockImplementation(function() { return mockRegistry } as any)
    vi.mocked(readInstanceInfo).mockReturnValue({
      name: 'my-instance', pid: null, apiPort: null,
      tunnelPort: null, runMode: null, channels: [],
    })

    const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await cmdInstancesCreate(['--dir', '/Users/user/new-instance', '--name', 'my-instance', '--no-interactive'])

    // mkdirSync called for instanceRoot
    expect(fs.mkdirSync).toHaveBeenCalledWith('/Users/user/new-instance/.openacp', { recursive: true })

    // config.json written with instanceName
    const configWriteCall = vi.mocked(fs.writeFileSync).mock.calls.find(
      ([p]) => typeof p === 'string' && (p as string).endsWith('config.json')
    )
    expect(configWriteCall).toBeDefined()
    const writtenConfig = JSON.parse(configWriteCall![1] as string)
    expect(writtenConfig.instanceName).toBe('my-instance')
    expect(writtenConfig.runMode).toBe('daemon')

    // plugins.json also written
    const pluginsWriteCall = vi.mocked(fs.writeFileSync).mock.calls.find(
      ([p]) => typeof p === 'string' && (p as string).endsWith('plugins.json')
    )
    expect(pluginsWriteCall).toBeDefined()

    // registered in registry
    expect(mockRegistry.register).toHaveBeenCalledWith('my-instance', '/Users/user/new-instance/.openacp')
    expect(mockRegistry.save).toHaveBeenCalled()

    mockLog.mockRestore()
  })
})
