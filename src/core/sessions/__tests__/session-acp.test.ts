import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Session } from '../session.js'
import type { AgentInstance } from '../../agents/agent-instance.js'
import type { AgentCapabilities, ConfigOption } from '../../types.js'

function mockAgentInstance() {
  return {
    sessionId: 'agent-sess-1',
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    cancel: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
    setModel: vi.fn().mockResolvedValue(undefined),
    onPermissionRequest: vi.fn(),
  } as unknown as AgentInstance
}

describe('Session ACP state', () => {
  let session: Session

  beforeEach(() => {
    session = new Session({
      id: 'test-session',
      channelId: 'telegram',
      agentName: 'claude',
      workingDirectory: '/tmp',
      agentInstance: mockAgentInstance(),
    })
  })

  it('initializes with empty configOptions', () => {
    expect(session.configOptions).toEqual([])
  })

  it('initializes with undefined agentCapabilities', () => {
    expect(session.agentCapabilities).toBeUndefined()
  })

  it('setInitialConfigOptions stores config options', () => {
    const configOptions: ConfigOption[] = [
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'code',
        options: [
          { value: 'code', label: 'Code' },
          { value: 'architect', label: 'Architect' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'sonnet',
        options: [{ value: 'sonnet', label: 'Sonnet' }],
      },
    ]

    session.setInitialConfigOptions(configOptions)

    expect(session.configOptions).toHaveLength(2)
    expect(session.getConfigValue('mode')).toBe('code')
    expect(session.getConfigValue('model')).toBe('sonnet')
  })

  it('getConfigByCategory returns option by category', () => {
    const configOptions: ConfigOption[] = [
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'code',
        options: [{ value: 'code', label: 'Code' }],
      },
    ]
    session.setInitialConfigOptions(configOptions)

    const modeOption = session.getConfigByCategory('mode')
    expect(modeOption).toBeDefined()
    expect(modeOption?.currentValue).toBe('code')
  })

  it('updateConfigOptions replaces options', async () => {
    const opts: ConfigOption[] = [
      {
        id: 'thought',
        name: 'Thinking',
        type: 'boolean',
        currentValue: true,
      },
    ]
    await session.updateConfigOptions(opts)
    expect(session.configOptions).toEqual(opts)
  })

  it('setAgentCapabilities stores capabilities', () => {
    session.setAgentCapabilities({ name: 'claude', loadSession: true } as AgentCapabilities)
    expect(session.agentCapabilities?.name).toBe('claude')
  })

  it('toAcpStateSnapshot returns configOptions and agentCapabilities', () => {
    const configOptions: ConfigOption[] = [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'sonnet',
        options: [{ value: 'sonnet', label: 'Sonnet' }],
      },
    ]
    session.setInitialConfigOptions(configOptions)
    session.setAgentCapabilities({ name: 'claude' } as AgentCapabilities)

    const snapshot = session.toAcpStateSnapshot()
    expect(snapshot.configOptions).toHaveLength(1)
    expect(snapshot.agentCapabilities?.name).toBe('claude')
  })

  it('toAcpStateSnapshot omits configOptions when empty', () => {
    const snapshot = session.toAcpStateSnapshot()
    expect(snapshot.configOptions).toBeUndefined()
    expect(snapshot.agentCapabilities).toBeUndefined()
  })

  it('getConfigOption returns option by id', () => {
    const configOptions: ConfigOption[] = [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'sonnet',
        options: [{ value: 'sonnet', label: 'Sonnet' }],
      },
    ]
    session.setInitialConfigOptions(configOptions)

    expect(session.getConfigOption('model')).toBeDefined()
    expect(session.getConfigOption('nonexistent')).toBeUndefined()
  })

  it('clientOverrides starts empty', () => {
    expect(session.clientOverrides).toEqual({})
    expect(session.clientOverrides.bypassPermissions).toBeUndefined()
  })
})
