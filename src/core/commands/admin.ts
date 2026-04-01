import type { CommandRegistry } from '../command-registry.js'
import type { CommandResponse } from '../plugin/types.js'

export function registerAdminCommands(registry: CommandRegistry, _core: unknown): void {
  registry.register({
    name: 'restart',
    description: 'Restart the server',
    category: 'system',
    handler: async (args) => {
      const core = args.coreAccess as any
      const assistant = core?.assistantManager?.get(args.channelId)
      if (assistant && !args.sessionId) {
        await assistant.enqueuePrompt('User wants to restart OpenACP. Ask for confirmation before restarting.')
        return { type: 'delegated' } satisfies CommandResponse
      }
      return { type: 'text', text: 'Use /restart in the Assistant topic, or run `openacp api restart` in terminal.' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'update',
    description: 'Check for and apply updates',
    category: 'system',
    handler: async () => {
      return { type: 'text', text: 'Checking for updates...' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'doctor',
    description: 'Run system diagnostics',
    category: 'system',
    handler: async () => {
      return { type: 'text', text: 'Running diagnostics...' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'integrate',
    description: 'Set up a new channel integration',
    usage: '<channel>',
    category: 'system',
    handler: async (args) => {
      const channel = args.raw.trim()
      if (!channel) {
        return {
          type: 'menu',
          title: 'Available Integrations',
          options: [
            { label: 'Telegram', command: '/integrate telegram' },
            { label: 'Discord', command: '/integrate discord' },
          ],
        } satisfies CommandResponse
      }
      return { type: 'text', text: `Setting up ${channel} integration...` } satisfies CommandResponse
    },
  })
}
