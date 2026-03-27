import type { CommandRegistry } from '../command-registry.js'
import type { CommandResponse } from '../plugin/types.js'

/**
 * System session commands — these are placeholder registrations for discovery
 * (autocomplete, help text, etc.). The actual logic lives in adapter-specific
 * handlers. Handlers return 'silent' so the generic dispatch passes through
 * to the adapter's dedicated handler via next().
 */
export function registerSessionCommands(registry: CommandRegistry, _core: unknown): void {
  registry.register({
    name: 'new',
    description: 'Start a new session',
    usage: '[agent-name]',
    category: 'system',
    handler: async () => {
      return { type: 'silent' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'cancel',
    description: 'Cancel the current agent turn',
    category: 'system',
    handler: async () => {
      return { type: 'silent' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'status',
    description: 'Show current session status',
    category: 'system',
    handler: async () => {
      return { type: 'silent' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'sessions',
    description: 'List all active sessions',
    category: 'system',
    handler: async () => {
      return { type: 'silent' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'clear',
    description: 'Clear session history',
    category: 'system',
    handler: async () => {
      return { type: 'silent' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'newchat',
    description: 'New chat, same agent & workspace',
    category: 'system',
    handler: async () => {
      return { type: 'silent' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'resume',
    description: 'Resume a previous session',
    usage: '<session-number>',
    category: 'system',
    handler: async () => {
      return { type: 'silent' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'summary',
    description: 'Show session summary',
    category: 'system',
    handler: async () => {
      return { type: 'silent' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'handoff',
    description: 'Hand off session to another agent',
    usage: '<agent-name>',
    category: 'system',
    handler: async () => {
      return { type: 'silent' } satisfies CommandResponse
    },
  })
}
