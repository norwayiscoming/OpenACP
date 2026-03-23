export interface FileInfo {
  filePath: string
  content: string
  oldContent?: string
}

/**
 * Extract file path and content from ACP tool_call/tool_update content.
 *
 * ACP content formats observed:
 * - Diff block: [{ type: "diff", path: "...", oldText: "...", newText: "..." }]
 * - Content wrapper: [{ type: "content", content: { type: "text", text: "..." } }]
 * - Text block: { type: "text", text: "..." }
 * - rawInput: { file_path: "...", content: "..." }
 */
export function extractFileInfo(
  name: string,
  kind: string | undefined,
  content: unknown,
  rawInput?: unknown,
  meta?: unknown,
): FileInfo | null {
  // Only process file-related tool kinds
  if (kind && !['read', 'edit', 'write'].includes(kind)) return null

  let info: Partial<FileInfo> | null = null

  // 1. Try _meta.claudeCode.toolResponse (Claude Code puts raw file data here)
  if (meta) {
    const m = meta as any
    const tr = m?.claudeCode?.toolResponse
    // Read tool: toolResponse.file.filePath + toolResponse.file.content
    const file = tr?.file
    if (file?.filePath && file?.content) {
      info = { filePath: file.filePath, content: file.content }
    }
    // Write/Edit tool: toolResponse.filePath + toolResponse.content (direct)
    if (!info && tr?.filePath && tr?.content) {
      info = { filePath: tr.filePath, content: tr.content }
    }
  }

  // 2. Try rawInput for file path + content from regular content
  if (!info && rawInput) {
    const ri = rawInput as any
    const filePath = ri?.file_path || ri?.filePath || ri?.path
    if (typeof filePath === 'string') {
      // Try to get content from the content field (including oldContent for diffs)
      const parsed = content ? parseContent(content) : null
      info = { filePath, content: parsed?.content || ri?.content, oldContent: parsed?.oldContent }
    }
  }

  // 3. Try to extract from known ACP content patterns
  if (!info && content) {
    info = parseContent(content)
  }

  if (!info) return null

  // Infer file path from tool name if not in content
  if (!info.filePath) {
    const pathMatch = name.match(/(?:Read|Edit|Write|View)\s+(.+)/i)
    if (pathMatch) info.filePath = pathMatch[1].trim()
  }

  if (!info.filePath || !info.content) return null
  return info as FileInfo
}

function parseContent(content: unknown): Partial<FileInfo> | null {
  if (typeof content === 'string') {
    return { content }
  }

  if (Array.isArray(content)) {
    // Array of content blocks — try each
    for (const block of content) {
      const result = parseContent(block)
      if (result?.content || result?.filePath) return result
    }
    return null
  }

  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, unknown>

    // ACP diff block: { type: 'diff', path: '...', oldText: '...', newText: '...' }
    if (c.type === 'diff' && typeof c.path === 'string') {
      const newText = c.newText as string | null | undefined
      const oldText = c.oldText as string | null | undefined
      if (newText) {
        return {
          filePath: c.path as string,
          content: newText,
          oldContent: oldText ?? undefined,
        }
      }
    }

    // ACP content wrapper: { type: 'content', content: { type: 'text', text: '...' } }
    if (c.type === 'content' && c.content) {
      return parseContent(c.content)
    }

    // ACP text block: { type: 'text', text: '...' }
    if (c.type === 'text' && typeof c.text === 'string') {
      return { content: c.text, filePath: c.filePath as string | undefined }
    }

    // Direct fields
    if (typeof c.text === 'string') {
      return { content: c.text, filePath: c.filePath as string | undefined }
    }

    // Tool input with file path: { file_path: '...', content: '...' }
    if (typeof c.file_path === 'string' || typeof c.filePath === 'string' || typeof c.path === 'string') {
      const filePath = (c.file_path || c.filePath || c.path) as string
      const fileContent = (c.content || c.text || c.output || c.newText) as string | undefined
      if (typeof fileContent === 'string') {
        return {
          filePath,
          content: fileContent,
          oldContent: (c.old_content || c.oldText) as string | undefined,
        }
      }
    }

    // Nested input/output
    if (c.input) {
      const result = parseContent(c.input)
      if (result) return result
    }
    if (c.output) {
      const result = parseContent(c.output)
      if (result) return result
    }
  }

  return null
}
