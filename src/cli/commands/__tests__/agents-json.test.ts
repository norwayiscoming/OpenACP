import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/agents/agent-catalog.js', () => {
  const MockAgentCatalog = class {
    load = vi.fn();
    refreshRegistryIfStale = vi.fn().mockResolvedValue(undefined);
    getAvailable = vi.fn().mockReturnValue([
      {
        key: 'claude-code',
        name: 'Claude Code',
        version: '1.0.0',
        distribution: 'npm',
        description: 'AI coding agent',
        installed: true,
        available: true,
        missingDeps: [],
      },
      {
        key: 'gemini',
        name: 'Gemini CLI',
        version: '0.5.0',
        distribution: 'npm',
        description: 'Google Gemini agent',
        installed: false,
        available: true,
        missingDeps: [],
      },
    ]);
  };
  return { AgentCatalog: MockAgentCatalog };
});

describe('agents list --json', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(console, 'log').mockImplementation((s: string) => { output += s; });
  });

  it('outputs valid JSON array when --json flag is passed', async () => {
    const { cmdAgents } = await import('../agents.js');
    await cmdAgents(['list', '--json'], undefined);

    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      key: 'claude-code',
      installed: true,
      available: true,
    });
  });

  it('includes all required fields in each agent entry', async () => {
    const { cmdAgents } = await import('../agents.js');
    await cmdAgents(['--json'], undefined);

    const parsed = JSON.parse(output);
    const fields = ['key', 'name', 'version', 'distribution', 'description', 'installed', 'available', 'missingDeps'];
    for (const field of fields) {
      expect(parsed[0]).toHaveProperty(field);
    }
  });
});
