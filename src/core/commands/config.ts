import type { CommandRegistry } from '../command-registry.js'
import type { CommandResponse } from '../plugin/types.js'
import type { OpenACPCore } from '../core.js'
import type { ConfigOption, ConfigSelectChoice, ConfigSelectGroup } from '../types.js'

// ── Bypass keyword detection ─────────────────────────────────────────

import { isPermissionBypass } from '../utils/bypass-detection.js'
export { isPermissionBypass } from '../utils/bypass-detection.js'

// ── Helpers ──────────────────────────────────────────────────────────

/** Flatten grouped and ungrouped options into a flat array of ConfigSelectChoice */
function flattenChoices(options: (ConfigSelectChoice | ConfigSelectGroup)[]): ConfigSelectChoice[] {
  const result: ConfigSelectChoice[] = []
  for (const item of options) {
    if ('group' in item && 'options' in item) {
      result.push(...(item as ConfigSelectGroup).options)
    } else {
      result.push(item as ConfigSelectChoice)
    }
  }
  return result
}

// ── Generic category command factory ─────────────────────────────────

function registerCategoryCommand(
  registry: CommandRegistry,
  core: OpenACPCore,
  category: string,
  commandName: string,
  notSupportedMsg: string,
): void {
  registry.register({
    name: commandName,
    description: `Set ${commandName} for this session`,
    usage: `[value]`,
    category: 'system',
    handler: async (args) => {
      if (!args.sessionId) {
        return { type: 'error', message: '⚠️ No active session.' } satisfies CommandResponse
      }
      const session = core.sessionManager.getSession(args.sessionId)
      if (!session) {
        return { type: 'error', message: '⚠️ Session not found.' } satisfies CommandResponse
      }

      const configOption = session.getConfigByCategory(category)
      if (!configOption || configOption.type !== 'select') {
        return { type: 'error', message: `⚠️ ${notSupportedMsg}` } satisfies CommandResponse
      }

      const choices = flattenChoices(configOption.options)
      const raw = args.raw.trim()

      // No args → show menu
      if (!raw) {
        return {
          type: 'menu',
          title: configOption.name,
          options: choices.map(c => ({
            label: c.value === configOption.currentValue ? `✅ ${c.name}` : c.name,
            command: `/${commandName} ${c.value}`,
            hint: c.description,
          })),
        } satisfies CommandResponse
      }

      // Validate value
      const match = choices.find(c => c.value === raw)
      if (!match) {
        const valid = choices.map(c => c.value).join(', ')
        return { type: 'error', message: `⚠️ Invalid value "${raw}". Valid: ${valid}` } satisfies CommandResponse
      }

      // Fire middleware hook BEFORE sending to agent
      if (session.middlewareChain) {
        const result = await session.middlewareChain.execute('config:beforeChange', {
          sessionId: session.id, configId: configOption.id,
          oldValue: configOption.currentValue, newValue: raw,
        }, async (p) => p)
        if (!result) return { type: 'error', message: `Config change blocked by middleware.` } satisfies CommandResponse
      }

      // Set value via agent
      try {
        const response = await session.agentInstance.setConfigOption(
          configOption.id,
          { type: 'select', value: raw },
        )
        if (response.configOptions) {
          // Skip middleware hook on update — already validated above
          session.configOptions = response.configOptions as ConfigOption[]
        }
        return { type: 'text', text: `${configOption.name} set to ${match.name}.` } satisfies CommandResponse
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { type: 'error', message: `⚠️ Failed to set ${commandName}: ${msg}` } satisfies CommandResponse
      }
    },
  })
}

// ── /bypass command ───────────────────────────────────────────────

function registerDangerousCommand(registry: CommandRegistry, core: OpenACPCore): void {
  registry.register({
    name: 'bypass',
    description: 'Toggle bypass permissions (auto-approve all permissions)',
    usage: '[on|off]',
    category: 'system',
    handler: async (args) => {
      if (!args.sessionId) {
        return { type: 'error', message: '⚠️ No active session.' } satisfies CommandResponse
      }
      const session = core.sessionManager.getSession(args.sessionId)
      if (!session) {
        return { type: 'error', message: '⚠️ Session not found.' } satisfies CommandResponse
      }

      const raw = args.raw.trim().toLowerCase()
      const modeConfig = session.getConfigByCategory('mode')

      // Detect if the agent has a bypass value in mode options
      let bypassValue: string | undefined
      let nonBypassDefault: string | undefined
      if (modeConfig && modeConfig.type === 'select') {
        const choices = flattenChoices(modeConfig.options)
        bypassValue = choices.find(c => isPermissionBypass(c.value))?.value
        nonBypassDefault = choices.find(c => !isPermissionBypass(c.value))?.value
      }

      // Determine current dangerous state
      const isCurrentlyDangerous = bypassValue
        ? (modeConfig!.type === 'select' && isPermissionBypass(modeConfig!.currentValue as string))
        : !!session.clientOverrides.bypassPermissions

      // No args → show status menu
      if (!raw) {
        const status = isCurrentlyDangerous ? 'on' : 'off'
        const toggleCmd = isCurrentlyDangerous ? '/bypass off' : '/bypass on'
        const toggleLabel = isCurrentlyDangerous ? 'Turn off' : 'Turn on'
        return {
          type: 'menu',
          title: `Bypass permissions: ${status}`,
          options: [{ label: toggleLabel, command: toggleCmd }],
        } satisfies CommandResponse
      }

      if (raw !== 'on' && raw !== 'off') {
        return { type: 'error', message: '⚠️ Usage: /bypass [on|off]' } satisfies CommandResponse
      }

      const wantOn = raw === 'on'

      // Agent has bypass value in mode options → use setConfigOption
      if (bypassValue && modeConfig) {
        try {
          const targetValue = wantOn ? bypassValue : nonBypassDefault!
          const response = await session.agentInstance.setConfigOption(
            modeConfig.id,
            { type: 'select', value: targetValue },
          )
          if (response.configOptions) {
            // Direct assignment — skip middleware since config:beforeChange was already validated above via setConfigOption
            session.configOptions = response.configOptions as ConfigOption[]
          }
          return {
            type: 'text',
            text: `Bypass permissions ${wantOn ? 'enabled' : 'disabled'}.`,
          } satisfies CommandResponse
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { type: 'error', message: `⚠️ Failed: ${msg}` } satisfies CommandResponse
        }
      }

      // Fallback → client-side bypass
      session.clientOverrides.bypassPermissions = wantOn
      await core.sessionManager.patchRecord(session.id, {
        clientOverrides: { ...session.clientOverrides },
      })
      return {
        type: 'text',
        text: `Bypass permissions ${wantOn ? 'enabled' : 'disabled'} (client-side bypass).`,
      } satisfies CommandResponse
    },
  })
}

// ── Public registration ──────────────────────────────────────────────

export function registerConfigCommands(registry: CommandRegistry, _core: unknown): void {
  const core = _core as OpenACPCore
  registerCategoryCommand(registry, core, 'mode', 'mode', 'Agent does not support mode selection.')
  registerCategoryCommand(registry, core, 'model', 'model', 'Agent does not support model selection.')
  registerCategoryCommand(registry, core, 'thought_level', 'thought', 'Agent does not support thought level.')
  registerDangerousCommand(registry, core)
}
