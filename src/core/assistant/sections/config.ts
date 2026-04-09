import type { AssistantSection } from '../assistant-registry.js'

export function createConfigSection(core: {
  configManager: { resolveWorkspace(): string }
  lifecycleManager?: { serviceRegistry: { get<T>(name: string): T | undefined } }
}): AssistantSection {
  return {
    id: 'core:config',
    title: 'Configuration',
    priority: 30,
    buildContext: () => {
      const workspace = core.configManager.resolveWorkspace()
      const speechSvc = core.lifecycleManager?.serviceRegistry.get<{ isSTTAvailable(): boolean }>('speech')
      const sttActive = speechSvc ? speechSvc.isSTTAvailable() : false
      return (
        `Workspace base: ${workspace}\n` +
        `STT: ${sttActive ? 'configured ✅' : 'Not configured'}`
      )
    },
    commands: [
      { command: 'openacp config', description: 'View config' },
      { command: 'openacp config set <key> <value>', description: 'Update config value' },
    ],
  }
}
