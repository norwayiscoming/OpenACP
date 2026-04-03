import { describe, it, expect, vi } from 'vitest';
import { Session } from '../sessions/session.js';
import { TypedEmitter } from '../utils/typed-emitter.js';
import type { AgentEvent } from '../types.js';

function mockAgentInstance(overrides?: { sessionId?: string }) {
  const emitter = new TypedEmitter<{ agent_event: (event: AgentEvent) => void }>();
  return Object.assign(emitter, {
    sessionId: overrides?.sessionId ?? 'agent-sess-1',
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    onPermissionRequest: vi.fn(),
    promptCapabilities: {},
  }) as any;
}

function createTestSession(agentInstance?: any, agentName?: string) {
  return new Session({
    channelId: 'telegram',
    agentName: agentName ?? 'claude',
    workingDirectory: '/workspace',
    agentInstance: agentInstance ?? mockAgentInstance(),
  });
}

describe('Agent Switch — Session-level integration', () => {
  it('preserves session identity (same session.id) across switches', async () => {
    const session = createTestSession(mockAgentInstance({ sessionId: 'old' }), 'claude');
    const originalId = session.id;

    await session.switchAgent('gemini', async () => mockAgentInstance({ sessionId: 'new' }));

    expect(session.id).toBe(originalId);
    expect(session.agentName).toBe('gemini');
  });

  it('records switch history correctly with promptCount', async () => {
    const oldAgent = mockAgentInstance({ sessionId: 'claude-sess' });
    const session = createTestSession(oldAgent, 'claude');
    session.agentSessionId = 'claude-sess';

    // Process some prompts
    await session.enqueuePrompt('hello');
    await session.enqueuePrompt('world');
    expect(session.promptCount).toBe(2);

    await session.switchAgent('gemini', async () => mockAgentInstance({ sessionId: 'gemini-sess' }));

    expect(session.agentSwitchHistory).toHaveLength(1);
    expect(session.agentSwitchHistory[0]).toMatchObject({
      agentName: 'claude',
      agentSessionId: 'claude-sess',
      promptCount: 2,
    });
    expect(session.agentSwitchHistory[0].switchedAt).toBeTruthy();
  });

  it('resets promptCount after switch', async () => {
    const session = createTestSession(mockAgentInstance({ sessionId: 'old' }), 'claude');

    await session.enqueuePrompt('hi');
    expect(session.promptCount).toBe(1);

    await session.switchAgent('gemini', async () => mockAgentInstance({ sessionId: 'new' }));

    expect(session.promptCount).toBe(0);
  });

  it('handles multiple switches A -> B -> C -> A', async () => {
    const agentA = mockAgentInstance({ sessionId: 'a-sess' });
    const session = createTestSession(agentA, 'agentA');
    session.agentSessionId = 'a-sess';

    // A -> B
    await session.enqueuePrompt('prompt1');
    await session.switchAgent('agentB', async () => mockAgentInstance({ sessionId: 'b-sess' }));

    // B -> C
    await session.enqueuePrompt('prompt2');
    await session.enqueuePrompt('prompt3');
    await session.switchAgent('agentC', async () => mockAgentInstance({ sessionId: 'c-sess' }));

    // C -> A
    await session.enqueuePrompt('prompt4');
    await session.switchAgent('agentA', async () => mockAgentInstance({ sessionId: 'a-sess-2' }));

    expect(session.agentSwitchHistory).toHaveLength(3);
    expect(session.agentName).toBe('agentA');
    expect(session.agentSessionId).toBe('a-sess-2');
    expect(session.promptCount).toBe(0);
    expect(session.firstAgent).toBe('agentA');

    // Verify each history entry
    expect(session.agentSwitchHistory[0]).toMatchObject({
      agentName: 'agentA',
      agentSessionId: 'a-sess',
      promptCount: 1,
    });
    expect(session.agentSwitchHistory[1]).toMatchObject({
      agentName: 'agentB',
      agentSessionId: 'b-sess',
      promptCount: 2,
    });
    expect(session.agentSwitchHistory[2]).toMatchObject({
      agentName: 'agentC',
      agentSessionId: 'c-sess',
      promptCount: 1,
    });
  });

  describe('findLastSwitchEntry for resume logic', () => {
    it('finds most recent entry for a given agent', async () => {
      const session = createTestSession(mockAgentInstance({ sessionId: 'a1' }), 'agentA');
      session.agentSessionId = 'a1';

      // A -> B
      await session.switchAgent('agentB', async () => mockAgentInstance({ sessionId: 'b1' }));
      // B -> A (back)
      await session.switchAgent('agentA', async () => mockAgentInstance({ sessionId: 'a2' }));
      // A -> B (again)
      await session.switchAgent('agentB', async () => mockAgentInstance({ sessionId: 'b2' }));

      // findLastSwitchEntry('agentA') should find the most recent A entry (a2)
      const lastA = session.findLastSwitchEntry('agentA');
      expect(lastA).toBeDefined();
      expect(lastA!.agentSessionId).toBe('a2');

      // findLastSwitchEntry('agentB') should find b1 (the most recent B entry)
      const lastB = session.findLastSwitchEntry('agentB');
      expect(lastB).toBeDefined();
      expect(lastB!.agentSessionId).toBe('b1');
    });

    it('returns undefined for agent never used', () => {
      const session = createTestSession(undefined, 'claude');
      expect(session.findLastSwitchEntry('gemini')).toBeUndefined();
    });

    it('returns entry with promptCount=0 for agent with no prompts before switch', async () => {
      const session = createTestSession(mockAgentInstance({ sessionId: 'a1' }), 'agentA');
      session.agentSessionId = 'a1';

      // Switch without sending any prompts
      await session.switchAgent('agentB', async () => mockAgentInstance({ sessionId: 'b1' }));

      const lastA = session.findLastSwitchEntry('agentA');
      expect(lastA).toBeDefined();
      expect(lastA!.promptCount).toBe(0);
    });
  });

  it('firstAgent is preserved across all switches', async () => {
    const session = createTestSession(undefined, 'claude');
    expect(session.firstAgent).toBe('claude');

    await session.switchAgent('gemini', async () => mockAgentInstance({ sessionId: 'g1' }));
    expect(session.firstAgent).toBe('claude');

    await session.switchAgent('codex', async () => mockAgentInstance({ sessionId: 'c1' }));
    expect(session.firstAgent).toBe('claude');
  });

  it('session status remains unchanged after switch', async () => {
    const session = createTestSession(undefined, 'claude');
    session.activate();
    expect(session.status).toBe('active');

    await session.switchAgent('gemini', async () => mockAgentInstance({ sessionId: 'g1' }));
    expect(session.status).toBe('active');
  });

  it('channelId and workingDirectory are preserved after switch', async () => {
    const session = createTestSession(undefined, 'claude');
    const originalChannelId = session.channelId;
    const originalWorkDir = session.workingDirectory;

    await session.switchAgent('gemini', async () => mockAgentInstance({ sessionId: 'g1' }));

    expect(session.channelId).toBe(originalChannelId);
    expect(session.workingDirectory).toBe(originalWorkDir);
  });

  it('buffers commands_update from new agent after switch', async () => {
    const oldAgent = mockAgentInstance({ sessionId: 'old' });
    const session = createTestSession(oldAgent, 'claude');

    const newAgent = mockAgentInstance({ sessionId: 'new' });
    await session.switchAgent('gemini', async () => newAgent);

    // Emit commands_update from new agent BEFORE bridge connects
    newAgent.emit('agent_event', {
      type: 'commands_update',
      commands: [{ name: '/test', description: 'test cmd' }],
    });

    expect(session.latestCommands).toEqual([{ name: '/test', description: 'test cmd' }]);
  });
});
