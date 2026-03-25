# Message Formatting Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

Unified message formatting system for all OpenACP adapters. Introduces a 2-layer architecture: a shared formatter that converts `OutgoingMessage` into a platform-agnostic `FormattedMessage`, and per-adapter renderers that convert to native output (Telegram HTML, Discord markdown, Slack mrkdwn, Web React components). Includes smart tool call summaries with expandable detail.

## Decisions

| Aspect | Decision |
|---|---|
| Scope | All message types, all adapters |
| Target adapters | Telegram + Discord + Web chat (Slack future-ready) |
| Tool display | Smart 1-line summary + click to expand detail |
| Architecture | Shared formatter → adapter renderer |
| Shared utils | Extract duplicated code from Telegram/Discord |

## Architecture

### 2-Layer Design

```
Layer 1: Shared Formatter (platform-agnostic)
  OutgoingMessage → FormattedMessage (structured data)

Layer 2: Adapter Renderer (platform-specific)
  FormattedMessage → native output
    Telegram: HTML tags (<b>, <code>, <pre>)
    Discord:  Markdown (**bold**, ```code```)
    Slack:    mrkdwn (*bold*, ```code```)
    Web:      React component props
```

**Pipeline position:** The formatter sits AFTER `MessageTransformer` (which converts `AgentEvent` → `OutgoingMessage`) and BEFORE adapter rendering. It replaces the per-adapter formatting logic inside `MessageHandlers.onToolCall()`, `onPlan()`, etc.

```
AgentEvent → MessageTransformer → OutgoingMessage → SharedFormatter → FormattedMessage → AdapterRenderer → native output
```

`MessageTransformer` continues to handle the `AgentEvent` → `OutgoingMessage` conversion (extracting text, metadata, attachments). The shared formatter takes `OutgoingMessage` and produces `FormattedMessage` with smart summaries and structured metadata.

**Required MessageTransformer change:** Add `rawInput: event.rawInput` to metadata in `MessageTransformer.transform()` for `tool_call` and `tool_update` cases. Without rawInput, `formatToolSummary()` cannot extract tool args (file_path, command, pattern) and would always fallback to generic `🔧 ToolName`. This is a 1-line change per case in `message-transformer.ts`.

### FormattedMessage Interface

```typescript
interface FormattedMessage {
  summary: string          // 1-line human-readable summary
  detail?: string          // Full content for expanded view
  icon: string             // Status/type emoji
  originalType: string     // Preserves OutgoingMessage.type (e.g. "tool_call" vs "tool_update")
  style: MessageStyle      // Grouped style for rendering decisions
  metadata?: MessageMetadata
}

type MessageStyle = "text" | "thought" | "tool" | "plan" | "usage" | "system" | "error" | "attachment"
// Note: style groups related types (tool_call + tool_update → "tool", session_end + system_message → "system").
// Renderers that need to distinguish (e.g. tool_call = new message, tool_update = edit existing) use originalType.

interface MessageMetadata {
  toolName?: string
  toolStatus?: "running" | "done" | "error"
  toolKind?: string         // read, edit, write, bash, grep, etc.
  filePath?: string
  command?: string
  planEntries?: { content: string; status: string }[]
  tokens?: number
  contextSize?: number
  cost?: number
  viewerLinks?: { type: "file" | "diff"; url: string; label: string }[]
}
```

## Smart Summary Logic

### Tool Call Summaries

The shared formatter generates 1-line summaries by pattern-matching on tool name and extracting relevant args from the ACP content structure.

| Tool | Args extracted | Summary example |
|---|---|---|
| `Read` | `file_path`, `limit` | `📖 Read src/main.ts (50 lines)` |
| `Edit` | `file_path` | `✏️ Edit src/app.ts` |
| `Write` | `file_path` | `📝 Write new-file.ts` |
| `Bash` | `command` (first 60 chars) | `▶️ Run: pnpm test` |
| `Grep` | `pattern`, `path` | `🔍 Grep "TODO" in src/` |
| `Glob` | `pattern` | `🔍 Glob **/*.ts` |
| `Agent` | `description` | `🧠 Agent: Search codebase` |
| `WebFetch` | URL | `🌐 Fetch https://api.example.com` |
| `WebSearch` | query | `🌐 Search "react markdown"` |
| Unknown | — | `🔧 ToolName` |

**Implementation:** `formatToolSummary(name: string, content: unknown): string`
- Parse `content` (may be string, object, or nested ACP content block)
- Use `extractContentText()` (existing shared util) for nested ACP content blocks
- Match tool name case-insensitively against known patterns
- Fallback to `🔧 {name}` for unknown tools

### Status Icons

Shared constants:

```typescript
const STATUS_ICONS: Record<string, string> = {
  pending: "⏳",
  in_progress: "🔄",
  completed: "✅",
  failed: "❌",
  cancelled: "🚫",
  // Aliases for compatibility
  running: "🔄",
  done: "✅",
  error: "❌",
}

const KIND_ICONS: Record<string, string> = {
  read: "📖",
  edit: "✏️",
  write: "✏️",             // alias for edit
  delete: "🗑️",
  execute: "▶️",
  command: "▶️",            // normalized from Discord's ⚡ (intentional change for consistency)
  bash: "▶️",              // alias for execute
  search: "🔍",
  web: "🌐",
  fetch: "🌐",             // alias for web
  agent: "🧠",
  think: "🧠",             // alias for agent
  install: "📦",
  move: "📦",              // alias for install
  other: "🛠️",             // fallback for unknown kinds
}
// Canonical superset mapping — includes all keys from both Telegram and Discord adapters plus aliases.
// Note: Discord currently uses ⚡ for "command" — this normalizes to ▶️ for cross-adapter consistency.
```

## Message Type Formatting

### Format Specification per Type

| Type | Icon | Summary | Detail | Collapsible | Style |
|---|---|---|---|---|---|
| `text` | — | Full markdown text | — | No | `text` |
| `thought` | 💭 | First 80 chars + "..." | Full thought text | Yes | `thought` |
| `tool_call` | Smart (kind-based) | Smart summary from args | Tool args + output content | Yes | `tool` |
| `tool_update` | Smart (kind-based) | Smart summary + status icon | Updated output content | Yes | `tool` |
| `plan` | 📋 | "Plan: {N} steps" | Checklist: status icon + content per entry | Yes | `plan` |
| `usage` | 📊 | "{tokens} tokens · ${cost}" | Full breakdown (tokens, context, cost, progress bar) | No | `usage` |
| `error` | ❌ | Error message (first 120 chars) | Full error + stack trace | Yes | `error` |
| `session_end` | ✅ or ❌ | "Session {reason}" | — | No | `system` |
| `system_message` | ℹ️ | Message text | — | No | `system` |
| `attachment` | 📎 | File name + type | — | No | `attachment` |

**Note:** `permission_request` is NOT an `AgentEvent` type — it flows through a separate `PermissionRequest` interface in `session-bridge.ts`. Permission formatting is handled independently by each adapter's `sendPermissionRequest()`, not by this formatter.

**Skipped events** (passed through without formatting):
- `image_content` / `audio_content` — handled by `FileService` and adapter-specific media rendering
- `commands_update` — UI-only event for skill command buttons, not user-visible content

### Formatter Function

```typescript
function formatOutgoingMessage(msg: OutgoingMessage): FormattedMessage
```

Central dispatch: switch on `msg.type`, construct `FormattedMessage` with appropriate summary, detail, icon, style, and metadata. Extracts tool args from `msg.metadata` for smart summaries.

## Adapter Renderers

Each adapter implements a renderer that converts `FormattedMessage` to native output.

### Renderer Interface

```typescript
interface MessageRenderer<T = string> {
  render(msg: FormattedMessage, expanded: boolean): T
  renderFull(msg: FormattedMessage): T  // non-collapsible messages (text, usage, system)
}
// Telegram/Discord/Slack: MessageRenderer<string> — expanded param ignored (always collapsed)
// Web: MessageRenderer<FormattedMessageProps> — expanded toggles detail visibility
```

### Telegram Renderer

- `render(msg, expanded)` → `{icon} <b>{summary}</b>` (expanded param ignored — Telegram cannot expand inline)
- `renderFull()` → HTML formatted text
- Markdown → HTML conversion (existing `formatMarkdown()`)
- Max length: 3800 chars, smart split at paragraph boundaries
- Viewer links: `📄 <a href="...">file</a>`

### Discord Renderer

- `render(msg, expanded)` → `{icon} **{summary}**` (expanded param ignored — Discord cannot expand inline)
- `renderFull()` → native markdown
- Max length: 1800 chars, smart split
- Viewer links: `📄 [file](url)`

### Slack Renderer (future-ready)

- `render(msg, expanded)` → `{icon} *{summary}*` (expanded param ignored — Slack uses thread replies for detail)
- `renderFull()` → Slack mrkdwn
- Max length: 3000 chars per block
- Viewer links: `📄 <url|file>`

### Web Renderer

- Does NOT produce strings — returns structured props for React components
- `FormattedMessage` consumed directly by chat components (`ToolCallCard`, `ThoughtCard`, etc.)
- Collapsible: `<details>/<summary>` or custom expand/collapse state
- Code in detail: syntax highlighted via `react-syntax-highlighter`
- Links: native `<a>` tags

## File Structure

### New Files

```
src/adapters/shared/
  message-formatter.ts       — formatOutgoingMessage(), formatToolSummary(), content extraction
  message-formatter.test.ts  — Unit tests for all message types + tool summaries
  format-types.ts            — FormattedMessage, MessageRenderer, icon constants (types + constants only)
  format-utils.ts            — progressBar(), formatTokens(), splitMessage() (shared utilities)
```

### Modified Files

```
src/adapters/telegram/formatting.ts
  — Import FormattedMessage, implement TelegramRenderer
  — Refactor existing format functions to use shared formatter
  — Remove duplicated extractContentText(), icon maps

src/adapters/discord/formatting.ts
  — Import FormattedMessage, implement DiscordRenderer
  — Refactor existing format functions to use shared formatter
  — Remove duplicated extractContentText(), icon maps

src/adapters/telegram/adapter.ts
  — Update message dispatch to use formatter → renderer pipeline

src/adapters/discord/adapter.ts
  — Update message dispatch to use formatter → renderer pipeline
```

### Web Chat Files (Phase 2 — from UI chat spec, not implemented in this spec)

```
ui/src/lib/message-renderer.ts  — Web renderer (FormattedMessage → React props)
ui/src/components/chat/
  ToolCallCard.tsx   — Consumes FormattedMessage with collapsible detail
  ThoughtCard.tsx    — Consumes FormattedMessage with collapsible detail
  PlanCard.tsx       — Renders plan entries from metadata
  UsageBlock.tsx     — Renders usage from metadata
```

Note: Web adapter implementation is a separate phase. This spec establishes the `MessageRenderer<T>` interface and `FormattedMessage` structure that the web adapter will consume. Implementation lives in the UI chat spec.

## Shared Utilities Extraction

Currently duplicated between Telegram and Discord formatters. Move to shared:

| Utility | Current location | New location |
|---|---|---|
| `extractContentText()` | Both formatters | `message-formatter.ts` |
| `progressBar()` | Both formatters | `format-utils.ts` |
| `formatTokens()` | Both formatters | `format-utils.ts` |
| `splitMessage()` | Both formatters | `format-utils.ts` |
| `truncateContent()` | Both formatters | `format-utils.ts` |

**Note on `truncateContent`:** Max length differs per adapter (Telegram: 3800, Discord: 500). Shared function signature: `truncateContent(text: string, maxLen: number): string` — no default value, adapters must pass explicit limit.
| Status icon map | Both formatters | `format-types.ts` (constants only) |
| Kind icon map | Both formatters | `format-types.ts` (constants only) |

## Integration with Message Dispatcher

Current flow:
```
dispatcher.onToolCall(ctx, event) → adapter formats internally
```

New flow:
```
dispatcher.onToolCall(ctx, msg)
  → const formatted = formatOutgoingMessage(msg)
  → const output = renderer.render(formatted, false)
  → adapter.sendMessage(ctx, output)
```

The `message-dispatcher.ts` interface stays the same — adapters still implement `MessageHandlers`. The change is internal to each handler: call shared formatter first, then adapter-specific renderer.

## Expand/Collapse Behavior per Adapter

| Adapter | Collapsed | Expand trigger | Expanded |
|---|---|---|---|
| **Telegram** | Short summary message | Not expandable (Telegram limitation — no interactive expand). Detail shown in separate reply or on tool completion. | Full message on `tool_update` with status `done` |
| **Discord** | Short summary message | Not expandable natively. Detail appended on `tool_update`. | Full message edited on completion |
| **Slack** | Short summary in blocks | Block Kit `overflow` menu or separate thread reply | Thread reply with detail |
| **Web** | `<CollapsibleCard>` summary | Click to expand (CSS transition) | Inline expanded detail with syntax highlighting |

**Note:** Telegram and Discord don't support interactive expand/collapse in messages. For these adapters:
- `tool_call` with status `running` → show collapsed summary
- `tool_update` with status `done` → edit message to include detail (or append if edit not possible)
- Web chat is the only adapter with true expand/collapse UX

## Telegram-specific: `formatUsageReport()`

`telegram/formatting.ts` has a `formatUsageReport()` function (~30 lines) used by the `/usage` command for period summaries with budget tracking. This function stays Telegram-specific for now — it is not part of the shared formatter because it formats aggregated usage data, not individual agent events. Discord and other adapters can implement their own version when needed.

## Testing Strategy

### Unit Tests (`message-formatter.test.ts`)

- **Tool summary tests:** Verify correct summary for each known tool (Read, Edit, Bash, Grep, Write, Agent, etc.)
- **Unknown tool fallback:** Verify `🔧 ToolName` format
- **Content extraction:** Nested ACP content blocks parsed correctly
- **All message types:** Each OutgoingMessage type produces correct FormattedMessage
- **Icon selection:** Status and kind icons mapped correctly
- **Edge cases:** Empty content, missing args, very long content truncation

### Adapter Renderer Tests

- `telegram/formatting.test.ts` — Telegram renderer produces valid HTML (no unclosed tags)
- `discord/formatting.test.ts` — Discord renderer respects 1800 char limit
- Both: `splitMessage()` preserves code block integrity (odd backtick detection)
- Note: Both adapters currently have **no formatter tests** — this is an opportunity to add coverage.

## Implementation Order

```
1. Extract shared utilities → format-utils.ts, format-types.ts (+ tests)
2. Add rawInput to MessageTransformer metadata (1-line × 2 cases)
3. Implement formatOutgoingMessage() + formatToolSummary() (+ tests)
4. Refactor Discord adapter (simpler, fewer quirks — validate shared formatter works)
5. Refactor Telegram adapter (complex: HTML conversion, viewer links)
6. (Future phase) Web adapter — separate spec/plan cycle
```

Discord before Telegram because Discord formatting is simpler — validates the shared formatter works correctly before tackling Telegram's HTML conversion.

## Backward Compatibility

- **No breaking changes** to adapter interfaces — `MessageHandlers` stays the same
- **Internal refactor only** — formatting logic changes inside adapters
- **Existing message output** may change visually (improved formatting) but no functional regression
- **Gradual adoption** — adapters can migrate one at a time; old formatting still works until replaced

## Out of Scope (Future)

- Interactive expand/collapse for Telegram/Discord (platform limitation)
- Rich diff viewer in tool detail (separate feature)
- Tool-specific custom renderers (beyond smart summary)
- Inline image/audio rendering in formatted messages
- User-configurable formatting preferences
