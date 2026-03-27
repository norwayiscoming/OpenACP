import type { CommandRegistry } from '../command-registry.js'
import type { CommandResponse } from '../plugin/types.js'

export function registerAgentCommands(registry: CommandRegistry, _core: unknown): void {
  registry.register({
    name: 'agents',
    description: 'List available agents',
    category: 'system',
    handler: async () => {
      return { type: 'text', text: 'No agents configured.' } satisfies CommandResponse
    },
  })

  registry.register({
    name: 'install',
    description: 'Install a plugin',
    usage: '<plugin-name>',
    category: 'system',
    handler: async (args) => {
      const plugin = args.raw.trim()
      if (!plugin) {
        return { type: 'error', message: 'Usage: /install <plugin-name>' } satisfies CommandResponse
      }
      return { type: 'text', text: `Installing plugin: ${plugin}...` } satisfies CommandResponse
    },
  })
}
