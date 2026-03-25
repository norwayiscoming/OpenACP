import type { PlanEntry } from '../../core/types.js'

const STATUS_ICON: Record<string, string> = {
  running: '🔄',
  completed: '✅',
  failed: '❌',
  pending: '⏳',
  in_progress: '🔄',
}

const KIND_ICON: Record<string, string> = {
  read: '📖',
  write: '✏️',
  command: '⚡',
  search: '🔍',
}

function extractContentText(content: unknown, depth = 0): string {
  if (!content || depth > 5) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => extractContentText(c, depth + 1))
      .filter(Boolean)
      .join('\n')
  }
  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, unknown>
    if (c.type === 'text' && typeof c.text === 'string') return c.text
    if (typeof c.text === 'string') return c.text
    if (typeof c.content === 'string') return c.content
    if (c.content && typeof c.content === 'object') return extractContentText(c.content, depth + 1)
    if (c.input) return extractContentText(c.input, depth + 1)
    if (c.output) return extractContentText(c.output, depth + 1)
    const keys = Object.keys(c).filter(k => k !== 'type')
    if (keys.length === 0) return ''
    return JSON.stringify(c, null, 2)
  }
  return String(content)
}

function truncateContent(text: string, maxLen = 500): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '\n… (truncated)'
}

function formatViewerLinks(links?: { file?: string; diff?: string }, filePath?: string): string {
  if (!links) return ''
  const fileName = filePath ? filePath.split('/').pop() || filePath : ''
  let text = '\n'
  if (links.file) text += `\n[View ${fileName || 'file'}](${links.file})`
  if (links.diff) text += `\n[View diff${fileName ? ` — ${fileName}` : ''}](${links.diff})`
  return text
}

export function formatToolCall(tool: {
  id: string
  name?: string
  kind?: string
  status?: string
  content?: unknown
  viewerLinks?: { file?: string; diff?: string }
  viewerFilePath?: string
}): string {
  const si = STATUS_ICON[tool.status || ''] || '🔧'
  const ki = KIND_ICON[tool.kind || ''] || '🛠️'
  let text = `${si} ${ki} **${tool.name || 'Tool'}**`
  text += formatViewerLinks(tool.viewerLinks, tool.viewerFilePath)
  if (!tool.viewerLinks) {
    const details = extractContentText(tool.content)
    if (details) {
      text += `\n\`\`\`\n${truncateContent(details)}\n\`\`\``
    }
  }
  return text
}

export function formatToolUpdate(update: {
  id: string
  name?: string
  kind?: string
  status: string
  content?: unknown
  viewerLinks?: { file?: string; diff?: string }
  viewerFilePath?: string
}): string {
  return formatToolCall(update)
}

export function formatPlan(entries: PlanEntry[]): string {
  const statusIcon: Record<string, string> = {
    pending: '⏳',
    in_progress: '🔄',
    completed: '✅',
  }
  const lines = entries.map(
    (e, i) => `${statusIcon[e.status] || '⬜'} ${i + 1}. ${e.content}`,
  )
  return `**Plan:**\n${lines.join('\n')}`
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

function progressBar(ratio: number): string {
  const filled = Math.round(Math.min(ratio, 1) * 10)
  return '▓'.repeat(filled) + '░'.repeat(10 - filled)
}

export function formatUsage(usage: { tokensUsed?: number; contextSize?: number }): string {
  const { tokensUsed, contextSize } = usage
  if (tokensUsed == null) return '📊 Usage data unavailable'
  if (contextSize == null) return `📊 ${formatTokens(tokensUsed)} tokens`

  const ratio = tokensUsed / contextSize
  const pct = Math.round(ratio * 100)
  const bar = progressBar(ratio)
  const emoji = pct >= 85 ? '⚠️' : '📊'
  return `${emoji} ${formatTokens(tokensUsed)} / ${formatTokens(contextSize)} tokens\n${bar} ${pct}%`
}

export function splitMessage(text: string, maxLength = 1800): string[] {
  if (text.length <= maxLength) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // If only slightly over limit, split roughly in half for balanced chunks
    const wouldLeaveSmall = remaining.length < maxLength * 1.3
    const searchLimit = wouldLeaveSmall
      ? Math.floor(remaining.length / 2) + 300
      : maxLength

    let splitAt = remaining.lastIndexOf('\n\n', searchLimit)
    if (splitAt === -1 || splitAt < searchLimit * 0.2) {
      splitAt = remaining.lastIndexOf('\n', searchLimit)
    }
    if (splitAt === -1 || splitAt < searchLimit * 0.2) {
      splitAt = searchLimit
    }

    // Avoid splitting inside a fenced code block (odd number of ``` before split point)
    const candidate = remaining.slice(0, splitAt)
    const fences = candidate.match(/```/g)
    if (fences && fences.length % 2 !== 0) {
      // Find the closing fence after split point
      const closingFence = remaining.indexOf('```', splitAt)
      if (closingFence !== -1) {
        const afterFence = remaining.indexOf('\n', closingFence + 3)
        splitAt = afterFence !== -1 ? afterFence + 1 : closingFence + 3
      }
      // If no closing fence, split anyway (incomplete code block)
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).replace(/^\n+/, '')
  }
  return chunks
}
