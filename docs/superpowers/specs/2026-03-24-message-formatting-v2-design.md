# Message Formatting v2 Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

Three enhancements to the message formatting system:

1. **Agent-side display summaries** — agents provide their own tool call summaries via `_meta.displaySummary`, eliminating the need to maintain tool name mappings for 30+ agents
2. **Per-adapter verbosity levels** — `low`, `medium`, `high` control how much detail each adapter shows
3. **Noise filtering** — auto-hide or collapse low-value tool calls (directory reads, glob searches) that are internal agent mechanics

## Decisions

| Aspect | Decision |
|---|---|
| Agent summary source | `_meta.displaySummary` (optional, fallback to current `formatToolSummary`) |
| Verbosity scope | Per-adapter (config per channel) |
| Default verbosity | `medium` |
| Inline content on `medium` | **Removed** — `medium` now shows summary line + viewer links, no inline content. Previously `medium` included truncated content. This is a minor visual change: viewer links replace inline previews, giving a cleaner default. |
| Noise filtering | First-match-wins evaluation, `"hide" \| "collapse" \| null` return type |
| Breaking changes | `medium` visual output changes (inline content removed → viewer links instead). Config defaults to `"medium"` so no config migration needed. |

## 1. Agent-side Display Summaries

### Problem

`formatToolSummary()` hardcodes 9 Claude-specific tool names (`Read`, `Edit`, `Bash`, etc.). OpenACP supports 30+ agents with different naming:

| Agent | Tool name | Current match? |
|---|---|---|
| Claude | `Read` | ✅ |
| Codex | `read_file` | ❌ → `🔧 read_file` |
| Cline | `read_file` | ❌ → `🔧 read_file` |
| Cursor | `file_read` | ❌ → `🔧 file_read` |

### Solution

Agents provide summaries via the existing `_meta` freeform field in ACP protocol. No protocol spec change needed.

```typescript
// Agent emits tool_call with _meta:
{
  sessionUpdate: "tool_call",
  toolCallId: "tc-123",
  title: "read_file",
  kind: "read",
  status: "pending",
  rawInput: { path: "src/main.ts" },
  _meta: {
    displaySummary: "📖 Read src/main.ts (50 lines)",
    displayTitle: "src/main.ts",
    displayKind: "read"
  }
}
```

### Resolution order

**Summary** (used on `medium` and `high`):
```
1. meta.displaySummary → use directly (agent-provided)
2. formatToolSummary(name, rawInput) → pattern match (current logic)
3. Fallback → "🔧 {name}"
```

**Title** (used on `low`):
```
1. meta.displayTitle → use directly (agent-provided)
2. formatToolTitle(name, rawInput) → extract target (file path, command, query)
3. Fallback → name
```

**Kind**:
```
1. meta.displayKind → use directly
2. event.kind → from ACP event
3. Fallback → "other"
```

### MessageTransformer change

Forward `rawInput`, `displaySummary`, `displayTitle`, and `displayKind` into `OutgoingMessage.metadata`.

> **Note:** The current `MessageTransformer.transform()` does NOT forward `rawInput` to metadata.
> This is a pre-existing bug — `formatToolSummary()` needs `rawInput` to generate smart summaries
> (e.g., extracting `file_path` from Read, `command` from Bash). Without this fix, agents that
> don't send `_meta.displaySummary` still get generic `🔧 toolName` fallback.
> This change fixes the bug AND adds the new `_meta` fields in one pass.

```typescript
// In message-transformer.ts, tool_call case:
const meta = event.meta as Record<string, unknown> | undefined;
const metadata: Record<string, unknown> = {
  id: event.id,
  name: event.name,
  kind: event.kind,
  status: event.status,
  content: event.content,
  rawInput: event.rawInput,           // FIX: was missing — required for formatToolSummary fallback
  displaySummary: meta?.displaySummary,
  displayTitle: meta?.displayTitle,
  displayKind: meta?.displayKind,
};
```

Apply the same `rawInput` fix to the `tool_update` case (same pattern).

### formatToolSummary change

Add `displaySummary` parameter (agent-provided override) and extract a new `formatToolTitle()` for `low` verbosity:

```typescript
// Full summary for medium/high: "📖 Read src/main.ts (50 lines)"
export function formatToolSummary(
  name: string,
  rawInput: unknown,
  displaySummary?: string,
): string {
  if (displaySummary && typeof displaySummary === "string") {
    return displaySummary;
  }
  // ... existing pattern matching logic unchanged
}

// Title only for low: "src/main.ts", "pnpm test", "\"TODO\" in src/"
export function formatToolTitle(
  name: string,
  rawInput: unknown,
  displayTitle?: string,
): string {
  if (displayTitle && typeof displayTitle === "string") {
    return displayTitle;
  }
  let args: Record<string, unknown> = {};
  try {
    if (typeof rawInput === "string") args = JSON.parse(rawInput) as Record<string, unknown>;
    else if (typeof rawInput === "object" && rawInput !== null) args = rawInput as Record<string, unknown>;
  } catch { return name; }

  const lowerName = name.toLowerCase();

  // File operations → file path
  if (["read", "edit", "write"].includes(lowerName)) {
    return String(args.file_path ?? args.filePath ?? name);
  }
  // Bash → command (truncated)
  if (lowerName === "bash") {
    return String(args.command ?? name).slice(0, 60);
  }
  // Search → pattern + path
  if (lowerName === "grep") {
    const pattern = args.pattern ?? "";
    const path = args.path ?? "";
    return pattern ? `"${pattern}"${path ? ` in ${path}` : ""}` : name;
  }
  if (lowerName === "glob") {
    return String(args.pattern ?? name);
  }
  // Agent → description
  if (lowerName === "agent") {
    return String(args.description ?? name).slice(0, 60);
  }
  // Web → url or query
  if (["webfetch", "web_fetch"].includes(lowerName)) {
    return String(args.url ?? name).slice(0, 60);
  }
  if (["websearch", "web_search"].includes(lowerName)) {
    return String(args.query ?? name).slice(0, 60);
  }

  return name;
}
```

Usage in `formatOutgoingMessage`:
```typescript
// low:    statusIcon + formatToolTitle(name, rawInput, displayTitle)     → "🔄 src/main.ts"
// medium: statusIcon + formatToolSummary(name, rawInput, displaySummary) → "🔄 📖 Read src/main.ts (50 lines)"
// high:   same as medium + full content block
```

## 2. Per-adapter Verbosity Levels

### Config

New optional field `displayVerbosity` on each channel config:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "...",
      "chatId": 123,
      "displayVerbosity": "medium"
    },
    "discord": {
      "enabled": true,
      "botToken": "...",
      "displayVerbosity": "high"
    }
  }
}
```

**Type:** `"low" | "medium" | "high"`, default `"medium"`.

Added to `BaseChannelSchema` with `.default("medium")` for backward compatibility.

### Verbosity type

```typescript
export type DisplayVerbosity = "low" | "medium" | "high";
```

### Behavior matrix

| Message type | `low` | `medium` (default) | `high` |
|---|---|---|---|
| **text** | Full | Full | Full |
| **tool_call** | Title only + viewer links | Summary line + viewer links | Summary line + full content + viewer links |
| **tool_update** | Edit to title + ✅/❌ + viewer links | Edit with summary line + viewer links | Edit with full content + viewer links |
| **thought** | Hidden | First 80 chars italic | Full text |
| **plan** | Hidden | Entries with status icons | Entries + progress bar + percentage |
| **usage** | Hidden | Compact 1-line (`📊 12k tokens`) | Full breakdown with progress bar |
| **error** | Summary only (no detail) | Truncated 120 chars | Full text + stack |
| **system_message** | Shown | Shown | Shown |
| **session_end** | Shown | Shown | Shown |
| **attachment** | Shown | Shown | Shown |

> **Viewer links are ALWAYS shown** when available, regardless of verbosity level. They are lightweight
> (1-2 lines of links) and provide high value — users on mobile (`low`) especially benefit from
> tapping a link to see full content rather than scrolling through inline text.

### Tool call verbosity detail

The three levels control how much **inline content** is shown. Viewer links are independent.

| Level | Summary line | Inline content | Viewer links |
|---|---|---|---|
| `low` | Title only: `src/main.ts` | None | Always |
| `medium` | Full: `📖 Read src/main.ts (50 lines)` | None | Always |
| `high` | Full: `📖 Read src/main.ts (50 lines)` | Full content (up to platform limit) | Always |

**Title** = file path, command target, or search query — the "what" without the action verb.
**Summary line** = current `formatToolSummary()` output — icon + action + target + context.

### Examples per level

**Tool call (Read) — `low`:**
```
🔄 src/main.ts
📄 View src/main.ts
→ on completion, edit to:
✅ src/main.ts
📄 View src/main.ts
```

**Tool call (Read) — `medium`:**
```
🔄 📖 Read src/main.ts (50 lines)
📄 View src/main.ts
→ on completion, edit to:
✅ 📖 Read src/main.ts (50 lines)
📄 View src/main.ts
```

**Tool call (Read) — `high`:**
```
🔄 📖 Read src/main.ts (50 lines)
<pre>import { foo } from './bar.js'
const x = 1
// ... full file content</pre>
📄 View src/main.ts
```

**Tool call (Bash) — `low`:**
```
🔄 pnpm test
→ on completion:
✅ pnpm test
```

**Tool call (Bash) — `medium`:**
```
🔄 ▶️ Run: pnpm test
→ on completion:
✅ ▶️ Run: pnpm test
```

**Tool call (Bash) — `high`:**
```
🔄 ▶️ Run: pnpm test
<pre>PASS src/main.test.ts
  ✓ should work (3ms)
Test Suites: 1 passed</pre>
```

### Noise filtering (low-value tool calls)

Some tool calls are internal agent mechanics — they don't carry useful information for the user watching from a messaging app. These should be **auto-collapsed or hidden** depending on verbosity.

#### Noise rules

**Evaluation:** First-match-wins — rules are evaluated in order, the first matching rule determines the action. If no rule matches, `evaluateNoise()` returns `null` (show normally).

```typescript
type NoiseAction = "hide" | "collapse";

interface NoiseRule {
  match: (name: string, kind: string, rawInput: unknown) => boolean;
  action: NoiseAction;
}

// Returns the action of the first matching rule, or null if no match
function evaluateNoise(name: string, kind: string, rawInput: unknown): NoiseAction | null {
  for (const rule of NOISE_RULES) {
    if (rule.match(name, kind, rawInput)) return rule.action;
  }
  return null; // no match → show normally
}

const NOISE_RULES: NoiseRule[] = [
  // 1. LS tool — directory listing, agent exploring
  {
    match: (name) => name.toLowerCase() === "ls",
    action: "hide",
  },

  // 2. Directory reads — path ends with / (explicit directory)
  {
    match: (_name, kind, rawInput) => {
      if (kind !== "read") return false;
      const args = parseRawInput(rawInput);
      const path = String(args.file_path ?? args.filePath ?? args.path ?? "");
      return path.endsWith("/");
    },
    action: "hide",
  },

  // 3. Glob — file discovery, low value on its own
  {
    match: (name) => name.toLowerCase() === "glob",
    action: "collapse",
  },
];
```

> **Directory detection:** Only `path.endsWith("/")` is used, NOT `!path.includes(".")`.
> Files without extensions (`Makefile`, `Dockerfile`, `LICENSE`, `.env`, `.gitignore`) are
> legitimate reads that should be shown. The `/` suffix is the reliable directory signal.

#### Noise behavior per verbosity

| Noise action | `low` | `medium` | `high` |
|---|---|---|---|
| `hide` | Not shown | Not shown | Shown (collapsed) |
| `collapse` | Not shown | Status icon only (`✅ 🔍`) | Full summary |

#### Where noise filtering runs

Noise filtering runs **inside `formatOutgoingMessage()`** for tool_call/tool_update types, BEFORE producing `FormattedMessage`. It uses `rawInput` from metadata (which is now forwarded — see § MessageTransformer change).

```typescript
// In formatOutgoingMessage, tool_call case:
const noiseAction = evaluateNoise(name, kind, rawInput); // "hide" | "collapse" | null

if (noiseAction === "hide" && verbosity !== "high") return null;
if (noiseAction === "hide" && verbosity === "high") {
  // Show collapsed on high — status icon + title only, no full content
  return { summary: `${statusIcon} ${formatToolTitle(name, rawInput, displayTitle)}`, ... };
}
if (noiseAction === "collapse" && verbosity === "low") return null;
if (noiseAction === "collapse" && verbosity === "medium") {
  // Minimal: just status icon + kind icon, no summary text
  return { summary: `${statusIcon} ${kindIcon}`, icon: kindIcon, ... };
}
// noiseAction === null → normal formatting per verbosity level
```

### formatOutgoingMessage change

Add verbosity parameter. Extract `viewerLinks` from `OutgoingMessage.metadata` into `FormattedMessage.viewerLinks`:

```typescript
export function formatOutgoingMessage(
  msg: OutgoingMessage,
  verbosity: DisplayVerbosity = "medium",
): FormattedMessage | null {
  // Returns null when message should be hidden (e.g., thought on "low", noise-filtered)
  // ...

  // For tool_call / tool_update cases:
  const meta = (msg.metadata ?? {}) as Record<string, unknown>;
  const viewerLinks = Array.isArray(meta.viewerLinks)
    ? (meta.viewerLinks as string[])
    : undefined;

  // viewerLinks is ALWAYS passed through to FormattedMessage, regardless of verbosity.
  // Adapters render them at every level.
  return {
    summary: verbosity === "low"
      ? `${statusIcon} ${formatToolTitle(name, rawInput, displayTitle)}`
      : `${statusIcon} ${formatToolSummary(name, rawInput, displaySummary)}`,
    detail: verbosity === "high" ? extractContentText(meta.content) || undefined : undefined,
    viewerLinks,
    icon: KIND_ICONS[kind] ?? "🔧",
    originalType: msg.type,
    style: "tool",
    metadata: { toolName: name, toolStatus: status, toolKind: kind },
  };
}
```

Returning `null` signals that this message should be skipped entirely (hidden types, noise-filtered).

### Null-handling contract

Verbosity filtering happens at **two levels** to keep handler code clean:

1. **Dispatcher level (early exit):** `dispatchMessage` receives verbosity and calls `shouldDispatch(msg.type, verbosity)` before invoking the handler. Messages that are completely hidden (thought/plan/usage on `low`) never reach the handler at all.

2. **Handler level (detail control):** For messages that ARE dispatched but with reduced detail (e.g., tool_call on `low` = summary only), the handler calls `formatOutgoingMessage(msg, verbosity)` which returns a `FormattedMessage` with `detail: undefined`.

```typescript
// In message-dispatcher.ts:
const HIDDEN_ON_LOW: Set<string> = new Set(["thought", "plan", "usage"]);

function shouldDispatch(type: string, verbosity: DisplayVerbosity): boolean {
  if (verbosity === "low" && HIDDEN_ON_LOW.has(type)) return false;
  return true;
}

export async function dispatchMessage<TCtx>(
  handlers: MessageHandlers<TCtx>,
  ctx: TCtx,
  content: OutgoingMessage,
  verbosity: DisplayVerbosity = "medium",
): Promise<void> {
  if (!shouldDispatch(content.type, verbosity)) return;
  // ... existing switch/case routing
}
```

This means:
- **Type-level hiding** (thought/plan/usage on `low`) is handled by the dispatcher — these handlers never run.
- **Noise filtering** (LS, directory reads, glob) returns `null` from `formatOutgoingMessage` inside the handler. **Handlers MUST check for null** and skip sending when `formatOutgoingMessage` returns null. This is a lightweight check, not a verbosity decision — the handler simply does nothing.
- **Detail control** (low=title, medium=summary, high=full) is encoded in the `FormattedMessage` fields — handlers don't need to branch on verbosity.

### FormattedMessage change

```typescript
interface FormattedMessage {
  summary: string;        // Title (low) or full summary line (medium/high)
  detail?: string;        // Full content — only present on "high"
  viewerLinks?: string[]; // Always included when available, regardless of verbosity
  icon: string;
  originalType: string;
  style: MessageStyle;
  metadata?: MessageMetadata;
}
```

> **Design note:** `viewerLinks` is always populated when the tunnel service provides viewer URLs.
> Adapters render them at every verbosity level — they are lightweight and high-value, especially
> for mobile users on `low` who can tap to see full content instead of scrolling inline text.

### Adapter changes

**ToolCallTracker** — receives verbosity from adapter, controls inline content:

```typescript
// In formatToolCall / formatToolUpdate:
// - low: title only + viewer links (no inline content)
// - medium: summary line + viewer links (no inline content)
// - high: summary line + full inline content + viewer links
// Viewer links are ALWAYS rendered when present in FormattedMessage.viewerLinks
```

**ActivityTracker** — respects verbosity:

```typescript
// ThinkingIndicator: hidden on "low"
// PlanCard: hidden on "low"
// UsageMessage: hidden on "low", compact on "medium", full on "high"
```

**Noise filtering** — applied before rendering:

```typescript
// Adapter calls formatOutgoingMessage(msg, verbosity) which internally:
// - Evaluates noise rules against tool name/kind/rawInput
// - Returns null for hidden noise (adapter skips)
// - Returns minimal FormattedMessage for collapsed noise
// - Returns full FormattedMessage otherwise
```

### Where verbosity is read

Each adapter reads `displayVerbosity` from its channel config **once** at startup and stores it as `this.verbosity`. It flows through a single path:

```
adapter.verbosity (from config)
  → dispatchMessage(handlers, ctx, msg, this.verbosity)   // filtering
  → handler calls formatOutgoingMessage(msg, this.verbosity) // detail control
  → handler calls formatToolCall(tool, this.verbosity)       // adapter-specific
```

**No constructor injection into ToolCallTracker or ActivityTracker.** Instead, verbosity is passed as a parameter to each method call. This avoids stale state if config is reloaded mid-session, and keeps trackers stateless with respect to display preferences.

```typescript
// In adapter.ts:
private get verbosity(): DisplayVerbosity {
  return this.config.displayVerbosity ?? "medium";
}

// In message handlers:
onToolCall: async (ctx, content) => {
  const formatted = formatToolCall(content.metadata as ToolCallMeta, this.verbosity);
  // ...
}
```

## File Changes

### New/Modified in `src/adapters/shared/`

| File | Change |
|---|---|
| `format-types.ts` | Add `DisplayVerbosity`, `NoiseAction`, `NoiseRule` types, add `viewerLinks` to `FormattedMessage` |
| `message-formatter.ts` | `formatOutgoingMessage(msg, verbosity)` — verbosity-aware detail + noise filtering |
| `message-formatter.ts` | `formatToolSummary(name, rawInput, displaySummary?)` — check agent summary first |
| `message-formatter.ts` | **NEW** `formatToolTitle(name, rawInput, displayTitle?)` — title-only extraction for `low` verbosity |
| `message-formatter.ts` | **NEW** `evaluateNoise(name, kind, rawInput)` — noise rule evaluation |
| `message-dispatcher.ts` | Add `verbosity` param to `dispatchMessage()`, add `shouldDispatch()` early-exit |

### Modified in `src/core/`

| File | Change |
|---|---|
| `config.ts` | Add `displayVerbosity` to `BaseChannelSchema` with `.default("medium")` |
| `message-transformer.ts` | **BUG FIX:** Forward `rawInput` to metadata (was missing). Also add `meta.displaySummary`, `meta.displayTitle`, and `meta.displayKind` |

### Modified in `src/adapters/telegram/`

| File | Change |
|---|---|
| `formatting.ts` | `formatToolCall(tool, verbosity)`, `formatToolUpdate(update, verbosity)` respect level |
| `tool-call-tracker.ts` | Pass verbosity to format calls, skip detail on low |
| `activity.ts` | Skip ThinkingIndicator/PlanCard/UsageMessage on low |
| `adapter.ts` | Read `displayVerbosity` from config, pass to tracker/activity |

### Modified in `src/adapters/discord/`

| File | Change |
|---|---|
| `formatting.ts` | `formatToolCall(tool, verbosity)`, `formatToolUpdate(update, verbosity)` respect level |
| `tool-call-tracker.ts` | Pass verbosity to format calls, skip detail on low |
| `activity.ts` | Skip ThinkingIndicator/PlanCard/UsageMessage on low |
| `adapter.ts` | Read `displayVerbosity` from config, pass to tracker/activity |

### Modified in `ui/`

| File | Change |
|---|---|
| `ui/src/lib/message-renderer.ts` | `renderForWeb(msg)` already returns structured props — verbosity handled by backend |

## Backward Compatibility

- **Config**: `displayVerbosity` defaults to `"medium"` via Zod `.default()` — existing configs unchanged
- **Agents**: agents not sending `displaySummary`/`displayTitle` fall back to current `formatToolSummary`/`formatToolTitle` — zero impact
- **Output on `medium` — minor visual change**: tool calls no longer show inline truncated content; they show summary line + viewer links instead. This is cleaner but visually different from the old behavior. Users who want inline content can switch to `displayVerbosity: "high"`.
- **Noise filtering**: some tool calls that were previously shown (LS, directory reads, glob) are now hidden or collapsed. Users who want to see everything can use `displayVerbosity: "high"` which shows all noise as collapsed.
- **Plugin adapters**: read `displayVerbosity` from channel config if they want, or ignore it (defaults to `"medium"` behavior)

## Testing Strategy

### Unit tests

**MessageTransformer:**
- `rawInput` is forwarded in metadata for tool_call and tool_update events
- `displaySummary`, `displayTitle`, and `displayKind` forwarded from `_meta`

**formatToolSummary:**
- With `displaySummary` param: uses it when present, falls back when absent
- Without `displaySummary`: uses `rawInput` for smart summary (Read, Bash, Grep, etc.)
- Edge: `displaySummary` is empty string → fallback
- Edge: `displaySummary` is non-string → fallback
- Edge: `rawInput` is undefined → graceful fallback to `🔧 {name}`

**formatToolTitle (NEW):**
- With `displayTitle` param: uses it when present, falls back when absent
- Read tool → returns file path only: `"src/main.ts"`
- Bash tool → returns command: `"pnpm test"`
- Grep tool → returns pattern + path: `"\"TODO\" in src/"`
- Unknown tool → returns tool name as-is
- rawInput undefined → returns tool name
- Edge: `displayTitle` is empty string → fallback
- Edge: `displayTitle` is non-string → fallback

**formatOutgoingMessage (verbosity):**
- `low` tool_call: uses `formatToolTitle`, no detail, viewerLinks present
- `medium` tool_call: uses `formatToolSummary`, no detail, viewerLinks present
- `high` tool_call: uses `formatToolSummary`, full detail, viewerLinks present
- Viewer links always in output when metadata has viewerLinks (all 3 levels)

**Noise filtering (evaluateNoise):**
- `ls` tool → returns `"hide"` (first-match-wins, regardless of kind)
- Directory path ending with `/` + kind `"read"` → returns `"hide"`
- `glob` tool → returns `"collapse"`
- Normal Read/Edit/Bash → returns `null` (show normally)
- File without extension (`Makefile`, `.gitignore`) → returns `null` (NOT treated as directory)
- Hidden noise + `low`/`medium` → `formatOutgoingMessage` returns null
- Hidden noise + `high` → `formatOutgoingMessage` returns collapsed (title only)
- Collapsed noise + `low` → returns null
- Collapsed noise + `medium` → returns minimal (status icon + kind icon only)
- Collapsed noise + `high` → returns full summary

**Dispatcher:**
- `shouldDispatch`: returns false for thought/plan/usage on `low`, true otherwise
- `dispatchMessage` with verbosity `low`: handler NOT called for hidden types

### Integration tests

- Config with `displayVerbosity: "low"` → thoughts/plans/usage never dispatched; tool calls show title only + viewer links
- Config with `displayVerbosity: "medium"` → tool calls show full summary + viewer links, no inline content
- Config with `displayVerbosity: "high"` → tool calls show summary + full content + viewer links
- Config without `displayVerbosity` → defaults to `"medium"` (no regression)
- Agent with `_meta.displaySummary` + `_meta.displayTitle` → summary used on medium/high, title used on low
- Agent with `_meta.displaySummary` but no `_meta.displayTitle` → `formatToolTitle` fallback on low
- Agent LS/directory read → hidden on low/medium, collapsed on high
- Viewer links present in output at ALL verbosity levels for tool calls with tunnel data

## Implementation Order

```
1. Add DisplayVerbosity type + NoiseRule interface to format-types.ts
2. Add viewerLinks to FormattedMessage interface
3. Add displayVerbosity to config schema (BaseChannelSchema)
4. Fix rawInput forwarding + add displaySummary/displayTitle/displayKind in MessageTransformer
5. Update formatToolSummary to accept displaySummary param
6. Add formatToolTitle() for low-verbosity title extraction
7. Add evaluateNoise() for noise rule evaluation
8. Update formatOutgoingMessage: verbosity-aware (title/summary/full) + noise filtering + viewerLinks
9. Add shouldDispatch() + verbosity param to dispatchMessage()
10. Update Telegram adapter: read verbosity, pass to format calls, always render viewerLinks
11. Update Discord adapter: read verbosity, pass to format calls, always render viewerLinks
12. Tests for all changes (unit + integration per testing strategy)
```

> **Step 4 is a bug fix** that unblocks smart tool summaries for ALL agents, independent of the
> verbosity feature. It can be shipped separately as a patch if needed.
>
> **Steps 6-7 are new functions** that can be developed and tested in isolation before wiring
> into `formatOutgoingMessage` in step 8.
