import { createChildLogger } from '../utils/log.js'
import { ASSISTANT_PREAMBLE, buildAssistantGuidelines } from './prompt-constants.js'

const log = createChildLogger({ module: 'assistant-registry' })

export interface AssistantCommand {
  command: string
  description: string
}

export interface AssistantSection {
  id: string
  title: string
  priority: number
  buildContext: () => string | null
  commands?: AssistantCommand[]
}

export class AssistantRegistry {
  private sections = new Map<string, AssistantSection>()
  private _instanceRoot: string = ''

  /** Set the instance root path used in assistant guidelines */
  setInstanceRoot(root: string): void {
    this._instanceRoot = root
  }

  register(section: AssistantSection): void {
    if (this.sections.has(section.id)) {
      log.warn({ id: section.id }, 'Assistant section overwritten')
    }
    this.sections.set(section.id, section)
  }

  unregister(id: string): void {
    this.sections.delete(id)
  }

  buildSystemPrompt(channelId?: string): string {
    const sorted = [...this.sections.values()].sort((a, b) => a.priority - b.priority)
    const parts: string[] = [ASSISTANT_PREAMBLE]

    if (channelId) {
      parts.push(`## Current Channel\nYou are responding on the **${channelId}** channel. Adapt your formatting and behavior to this platform.`)
    }

    for (const section of sorted) {
      try {
        const context = section.buildContext()
        if (!context) continue
        parts.push(`## ${section.title}\n${context}`)
        if (section.commands?.length) {
          const cmds = section.commands.map((c) => `${c.command}  # ${c.description}`).join('\n')
          parts.push('```bash\n' + cmds + '\n```')
        }
      } catch (err) {
        log.warn({ err, sectionId: section.id }, 'Assistant section buildContext() failed, skipping')
      }
    }

    parts.push(buildAssistantGuidelines(this._instanceRoot))
    return parts.join('\n\n')
  }
}
