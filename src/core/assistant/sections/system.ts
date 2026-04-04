import type { AssistantSection } from '../assistant-registry.js'

export function createSystemSection(): AssistantSection {
  return {
    id: 'core:system',
    title: 'System',
    priority: 40,
    buildContext: () => {
      return 'Always ask for confirmation before restart or update — these are disruptive actions.'
    },
    commands: [
      { command: 'openacp api health', description: 'System health check' },
      { command: 'openacp api restart', description: 'Restart daemon' },
      { command: 'openacp api version', description: 'Show version' },
      { command: 'openacp api topics', description: 'List all topics' },
      { command: 'openacp api cleanup', description: 'Cleanup finished topics' },
    ],
  }
}
