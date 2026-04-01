import type { AssistantSection } from '../assistant-registry.js'

export function createSessionsSection(core: { sessionManager: { listRecords(): Array<{ status: string }> } }): AssistantSection {
  return {
    id: 'core:sessions',
    title: 'Session Management',
    priority: 10,
    buildContext: () => {
      const records = core.sessionManager.listRecords()
      const active = records.filter((r) => r.status === 'active' || r.status === 'initializing').length
      return (
        `Active sessions: ${active} / ${records.length} total\n\n` +
        `To create a session, ask which agent to use and which project directory (workspace) to work in.\n` +
        `The workspace is the project folder where the agent will read, write, and execute code.\n\n` +
        `IMPORTANT: Always pass --channel <current_channel> when creating sessions.\n` +
        `Omitting --channel creates a headless session with no Telegram thread — the user won't see it.\n` +
        `If unsure which channels are available, run "openacp api adapters" first.`
      )
    },
    commands: [
      { command: 'openacp api status', description: 'List active sessions' },
      { command: 'openacp api adapters', description: 'List registered channel adapters' },
      { command: 'openacp api new <agent> <workspace> --channel <current_channel>', description: 'Create new session (always pass --channel)' },
      { command: 'openacp api cancel <id>', description: 'Cancel session' },
      { command: 'openacp api send <id> "prompt"', description: 'Send prompt to session' },
      { command: 'openacp api bypass <id> on|off', description: 'Toggle bypass permissions' },
    ],
  }
}
