import type { CommandRegistry } from '../command-registry.js'
import type { CommandResponse } from '../plugin/types.js'

export function registerHelpCommand(registry: CommandRegistry, _core: unknown): void {
  registry.register({
    name: 'help',
    description: 'Show available commands',
    usage: '[command]',
    category: 'system',
    handler: async (args) => {
      const query = args.raw.trim()

      if (query) {
        const cmd = registry.get(query)
        if (!cmd) {
          return { type: 'error', message: `Unknown command: /${query}` } satisfies CommandResponse
        }
        let text = `/${cmd.name}`
        if (cmd.usage) text += ` ${cmd.usage}`
        text += `\n${cmd.description}`
        return { type: 'text', text } satisfies CommandResponse
      }

      // Auto-generate help from registry at invocation time
      const systemCmds = registry.getByCategory('system')
      const pluginCmds = registry.getByCategory('plugin')

      const lines: string[] = []

      if (systemCmds.length > 0) {
        lines.push('System Commands:')
        for (const cmd of systemCmds) {
          const usage = cmd.usage ? ` ${cmd.usage}` : ''
          lines.push(`  /${cmd.name}${usage} — ${cmd.description}`)
        }
      }

      if (pluginCmds.length > 0) {
        if (lines.length > 0) lines.push('')
        lines.push('Plugin Commands:')
        for (const cmd of pluginCmds) {
          const usage = cmd.usage ? ` ${cmd.usage}` : ''
          lines.push(`  /${cmd.name}${usage} — ${cmd.description}`)
        }
      }

      if (lines.length === 0) {
        return { type: 'text', text: 'No commands registered.' } satisfies CommandResponse
      }

      return { type: 'text', text: lines.join('\n') } satisfies CommandResponse
    },
  })
}
