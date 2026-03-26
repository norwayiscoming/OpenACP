import type { CommandRegistry } from '../command-registry.js'
import type { CommandResponse } from '../plugin/types.js'

export function registerSessionCommands(registry: CommandRegistry, _core: unknown): void {
  registry.register({
    name: 'new',
    description: 'Start a new session',
    usage: '[agent-name]',
    category: 'system',
    handler: async (args) => {
      const agent = args.raw.trim()
      if (agent) {
        return { type: 'text', text: `Starting new session with agent: ${agent}` } satisfies CommandResponse
      }
      return { type: 'text', text: 'Starting new session...' } satisfies CommandResponse
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
      return { type: 'text', text: 'No active session.' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'sessions',
    description: 'List all active sessions',
    category: 'system',
    handler: async () => {
      return { type: 'text', text: 'No active sessions.' } satisfies CommandResponse
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
    description: 'End current session and start a new one',
    category: 'system',
    handler: async () => {
      return { type: 'text', text: 'Ending session and starting a new one...' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'resume',
    description: 'Resume a previous session',
    usage: '<session-number>',
    category: 'system',
    handler: async (args) => {
      const id = args.raw.trim()
      if (!id) {
        return { type: 'error', message: 'Usage: /resume <session-number>' } satisfies CommandResponse
      }
      return { type: 'text', text: `Resuming session ${id}...` } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'summary',
    description: 'Show session summary',
    category: 'system',
    handler: async () => {
      return { type: 'text', text: 'No session summary available.' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'handoff',
    description: 'Hand off session to another agent',
    usage: '<agent-name>',
    category: 'system',
    handler: async (args) => {
      const agent = args.raw.trim()
      if (!agent) {
        return { type: 'error', message: 'Usage: /handoff <agent-name>' } satisfies CommandResponse
      }
      return { type: 'text', text: `Handing off to ${agent}...` } satisfies CommandResponse
    },
  })
}
