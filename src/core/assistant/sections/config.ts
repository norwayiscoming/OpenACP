import type { AssistantSection } from '../assistant-registry.js'

export function createConfigSection(core: {
  configManager: { get(): { workspace: { baseDir: string }; speech?: { stt?: { provider?: string } } } }
}): AssistantSection {
  return {
    id: 'core:config',
    title: 'Configuration',
    priority: 30,
    buildContext: () => {
      const config = core.configManager.get()
      return (
        `Workspace base: ${config.workspace.baseDir}\n` +
        `STT: ${config.speech?.stt?.provider ? `${config.speech.stt.provider} ✅` : 'Not configured'}`
      )
    },
    commands: [
      { command: 'openacp config', description: 'View config' },
      { command: 'openacp config set <key> <value>', description: 'Update config value' },
    ],
  }
}
