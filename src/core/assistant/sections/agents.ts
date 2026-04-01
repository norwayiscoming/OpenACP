import type { AssistantSection } from '../assistant-registry.js'

export function createAgentsSection(core: {
  agentCatalog: { getInstalledEntries(): Record<string, { name: string }>; getAvailable(): Array<{ installed: boolean }> }
  configManager: { get(): { defaultAgent: string } }
}): AssistantSection {
  return {
    id: 'core:agents',
    title: 'Agent Management',
    priority: 20,
    buildContext: () => {
      const installed = Object.keys(core.agentCatalog.getInstalledEntries())
      const available = core.agentCatalog.getAvailable().filter((i) => !i.installed).length
      const defaultAgent = core.configManager.get().defaultAgent
      return (
        `Installed agents: ${installed.join(', ')}\n` +
        `Default agent: ${defaultAgent}\n` +
        `Available in ACP Registry: ${available} more agents`
      )
    },
    commands: [
      { command: 'openacp agents', description: 'List all agents' },
      { command: 'openacp agents install <name>', description: 'Install agent' },
      { command: 'openacp agents info <name>', description: 'Show agent details' },
      { command: 'openacp agents run <name> -- <args>', description: 'Run agent CLI (for login etc.)' },
    ],
  }
}
