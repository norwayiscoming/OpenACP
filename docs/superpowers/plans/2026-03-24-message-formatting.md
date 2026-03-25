# Message Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unified message formatting across all adapters — shared formatter (OutgoingMessage → FormattedMessage) + per-adapter renderers, with smart tool call summaries.

**Architecture:** 2-layer design. Layer 1: shared `formatOutgoingMessage()` produces platform-agnostic `FormattedMessage`. Layer 2: per-adapter renderers convert to native output (HTML/markdown). Extract duplicated utilities from Telegram/Discord into shared modules.

**Tech Stack:** TypeScript, Vitest, existing adapter infrastructure

**Spec:** `docs/superpowers/specs/2026-03-24-message-formatting-design.md`

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `src/adapters/shared/format-types.ts` | `FormattedMessage`, `MessageRenderer<T>`, `MessageStyle`, `MessageMetadata` interfaces + icon constant maps |
| `src/adapters/shared/format-utils.ts` | `progressBar()`, `formatTokens()`, `splitMessage()`, `truncateContent()` |
| `src/adapters/shared/message-formatter.ts` | `formatOutgoingMessage()`, `formatToolSummary()`, `extractContentText()` |
| `src/adapters/shared/message-formatter.test.ts` | Unit tests for formatter + tool summaries |
| `src/adapters/shared/format-utils.test.ts` | Unit tests for shared utilities |

### Modified Files
| File | Change |
|---|---|
| `src/core/message-transformer.ts:21-30,33-41` | Add `rawInput` to tool_call/tool_update metadata |
| `src/adapters/telegram/formatting.ts` | Import shared types/utils, implement `TelegramRenderer`, remove duplicated functions |
| `src/adapters/discord/formatting.ts` | Import shared types/utils, implement `DiscordRenderer`, remove duplicated functions |

---

## Task 1: Shared Types & Icon Constants

**Files:**
- Create: `src/adapters/shared/format-types.ts`

- [ ] **Step 1: Create format-types.ts with interfaces and icon maps**

```typescript
// src/adapters/shared/format-types.ts
import type { OutgoingMessage } from "../../core/index.js";

export type MessageStyle = "text" | "thought" | "tool" | "plan" | "usage" | "system" | "error" | "attachment";

export interface MessageMetadata {
  toolName?: string;
  toolStatus?: string;
  toolKind?: string;
  filePath?: string;
  command?: string;
  planEntries?: { content: string; status: string }[];
  tokens?: number;
  contextSize?: number;
  cost?: number;
  viewerLinks?: { type: "file" | "diff"; url: string; label: string }[];
}

export interface FormattedMessage {
  summary: string;
  detail?: string;
  icon: string;
  originalType: string;
  style: MessageStyle;
  metadata?: MessageMetadata;
}

export interface MessageRenderer<T = string> {
  render(msg: FormattedMessage, expanded: boolean): T;
  renderFull(msg: FormattedMessage): T;
}

export const STATUS_ICONS: Record<string, string> = {
  pending: "⏳",
  in_progress: "🔄",
  completed: "✅",
  failed: "❌",
  cancelled: "🚫",
  running: "🔄",
  done: "✅",
  error: "❌",
};

export const KIND_ICONS: Record<string, string> = {
  read: "📖",
  edit: "✏️",
  write: "✏️",
  delete: "🗑️",
  execute: "▶️",
  command: "▶️",
  bash: "▶️",
  search: "🔍",
  web: "🌐",
  fetch: "🌐",
  agent: "🧠",
  think: "🧠",
  install: "📦",
  move: "📦",
  other: "🛠️",
};

export const MESSAGE_ICONS: Record<string, string> = {
  thought: "💭",
  plan: "📋",
  usage: "📊",
  error: "❌",
  session_end_completed: "✅",
  session_end_error: "❌",
  system_message: "ℹ️",
  attachment: "📎",
};
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/adapters/shared/format-types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/adapters/shared/format-types.ts
git commit -m "feat(formatting): add shared FormattedMessage types and icon constants"
```

---

## Task 2: Shared Utilities (Extract from Telegram/Discord)

**Files:**
- Create: `src/adapters/shared/format-utils.ts`
- Create: `src/adapters/shared/format-utils.test.ts`

- [ ] **Step 1: Write failing tests for shared utilities**

```typescript
// src/adapters/shared/format-utils.test.ts
import { describe, it, expect } from "vitest";
import { progressBar, formatTokens, truncateContent, splitMessage } from "./format-utils.js";

describe("progressBar", () => {
  it("renders progress bar at 0.5 ratio", () => {
    const bar = progressBar(0.5);
    expect(bar).toContain("▓");
    expect(bar).toContain("░");
    expect(bar.length).toBe(10);
  });

  it("renders full bar at ratio 1", () => {
    const bar = progressBar(1);
    expect(bar).toBe("▓▓▓▓▓▓▓▓▓▓");
  });

  it("renders empty bar at ratio 0", () => {
    const bar = progressBar(0);
    expect(bar).toBe("░░░░░░░░░░");
  });
});

describe("formatTokens", () => {
  it("formats thousands with k suffix (rounded)", () => {
    expect(formatTokens(12345)).toBe("12k");
    expect(formatTokens(28000)).toBe("28k");
  });

  it("formats small numbers without suffix", () => {
    expect(formatTokens(500)).toBe("500");
  });
});

describe("truncateContent", () => {
  it("returns text unchanged if under limit", () => {
    expect(truncateContent("short", 100)).toBe("short");
  });

  it("truncates with newline before indicator", () => {
    const long = "a".repeat(200);
    const result = truncateContent(long, 50);
    expect(result).toContain("\n… (truncated)");
    expect(result.startsWith("a".repeat(50))).toBe(true);
  });
});

describe("splitMessage", () => {
  it("returns single chunk for short text", () => {
    const chunks = splitMessage("hello", 100);
    expect(chunks).toEqual(["hello"]);
  });

  it("splits at paragraph boundary", () => {
    const text = "paragraph one\n\nparagraph two";
    const chunks = splitMessage(text, 20);
    expect(chunks.length).toBe(2);
  });

  it("does not split inside code blocks", () => {
    const before = "a".repeat(100);
    const code = "```\n" + "code line\n".repeat(20) + "```";
    const after = "b".repeat(50);
    const text = `${before}\n\n${code}\n\n${after}`;
    const chunks = splitMessage(text, 200);
    // Each chunk should have even number of ``` markers (not split inside code block)
    for (const chunk of chunks) {
      const backtickCount = (chunk.match(/```/g) ?? []).length;
      expect(backtickCount % 2).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/adapters/shared/format-utils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement format-utils.ts**

Extract from `src/adapters/telegram/formatting.ts` (lines 100-103, 151-158, 209-251):

```typescript
// src/adapters/shared/format-utils.ts

export function progressBar(ratio: number, length = 10): string {
  const filled = Math.round(Math.min(ratio, 1) * length);
  return "▓".repeat(filled) + "░".repeat(length - filled);
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function truncateContent(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n… (truncated)";
}

// splitMessage: Copy the EXACT implementation from src/adapters/telegram/formatting.ts lines 209-251
// (or discord/formatting.ts lines 123-164 — both are nearly identical).
// Key behaviors to preserve:
// - "wouldLeaveSmall" balanced splitting heuristic (split in half if remainder < 20% of maxLen)
// - Code fence handling: search FORWARD for closing ``` if chunk has odd fence count
// - Paragraph boundary preference (\n\n), then newline (\n), then hard cut
// Only change: remove the hardcoded default maxLen parameter — require explicit value.
export function splitMessage(text: string, maxLen: number): string[]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/adapters/shared/format-utils.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/shared/format-utils.ts src/adapters/shared/format-utils.test.ts
git commit -m "feat(formatting): extract shared utilities (progressBar, formatTokens, splitMessage, truncateContent)"
```

---

## Task 3: Add rawInput to MessageTransformer Metadata

**Files:**
- Modify: `src/core/message-transformer.ts:21-30,33-41`

- [ ] **Step 1: Read current message-transformer.ts and identify exact lines**

Read `src/core/message-transformer.ts` — find the `tool_call` and `tool_update` metadata objects (around lines 20-41).

- [ ] **Step 2: Add rawInput to tool_call metadata**

In the `tool_call` case (around line 21-30), add `rawInput: event.rawInput` to the metadata object:

```typescript
// Before:
const metadata = { id, name, kind, status, content, locations };
// After:
const metadata = { id, name, kind, status, content, locations, rawInput: event.rawInput };
```

- [ ] **Step 3: Add rawInput to tool_update metadata**

In the `tool_update` case (around line 33-41), add `rawInput: event.rawInput`:

```typescript
// Before:
const metadata = { id, name, kind, status, content };
// After:
const metadata = { id, name, kind, status, content, rawInput: event.rawInput };
```

- [ ] **Step 4: Run existing tests to verify no regression**

Run: `pnpm test src/core/__tests__/`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/message-transformer.ts
git commit -m "feat(formatting): forward rawInput in tool_call/tool_update metadata for smart summaries"
```

---

## Task 4: Shared Message Formatter

**Files:**
- Create: `src/adapters/shared/message-formatter.ts`
- Create: `src/adapters/shared/message-formatter.test.ts`

- [ ] **Step 1: Write failing tests for extractContentText**

```typescript
// src/adapters/shared/message-formatter.test.ts
import { describe, it, expect } from "vitest";
import { extractContentText, formatToolSummary, formatOutgoingMessage } from "./message-formatter.js";

describe("extractContentText", () => {
  it("returns string content as-is", () => {
    expect(extractContentText("hello")).toBe("hello");
  });

  it("extracts text from ACP content block", () => {
    const block = { type: "text", text: "hello world" };
    expect(extractContentText(block)).toBe("hello world");
  });

  it("handles nested content arrays", () => {
    const block = { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] };
    expect(extractContentText(block)).toContain("a");
    expect(extractContentText(block)).toContain("b");
  });

  it("returns empty string for null/undefined", () => {
    expect(extractContentText(null)).toBe("");
    expect(extractContentText(undefined)).toBe("");
  });

  it("handles top-level array of content blocks", () => {
    const arr = [{ type: "text", text: "hello" }, { type: "text", text: "world" }];
    expect(extractContentText(arr)).toBe("hello\nworld");
  });
});
```

- [ ] **Step 2: Write failing tests for formatToolSummary**

```typescript
describe("formatToolSummary", () => {
  it("summarizes Read tool", () => {
    const raw = JSON.stringify({ file_path: "src/main.ts", limit: 50 });
    expect(formatToolSummary("Read", raw)).toBe("📖 Read src/main.ts (50 lines)");
  });

  it("summarizes Bash tool", () => {
    const raw = JSON.stringify({ command: "pnpm test" });
    expect(formatToolSummary("Bash", raw)).toBe("▶️ Run: pnpm test");
  });

  it("summarizes Edit tool", () => {
    const raw = JSON.stringify({ file_path: "src/app.ts" });
    expect(formatToolSummary("Edit", raw)).toBe("✏️ Edit src/app.ts");
  });

  it("summarizes Write tool", () => {
    const raw = JSON.stringify({ file_path: "new-file.ts" });
    expect(formatToolSummary("Write", raw)).toBe("✏️ Write new-file.ts");
  });

  it("summarizes Grep tool", () => {
    const raw = JSON.stringify({ pattern: "TODO", path: "src/" });
    expect(formatToolSummary("Grep", raw)).toBe('🔍 Grep "TODO" in src/');
  });

  it("summarizes Agent tool", () => {
    const raw = JSON.stringify({ description: "Search codebase" });
    expect(formatToolSummary("Agent", raw)).toBe("🧠 Agent: Search codebase");
  });

  it("summarizes Glob tool", () => {
    const raw = JSON.stringify({ pattern: "**/*.ts" });
    expect(formatToolSummary("Glob", raw)).toBe("🔍 Glob **/*.ts");
  });

  it("summarizes WebFetch tool", () => {
    const raw = JSON.stringify({ url: "https://api.example.com" });
    expect(formatToolSummary("WebFetch", raw)).toBe("🌐 Fetch https://api.example.com");
  });

  it("summarizes WebSearch tool", () => {
    const raw = JSON.stringify({ query: "react markdown" });
    expect(formatToolSummary("WebSearch", raw)).toBe('🌐 Search "react markdown"');
  });

  it("falls back for unknown tools", () => {
    expect(formatToolSummary("CustomTool", "{}")).toBe("🔧 CustomTool");
  });

  it("handles non-JSON content gracefully", () => {
    expect(formatToolSummary("Read", "some raw text")).toBe("🔧 Read");
  });
});
```

- [ ] **Step 3: Write failing tests for formatOutgoingMessage**

```typescript
describe("formatOutgoingMessage", () => {
  it("formats text message", () => {
    const msg = { type: "text" as const, text: "Hello world" };
    const result = formatOutgoingMessage(msg);
    expect(result.style).toBe("text");
    expect(result.summary).toBe("Hello world");
    expect(result.originalType).toBe("text");
  });

  it("formats thought message", () => {
    const msg = { type: "thought" as const, text: "Thinking about the problem..." };
    const result = formatOutgoingMessage(msg);
    expect(result.style).toBe("thought");
    expect(result.icon).toBe("💭");
    expect(result.summary.length).toBeLessThanOrEqual(83); // 80 + "..."
  });

  it("formats tool_call message with smart summary", () => {
    const msg = {
      type: "tool_call" as const,
      text: "Read",
      metadata: { name: "Read", status: "in_progress", rawInput: JSON.stringify({ file_path: "src/main.ts" }) },
    };
    const result = formatOutgoingMessage(msg);
    expect(result.style).toBe("tool");
    expect(result.originalType).toBe("tool_call");
    expect(result.summary).toContain("src/main.ts");
    expect(result.icon).toContain("📖");
  });

  it("formats plan message", () => {
    const msg = {
      type: "plan" as const,
      text: "",
      metadata: { entries: [{ content: "Step 1", status: "completed" }, { content: "Step 2", status: "pending" }] },
    };
    const result = formatOutgoingMessage(msg);
    expect(result.style).toBe("plan");
    expect(result.summary).toContain("2 steps");
  });

  it("formats usage message", () => {
    const msg = {
      type: "usage" as const,
      text: "",
      metadata: { tokensUsed: 12345, contextSize: 50000, cost: { amount: 0.04, currency: "USD" } },
    };
    const result = formatOutgoingMessage(msg);
    expect(result.style).toBe("usage");
    expect(result.summary).toContain("12k");
    expect(result.summary).toContain("$0.04");
  });

  it("formats error message", () => {
    const msg = { type: "error" as const, text: "Something went wrong" };
    const result = formatOutgoingMessage(msg);
    expect(result.style).toBe("error");
    expect(result.icon).toBe("❌");
  });

  it("formats session_end message", () => {
    const msg = { type: "session_end" as const, text: "completed" };
    const result = formatOutgoingMessage(msg);
    expect(result.style).toBe("system");
    expect(result.originalType).toBe("session_end");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test src/adapters/shared/message-formatter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement message-formatter.ts**

```typescript
// src/adapters/shared/message-formatter.ts
import type { OutgoingMessage } from "../../core/index.js";
import type { FormattedMessage, MessageMetadata } from "./format-types.js";
import { STATUS_ICONS, KIND_ICONS, MESSAGE_ICONS } from "./format-types.js";
import { formatTokens } from "./format-utils.js";

export function extractContentText(content: unknown, depth = 0): string {
  if (!content || depth > 5) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => extractContentText(c, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof content !== "object") return String(content);

  const obj = content as Record<string, unknown>;

  if (obj.text && typeof obj.text === "string") return obj.text;
  if (obj.content) {
    if (typeof obj.content === "string") return obj.content;
    if (Array.isArray(obj.content)) {
      return obj.content.map((c) => extractContentText(c, depth + 1)).filter(Boolean).join("\n");
    }
    return extractContentText(obj.content, depth + 1);
  }
  if (obj.input && typeof obj.input === "string") return obj.input;
  if (obj.output && typeof obj.output === "string") return obj.output;
  return "";
}

export function formatToolSummary(name: string, rawInput: unknown): string {
  let args: Record<string, unknown> = {};
  try {
    if (typeof rawInput === "string") {
      args = JSON.parse(rawInput);
    } else if (typeof rawInput === "object" && rawInput !== null) {
      args = rawInput as Record<string, unknown>;
    }
  } catch {
    return `🔧 ${name}`;
  }

  const lowerName = name.toLowerCase();

  if (lowerName === "read") {
    const fp = args.file_path ?? args.filePath ?? "";
    const limit = args.limit ? ` (${args.limit} lines)` : "";
    return fp ? `📖 Read ${fp}${limit}` : `🔧 ${name}`;
  }
  if (lowerName === "edit") {
    const fp = args.file_path ?? args.filePath ?? "";
    return fp ? `✏️ Edit ${fp}` : `🔧 ${name}`;
  }
  if (lowerName === "write") {
    const fp = args.file_path ?? args.filePath ?? "";
    return fp ? `✏️ Write ${fp}` : `🔧 ${name}`;
  }
  if (lowerName === "bash") {
    const cmd = String(args.command ?? "").slice(0, 60);
    return cmd ? `▶️ Run: ${cmd}` : `🔧 ${name}`;
  }
  if (lowerName === "grep") {
    const pattern = args.pattern ?? "";
    const path = args.path ?? "";
    return pattern ? `🔍 Grep "${pattern}"${path ? ` in ${path}` : ""}` : `🔧 ${name}`;
  }
  if (lowerName === "glob") {
    const pattern = args.pattern ?? "";
    return pattern ? `🔍 Glob ${pattern}` : `🔧 ${name}`;
  }
  if (lowerName === "agent") {
    const desc = String(args.description ?? "").slice(0, 60);
    return desc ? `🧠 Agent: ${desc}` : `🔧 ${name}`;
  }
  if (lowerName === "webfetch" || lowerName === "web_fetch") {
    const url = String(args.url ?? "").slice(0, 60);
    return url ? `🌐 Fetch ${url}` : `🔧 ${name}`;
  }
  if (lowerName === "websearch" || lowerName === "web_search") {
    const query = String(args.query ?? "").slice(0, 60);
    return query ? `🌐 Search "${query}"` : `🔧 ${name}`;
  }

  return `🔧 ${name}`;
}

export function formatOutgoingMessage(msg: OutgoingMessage): FormattedMessage {
  const meta = (msg.metadata ?? {}) as Record<string, unknown>;

  switch (msg.type) {
    case "text":
      return { summary: msg.text, icon: "", originalType: "text", style: "text" };

    case "thought": {
      const full = msg.text;
      const summary = full.length > 80 ? full.slice(0, 80) + "..." : full;
      return { summary, detail: full.length > 80 ? full : undefined, icon: "💭", originalType: "thought", style: "thought" };
    }

    case "tool_call": {
      const name = String(meta.name ?? msg.text ?? "Tool");
      const kind = String(meta.kind ?? "other");
      const status = String(meta.status ?? "pending");
      const rawInput = meta.rawInput;
      const summary = formatToolSummary(name, rawInput);
      const statusIcon = STATUS_ICONS[status] ?? "⏳";
      const detail = extractContentText(meta.content);
      return {
        summary: `${statusIcon} ${summary}`,
        detail: detail || undefined,
        icon: KIND_ICONS[kind] ?? "🔧",
        originalType: "tool_call",
        style: "tool",
        metadata: { toolName: name, toolStatus: status, toolKind: kind },
      };
    }

    case "tool_update": {
      const name = String(meta.name ?? msg.text ?? "Tool");
      const kind = String(meta.kind ?? "other");
      const status = String(meta.status ?? "completed");
      const rawInput = meta.rawInput;
      const summary = formatToolSummary(name, rawInput);
      const statusIcon = STATUS_ICONS[status] ?? "✅";
      const detail = extractContentText(meta.content);
      return {
        summary: `${statusIcon} ${summary}`,
        detail: detail || undefined,
        icon: KIND_ICONS[kind] ?? "🔧",
        originalType: "tool_update",
        style: "tool",
        metadata: { toolName: name, toolStatus: status, toolKind: kind },
      };
    }

    case "plan": {
      const entries = (meta.entries ?? []) as { content: string; status: string }[];
      const summary = `📋 Plan: ${entries.length} steps`;
      return {
        summary,
        icon: "📋",
        originalType: "plan",
        style: "plan",
        metadata: { planEntries: entries },
      };
    }

    case "usage": {
      const tokens = Number(meta.tokensUsed ?? 0);
      // cost may be { amount, currency } object or number
      const costObj = meta.cost as { amount?: number; currency?: string } | number | undefined;
      const costAmount = typeof costObj === "number" ? costObj : (costObj?.amount ?? 0);
      const summary = `📊 ${formatTokens(tokens)} tokens${costAmount ? ` · $${costAmount.toFixed(2)}` : ""}`;
      return {
        summary,
        icon: "📊",
        originalType: "usage",
        style: "usage",
        metadata: { tokens, contextSize: Number(meta.contextSize ?? 0), cost: costAmount },
      };
    }

    case "error":
      return {
        summary: msg.text.length > 120 ? msg.text.slice(0, 120) + "..." : msg.text,
        detail: msg.text.length > 120 ? msg.text : undefined,
        icon: "❌",
        originalType: "error",
        style: "error",
      };

    case "session_end":
      return {
        summary: `Session ${msg.text}`,
        icon: msg.text === "completed" ? "✅" : "❌",
        originalType: "session_end",
        style: "system",
      };

    case "system_message":
      return { summary: msg.text, icon: "ℹ️", originalType: "system_message", style: "system" };

    case "attachment":
      return { summary: msg.text || "File", icon: "📎", originalType: "attachment", style: "attachment" };

    default:
      return { summary: msg.text || "", icon: "", originalType: msg.type, style: "text" };
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test src/adapters/shared/message-formatter.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/adapters/shared/message-formatter.ts src/adapters/shared/message-formatter.test.ts
git commit -m "feat(formatting): implement shared message formatter with smart tool summaries"
```

---

## Task 5: Refactor Discord Adapter Formatting

**Files:**
- Modify: `src/adapters/discord/formatting.ts`

- [ ] **Step 1: Read current discord formatting.ts**

Read `src/adapters/discord/formatting.ts` fully. Note all exported functions used by the adapter.

- [ ] **Step 2: Replace duplicated utilities with shared imports**

Remove local `extractContentText`, `truncateContent`, `progressBar`, `formatTokens`, `splitMessage`, `STATUS_ICON`, `KIND_ICON`. Import from shared:

```typescript
import { extractContentText, formatOutgoingMessage } from "../shared/message-formatter.js";
import { STATUS_ICONS, KIND_ICONS, type FormattedMessage, type MessageRenderer } from "../shared/format-types.js";
import { progressBar, formatTokens, truncateContent, splitMessage } from "../shared/format-utils.js";
```

- [ ] **Step 3: Implement DiscordRenderer**

Add renderer class that uses shared `FormattedMessage`:

```typescript
export const discordRenderer: MessageRenderer = {
  render(msg: FormattedMessage, _expanded: boolean): string {
    if (msg.style === "tool") {
      const detail = msg.detail ? `\n\`\`\`\n${truncateContent(msg.detail, 500)}\n\`\`\`` : "";
      return `${msg.summary}${detail}`;
    }
    if (msg.style === "thought") {
      return `💭 _${msg.summary}_`;
    }
    return msg.summary;
  },

  renderFull(msg: FormattedMessage): string {
    return msg.summary;
  },
};
```

- [ ] **Step 4: Keep existing exported functions working**

Existing `formatToolCall`, `formatToolUpdate`, `formatPlan`, `formatUsage` are called by the adapter. Refactor them to use shared formatter internally but keep the same export signatures to avoid breaking the adapter. Update internals only.

- [ ] **Step 5: Run ALL tests to verify no regression**

Run: `pnpm test`
Expected: All tests PASS (including existing discord formatting tests at `src/adapters/discord/formatting.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add src/adapters/discord/formatting.ts
git commit -m "refactor(discord): use shared formatter and utilities, implement DiscordRenderer"
```

---

## Task 6: Refactor Telegram Adapter Formatting

**Files:**
- Modify: `src/adapters/telegram/formatting.ts`

- [ ] **Step 1: Read current telegram formatting.ts**

Read `src/adapters/telegram/formatting.ts` fully. Note all exported functions and their callers. Important: Telegram uses HTML output, not markdown.

- [ ] **Step 2: Replace duplicated utilities with shared imports**

Same as Discord — remove local duplicates, import from shared. Keep `formatMarkdown()` (Telegram-specific MD→HTML), `formatUsageReport()` (Telegram-specific), and `escapeHtml()` local.

```typescript
import { extractContentText, formatOutgoingMessage } from "../shared/message-formatter.js";
import { STATUS_ICONS, KIND_ICONS, type FormattedMessage, type MessageRenderer } from "../shared/format-types.js";
import { progressBar, formatTokens, truncateContent, splitMessage } from "../shared/format-utils.js";
```

- [ ] **Step 3: Implement TelegramRenderer**

```typescript
export const telegramRenderer: MessageRenderer = {
  render(msg: FormattedMessage, _expanded: boolean): string {
    if (msg.style === "tool") {
      const detail = msg.detail ? `\n<pre>${escapeHtml(truncateContent(msg.detail, 3800))}</pre>` : "";
      return `${escapeHtml(msg.summary)}${detail}`;
    }
    if (msg.style === "thought") {
      return `💭 <i>${escapeHtml(msg.summary)}</i>`;
    }
    return escapeHtml(msg.summary);
  },

  renderFull(msg: FormattedMessage): string {
    return msg.summary; // Text messages are pre-formatted
  },
};
```

- [ ] **Step 4: Refactor exported format functions to use shared internals**

Same approach as Discord — keep function signatures, update internals to use shared formatter. Keep `formatUsageReport()` as-is (Telegram-only).

- [ ] **Step 5: Run ALL tests to verify no regression**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/telegram/formatting.ts
git commit -m "refactor(telegram): use shared formatter and utilities, implement TelegramRenderer"
```

---

## Task 7: Wire Formatter into Adapter Dispatch

**Files:**
- Modify: `src/adapters/discord/adapter.ts`
- Modify: `src/adapters/telegram/adapter.ts`

The shared formatter and renderers are implemented but not yet called from the adapters. Wire the formatter → renderer pipeline into the `MessageHandlers` methods.

- [ ] **Step 1: Read Discord adapter.ts — find onToolCall, onPlan, onUsage handlers**

Identify where `formatToolCall()`, `formatPlan()`, `formatUsage()` are called in the dispatch handlers.

- [ ] **Step 2: Update Discord handlers to use shared formatter**

In each handler, replace direct formatting calls with:
```typescript
const formatted = formatOutgoingMessage(content);
const output = discordRenderer.render(formatted, false);
```

Keep the existing send/edit logic — only change how the text is produced.

- [ ] **Step 3: Update Telegram handlers similarly**

Same approach — replace internal formatting calls with shared formatter + telegramRenderer.

- [ ] **Step 4: Run ALL tests**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/discord/adapter.ts src/adapters/telegram/adapter.ts
git commit -m "feat(formatting): wire shared formatter into adapter dispatch pipeline"
```

---

## Task 8: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Verify all shared modules use .js extensions in imports**

Check that `format-types.ts`, `format-utils.ts`, and `message-formatter.ts` use `.js` extensions in imports (ESM requirement from CLAUDE.md).

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add src/adapters/shared/format-types.ts src/adapters/shared/format-utils.ts src/adapters/shared/message-formatter.ts
git commit -m "chore(formatting): final verification and cleanup"
```
