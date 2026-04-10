import type { AssistantSection } from '../assistant-registry.js'

/**
 * Creates the "System" section for the assistant's system prompt.
 *
 * Provides system-level commands (health check, restart, version) and
 * instructs the assistant to always confirm before disruptive actions.
 */
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
