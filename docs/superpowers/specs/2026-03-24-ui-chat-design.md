# UI Chat Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

Upgrade the existing `SessionDetailPage` in the OpenACP dashboard into a full chat interface. Adds message persistence (JSONL per session), turn-based message grouping, markdown rendering, collapsible tool calls/thoughts, inline permission handling, and streaming text accumulation.

## Decisions

| Aspect | Decision |
|---|---|
| Scope | Upgrade SessionDetailPage (not a new route) |
| Persistence | JSONL per session file |
| Markdown | Basic: bold, italic, code blocks (syntax highlight), links |
| Tool calls/thoughts | Collapsed by default, click to expand |
| Permissions | Inline cards in chat flow (replace modal) |
| File attachments | Not in v1 |
| Streaming | Text chunk accumulation + typing indicator |
| History | Load on mount via API, then SSE for real-time |

## Message Store (Backend)

### Storage

Per-session JSONL files at `~/.openacp/messages/{sessionId}.jsonl`. Append-only, one JSON object per line.

### Message Schema

```typescript
interface ChatMessage {
  id: string              // nanoid(12)
  role: "user" | "assistant" | "system"
  type: "text" | "thought" | "tool_call" | "tool_update"
       | "plan" | "usage" | "error" | "session_end"
       | "system_message"
       | "permission_request" | "permission_response"
  content: string
  metadata?: Record<string, unknown>  // tool name, status, plan entries, cost, etc.
  ts: number              // Unix ms timestamp
}
```

Example JSONL content:
```jsonl
{"id":"abc123","role":"user","type":"text","content":"fix the auth bug in login.ts","ts":1711324800000}
{"id":"def456","role":"assistant","type":"text","content":"I'll look at the login.ts file...","ts":1711324801000}
{"id":"ghi789","role":"assistant","type":"tool_call","content":"Read file","metadata":{"name":"Read","args":{"path":"src/login.ts"},"status":"done"},"ts":1711324802000}
{"id":"jkl012","role":"assistant","type":"text","content":"Found the issue. The token validation...","ts":1711324805000}
```

### MessageStore Class

New file: `src/core/message-store.ts`

```typescript
class MessageStore {
  constructor(private baseDir: string)  // ~/.openacp/messages/

  append(sessionId: string, message: ChatMessage): void
  // Append one JSON line to {sessionId}.jsonl. Create file if not exists.
  // Uses persistent write stream (fs.createWriteStream with flags: 'a') per session
  // to avoid blocking event loop during high-frequency agent streaming.
  // Streams are cached and closed after 30s idle or on session end.

  getMessages(sessionId: string, after?: number): ChatMessage[]
  // Read all lines from JSONL file, parse, filter by ts > after if provided.
  // Return empty array if file not found.

  deleteSession(sessionId: string): void
  // Remove JSONL file for session.

  cleanup(ttlDays: number): void
  // Remove files older than ttlDays based on file mtime.
  // Called on startup, follows session store TTL setting.
}
```

### Write Flow

1. **User sends prompt** → `handleSendPrompt` in API server appends `{ role: "user", type: "text", content: prompt }` before enqueuing
2. **Agent emits events** → SessionBridge handler appends `{ role: "assistant", type: event.type, content: ... }` for each event
3. **Permission request** → append `{ role: "system", type: "permission_request", content: description, metadata: { id, options } }`
4. **Permission resolved** → append `{ role: "system", type: "permission_response", content: "allowed|rejected", metadata: { requestId } }`
5. **System messages** → append `{ role: "system", type: "system_message", content: message }`

**Skipped events** (not persisted to JSONL):
- `image_content` / `audio_content` — file attachments out of scope for v1. These are handled by FileService and adapter-specific rendering.
- `commands_update` — UI-only event for skill command buttons, not conversational content.

### API Endpoint

```
GET /api/sessions/{id}/messages?after=<timestamp>
```

- Returns `ChatMessage[]` sorted by `ts` ascending
- `after` param filters messages with `ts > after` (for incremental loading)
- Returns `404` if session ID not found in session manager
- Returns `[]` if session exists but has no message file yet
- Auth: same Bearer token as other API endpoints
- URL routing: regex `/^\/api\/sessions\/([^/]+)\/messages/` — must be registered before the catch-all session detail route. Query params parsed via `URL` constructor, not raw string matching.

## Chat UI Components

### Component Tree

```
SessionDetailPage (rewrite)
├── ChatHeader
│   └── Session name, agent badge, status badge, dangerous toggle
├── MessageList
│   ├── UserMessage          — Right-aligned bubble
│   ├── AssistantMessage     — Left-aligned, grouped by turn
│   │   ├── TextBlock        — Markdown rendered content
│   │   ├── ToolCallCard     — Collapsed: "🔧 Read — ✅". Expandable detail.
│   │   ├── ThoughtCard      — Collapsed: "💭 Thinking...". Expandable.
│   │   └── UsageBlock       — Token/cost footer on turn end
│   ├── SystemMessage        — Center-aligned, muted (errors, session_end)
│   └── PermissionCard       — Inline Allow/Always Allow/Reject buttons
├── TypingIndicator          — "Agent is working..." when processing
└── PromptInput              — Textarea + Send button
```

### File Structure

```
ui/src/components/chat/
  ChatHeader.tsx
  MessageList.tsx
  UserMessage.tsx
  AssistantMessage.tsx
  TextBlock.tsx
  ToolCallCard.tsx
  ThoughtCard.tsx
  PermissionCard.tsx
  PlanCard.tsx
  UsageBlock.tsx
  SystemMessage.tsx
  TypingIndicator.tsx
  PromptInput.tsx

ui/src/hooks/
  use-chat-messages.ts
  use-auto-scroll.ts

ui/src/lib/
  message-grouper.ts
```

### Component Details

**ChatHeader** — Replaces current session info section. Shows session name (editable?), agent name, `StatusBadge`, dangerous mode toggle. Compact horizontal bar.

**MessageList** — `overflow-y-auto` container. Uses `use-auto-scroll` hook. Renders grouped messages.

**UserMessage** — Right-aligned bubble with user prompt text. Timestamp on hover. If send failed → show red border + retry button.

**AssistantMessage** — Left-aligned container. Groups all assistant events belonging to one turn (between two user messages). Contains:
- One or more `TextBlock` (accumulated text chunks)
- Zero or more `ToolCallCard` / `ThoughtCard` (interspersed)
- Optional `UsageBlock` at end of turn

**TextBlock** — Renders markdown via `react-markdown` + `remark-gfm`. Code blocks use `react-syntax-highlighter` with dark theme. Max-width container to prevent ultra-wide text.

**ToolCallCard** — Default collapsed state shows: `🔧 {toolName} — {status emoji}`. Click expands to show: tool arguments, output/content. Status emojis: ⏳ running, ✅ done, ❌ error.

**ThoughtCard** — Default collapsed: `💭 {first 80 chars}...`. Click expands full thought text. Styled muted/italic.

**PermissionCard** — Inline card in chat flow:
```
🔐 Permission Request
{description}
[Allow]  [Always Allow]  [Reject]
```
After resolved → buttons replaced with result text: "✅ Allowed" or "❌ Rejected". Non-interactive.

**PlanCard** — Renders `plan` events as a checklist. Each `PlanEntry` shown as: status icon (⏳/✅/❌) + content text. Compact vertical list within assistant message.

**UsageBlock** — Small muted footer showing token count and cost. Rendered at the end of a turn when `usage` event is present. Format: `📊 12.3k tokens · $0.04`.

**SystemMessage** — Center-aligned, small text, muted color. For `session_end` ("Session completed"), `error`, `system_message` events.

**TypingIndicator** — Animated dots or pulsing bar. Shown when `session.promptRunning === true` or receiving SSE events. Hidden after `session_end` or 5s idle.

**PromptInput** — Textarea with auto-resize (min 1 row, max 6 rows). Send button (primary color). Disabled when `session.status !== "active"`. Enter to send (Shift+Enter for newline). Shows queue depth if > 0.

## Turn Grouping

### Logic (`message-grouper.ts`)

```typescript
interface Turn {
  id: string
  userMessage?: ChatMessage        // The user prompt that started this turn
  assistantMessages: ChatMessage[] // All assistant/system events in this turn
}

function groupIntoTurns(messages: ChatMessage[]): Turn[]
```

Rules:
1. Each `role: "user"` message starts a new `Turn`
2. All subsequent non-user messages belong to the same turn
3. Messages before the first user message (e.g., system init) go into a turn with no `userMessage`
4. Within a turn, consecutive `type: "text"` messages from assistant are merged into one `TextBlock` for rendering (streaming accumulation)

### Streaming Accumulation

When SSE delivers `agent:event` with `type: "text"`:
- If the last entry in current turn is also `type: "text"` → append content to it (merge)
- Otherwise → create new text entry

This prevents dozens of tiny text messages and creates smooth streaming UX.

## AgentEvent → ChatMessage Mapping

Backend (SessionBridge) converts `AgentEvent` to `ChatMessage` when persisting. The same mapping runs on the frontend for SSE events received before history load.

| AgentEvent type | ChatMessage fields |
|---|---|
| `text` | `role: "assistant", type: "text", content: event.content` |
| `thought` | `role: "assistant", type: "thought", content: event.content` |
| `tool_call` | `role: "assistant", type: "tool_call", content: event.name, metadata: { id: event.id, name: event.name, status: event.status, args: event.content }` |
| `tool_update` | `role: "assistant", type: "tool_update", content: event.content, metadata: { id: event.id, name: event.name, status: event.status }` |
| `plan` | `role: "assistant", type: "plan", content: "", metadata: { entries: event.entries }` |
| `usage` | `role: "assistant", type: "usage", content: "", metadata: { tokensUsed, contextSize, cost }` |
| `error` | `role: "assistant", type: "error", content: event.message` |
| `session_end` | `role: "system", type: "session_end", content: event.reason` |
| `system_message` | `role: "system", type: "system_message", content: event.message` |
| `image_content` | **Skipped** (not persisted) |
| `audio_content` | **Skipped** (not persisted) |
| `commands_update` | **Skipped** (not persisted) |

The `id` field is generated via `nanoid(12)` on the backend when persisting. `ts` is `Date.now()` at persist time. `nanoid` is already available as a transitive dependency via the existing codebase.

## Real-time Flow

### Page Load

1. Component mounts → `useChatMessages(sessionId)` hook fires
2. `GET /api/sessions/{id}` — load session metadata (status, agent, name)
3. `GET /api/sessions/{id}/messages` — load full message history
4. Record `watermark = latest message ts` from history response
5. Group messages into turns → render
6. SSE subscription already active (via EventStreamContext)
7. Hook registers handlers for `agent:event`, `session:updated`, `permission:request`
8. **Deduplication**: SSE events with `ts <= watermark` are ignored (already in history). Additionally, deduplicate by `id` using a `Set<string>` of seen message IDs to handle edge cases where SSE arrives during fetch.

### Sending a Prompt

1. User types + hits Send
2. **Optimistic update**: immediately append `UserMessage` to UI with temp ID
3. `POST /api/sessions/{id}/prompt` → backend persists + enqueues
4. On success: replace temp ID with server-confirmed data
5. On failure: mark message as "failed" (red border, retry button)
6. SSE `agent:event` starts arriving → append to current turn

### Receiving Agent Events

1. SSE `agent:event` → `{ sessionId, event: AgentEvent }`
2. Filter by current sessionId
3. Map `AgentEvent` to `ChatMessage` format
4. Append to message list → re-group turns → re-render
5. Text accumulation: merge consecutive text events

### Permission Handling

1. SSE `permission:request` → render `PermissionCard` inline
2. User clicks Allow/Always Allow/Reject
3. `POST /api/sessions/{id}/permission` with response
4. Update card to resolved state
5. Backend appends `permission_response` message to JSONL

## Auto-scroll Behavior

`use-auto-scroll` hook:

- **Auto-scroll ON**: when user is at bottom (within 100px threshold)
- **Auto-scroll OFF**: when user scrolls up (reading history)
- **"Jump to bottom" button**: floating button appears when auto-scroll is OFF and new messages arrive
- **Click to dismiss**: clicking the button scrolls to bottom and re-enables auto-scroll
- Uses `IntersectionObserver` on a sentinel element at the bottom of `MessageList`

## Styling

Follow existing dashboard design system:
- **Tailwind CSS v4** with existing theme (zinc base, indigo primary)
- **User bubbles**: `bg-indigo-600 text-white rounded-2xl` right-aligned
- **Assistant messages**: `bg-zinc-800 rounded-2xl` left-aligned
- **System messages**: `text-zinc-500 text-sm` center-aligned
- **Tool/thought cards**: `bg-zinc-900 border border-zinc-700 rounded-lg` with expand animation
- **Permission cards**: `bg-zinc-900 border-l-4 border-amber-500` with action buttons
- **Code blocks**: Dark theme, `rounded-lg` with language label + copy button
- **Glassmorphism**: Consistent with existing Card component style

## Backend Changes

Post-refactor, the API layer lives in `src/core/api/` with route modules in `src/core/api/routes/`. Session creation is handled by `SessionFactory`, and event wiring by `SessionBridge.connect()` which calls `wireSessionToAdapter()`, `wirePermissions()`, and `wireLifecycle()`.

### Modified Files

**`src/core/api/routes/sessions.ts`**:
- Add route: `GET /api/sessions/:sessionId/messages` using the router's `:param` pattern
- Modify the `POST /api/sessions/:sessionId/prompt` handler: append user message to MessageStore before enqueue

**`src/core/api/index.ts`**:
- Add `messageStore` to `RouteDeps` interface
- Pass MessageStore instance when constructing deps

**`src/core/session-bridge.ts`**:
- Add `messageStore?: MessageStore` to `BridgeDeps` interface
- In `wireSessionToAdapter()`: after dispatching each agent event to the adapter, also append as ChatMessage to MessageStore (skip `image_content`, `audio_content`, `commands_update`)
- In `wirePermissions()`: append `permission_request` when emitting to adapter, append `permission_response` when gate resolves

### New Files

**`src/core/message-store.ts`**:
- MessageStore class as specified above
- Exported from `src/core/index.ts`

### Initialization

- MessageStore created in `src/main.ts` during server startup
- `cleanup(ttlDays)` called on startup (uses session store TTL config)
- Passed to `ApiServer` via `RouteDeps` and to `SessionBridge` via `BridgeDeps`
- Follows existing dependency injection pattern (constructor params, not globals)

## Frontend Changes

### Modified Files

**`ui/src/pages/SessionDetailPage.tsx`**:
- Complete rewrite: replace event list with chat component tree
- Remove `events` state, `counterRef`, raw event rendering
- Use `useChatMessages` hook instead

**`ui/src/api/client.ts`**:
- Add `getMessages(sessionId, after?)` method

**`ui/src/api/types.ts`**:
- Add `ChatMessage` interface
- Add `Turn` interface

### New Files

- All files in `ui/src/components/chat/`
- All files in `ui/src/hooks/` (use-chat-messages, use-auto-scroll)
- `ui/src/lib/message-grouper.ts`

### New Dependencies

```json
{
  "react-markdown": "^9.x",
  "react-syntax-highlighter": "^15.x",
  "remark-gfm": "^4.x"
}
```

Note: Use `react-syntax-highlighter/dist/esm/styles/prism` (Prism light build) and import only commonly needed languages (typescript, javascript, python, bash, json, yaml, go, rust, html, css) to keep bundle size under 200KB.

## Testing Strategy

### Backend Tests

- `src/__tests__/message-store.test.ts` — append, read, filter by timestamp, delete, cleanup
- `src/__tests__/api-server.test.ts` — add test for `GET /api/sessions/{id}/messages`

### Frontend Tests

- `ui/src/lib/message-grouper.test.ts` — turn grouping logic, text merging, edge cases
- Manual testing for chat UI (visual, interactive)

## Backward Compatibility

- **No schema changes** to existing config or session store
- **New directory** `~/.openacp/messages/` created on first write (no migration needed)
- **Existing sessions** without message files → chat shows empty history, works normally going forward
- **SSE events unchanged** — same event names and payloads
- **API additive only** — new endpoint, no changes to existing endpoints

## Out of Scope (Future)

- File/image attachments in chat
- Full GFM markdown (tables, images, headings beyond basic)
- Message search/filter
- Conversation export
- Message editing/deletion
- Multi-agent chat (multiple assistants in one session)
- Voice input/output in chat
- Chat notifications (browser notifications)
- Rich tool call visualizations (diff viewer, file tree)
