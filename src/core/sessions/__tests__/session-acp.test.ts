import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Session } from '../session.js'
import type { AgentInstance } from '../../agents/agent-instance.js'
import type { ConfigOption, SessionModeState, SessionModelState } from '../../types.js'

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

  it('initializes with empty mode/config/model state', () => {
    expect(session.currentMode).toBeUndefined()
    expect(session.availableModes).toEqual([])
    expect(session.configOptions).toEqual([])
    expect(session.currentModel).toBeUndefined()
    expect(session.availableModels).toEqual([])
  })

  it('setInitialAcpState stores modes, config, and models', () => {
    const modes: SessionModeState = {
      currentModeId: 'code',
      availableModes: [
        { id: 'code', name: 'Code' },
        { id: 'architect', name: 'Architect' },
      ],
    }
    const configOptions: ConfigOption[] = [{
      id: 'model',
      name: 'Model',
      type: 'select',
      currentValue: 'sonnet',
      options: [{ value: 'sonnet', label: 'Sonnet' }],
    }]
    const models: SessionModelState = {
      currentModelId: 'sonnet',
      availableModels: [{ id: 'sonnet', name: 'Sonnet' }],
    }

    session.setInitialAcpState({ modes, configOptions, models })

    expect(session.currentMode).toBe('code')
    expect(session.availableModes).toHaveLength(2)
    expect(session.configOptions).toHaveLength(1)
    expect(session.currentModel).toBe('sonnet')
    expect(session.availableModels).toHaveLength(1)
  })

  it('updateMode changes current mode', () => {
    session.setInitialAcpState({
      modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }] },
    })
    session.updateMode('architect')
    expect(session.currentMode).toBe('architect')
  })

  it('updateConfigOptions replaces options', () => {
    const opts: ConfigOption[] = [{
      id: 'thought',
      name: 'Thinking',
      type: 'boolean',
      currentValue: true,
    }]
    session.updateConfigOptions(opts)
    expect(session.configOptions).toEqual(opts)
  })

  it('updateModel changes current model', () => {
    session.updateModel('opus')
    expect(session.currentModel).toBe('opus')
  })
})
