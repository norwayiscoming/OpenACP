# Slack Channel Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a full Slack channel adapter so OpenACP users can interact with AI agents via Slack workspaces, with zero impact on existing Telegram adapter and core modules.

**Architecture:** SOLID — 7 focused classes injected into a thin `SlackAdapter` orchestrator. Channel-per-session threading. Socket Mode event delivery via `@slack/bolt`.

**Tech Stack:** TypeScript ESM, `@slack/bolt`, `p-queue`, `nanoid`

**Spec:** `docs/superpowers/specs/2026-03-23-slack-adapter-design.md`

---

## File Structure


| File                                       | Action        | Responsibility                                     |
| ------------------------------------------ | ------------- | -------------------------------------------------- |
| `src/adapters/slack/types.ts`              | **New**       | `SlackChannelConfig`, `SlackSessionMeta`           |
| `src/adapters/slack/slug.ts`               | **New**       | Channel name slugifier                             |
| `src/adapters/slack/formatter.ts`          | **New**       | `ISlackFormatter` + Block Kit impl                 |
| `src/adapters/slack/send-queue.ts`         | **New**       | `ISlackSendQueue` + per-method rate limiter        |
| `src/adapters/slack/channel-manager.ts`    | **New**       | `ISlackChannelManager` + Slack API CRUD            |
| `src/adapters/slack/permission-handler.ts` | **New**       | Interactive components (buttons)                   |
| `src/adapters/slack/event-router.ts`       | **New**       | Bolt events → `core.handleMessage`                 |
| `src/adapters/slack/adapter.ts`            | **New**       | `SlackAdapter extends ChannelAdapter` (~200 lines) |
| `src/core/config.ts`                       | **Minor**     | +`SlackChannelConfigSchema` (~25 lines)            |
| `src/main.ts`                              | **Minor**     | +Slack registration block (~25 lines)              |
| `src/adapters/telegram/`                   | **No change** |                                                    |
| `src/core/core.ts`                         | **No change** |                                                    |
| `src/core/session.ts`                      | **No change** |                                                    |
| `src/core/channel.ts`                      | **No change** |                                                    |
| `src/adapters/slack/__tests__/event-router.test.ts` | **New (R2)** | EventRouter unit tests              |
| `src/adapters/slack/__tests__/permission-handler.test.ts` | **New (R2)** | PermissionHandler unit tests   |
| `src/adapters/slack/__tests__/channel-manager.test.ts` | **New (R2)** | ChannelManager retry test        |


---

## Task 1: Install dependency + Config schema

**Files:**

- Modify: `package.json` (via pnpm)
- Modify: `src/core/config.ts`
- **Step 1: Install @slack/bolt and p-queue**

```bash
pnpm add @slack/bolt p-queue
```

Expected: Both appear in `package.json` dependencies.

- **Step 2: Add SlackChannelConfigSchema to config.ts**

In `src/core/config.ts`, find the existing channel config schemas and add `SlackChannelConfigSchema` alongside them. Add before the main `ConfigSchema`:

```typescript
const SlackChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  adapter: z.literal("slack").optional(),
  botToken: z.string().optional(),           // xoxb-...
  appToken: z.string().optional(),           // xapp-... (Socket Mode)
  signingSecret: z.string().optional(),
  notificationChannelId: z.string().optional(),
  allowedUserIds: z.array(z.string()).default([]),
  channelPrefix: z.string().default("openacp"),
});

export type SlackChannelConfig = z.infer<typeof SlackChannelConfigSchema>;
```

- **Step 3: Register in channels union**

Find where the `channels` field is defined in `ConfigSchema` and add the Slack case. Keep all existing entries — additive only:

```typescript
// Inside ConfigSchema, channels field:
slack: SlackChannelConfigSchema.optional(),
```

- **Step 4: Build and verify no type errors**

```bash
pnpm build
```

Expected: Compiles successfully. `SlackChannelConfig` is now exported from config.ts.

- **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/core/config.ts
git commit -m "feat(slack): add @slack/bolt dependency and SlackChannelConfig schema"
```

---

## Task 2: Types + Slug utility

**Files:**

- New: `src/adapters/slack/types.ts`
- New: `src/adapters/slack/slug.ts`
- **Step 1: Create types.ts**

```typescript
// src/adapters/slack/types.ts
export type { SlackChannelConfig } from "../../core/config.js";

// Per-session metadata stored in SessionRecord.platform
export interface SlackSessionMeta {
  channelId: string;     // Slack channel ID for this session (C...)
  channelSlug: string;   // e.g. "openacp-fix-auth-bug-a3k9"
}
```

- **Step 2: Create slug.ts**

```typescript
// src/adapters/slack/slug.ts
import { nanoid } from "nanoid";

/**
 * Convert a human-readable session name to a valid Slack channel name.
 * Rules: lowercase, ≤80 chars, only [a-z0-9-], unique suffix appended.
 *
 * Examples:
 *   "Fix authentication bug"            → "openacp-fix-authentication-bug-a3k9"
 *   "New Session"                       → "openacp-new-session-x7p2"
 *   "Implement OAuth 2.0 & JWT refresh" → "openacp-implement-oauth-20-jwt-refresh-b8qr"
 */
export function toSlug(name: string, prefix = "openacp"): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")   // strip special chars
    .trim()
    .replace(/\s+/g, "-")            // spaces → dashes
    .replace(/-+/g, "-")             // collapse consecutive dashes
    .slice(0, 60);                   // leave room for prefix and suffix

  const suffix = nanoid(4);
  return `${prefix}-${base}-${suffix}`.replace(/-+/g, "-");
}
```

- **Step 3: Build**

```bash
pnpm build
```

- **Step 4: Commit**

```bash
git add src/adapters/slack/types.ts src/adapters/slack/slug.ts
git commit -m "feat(slack): add SlackSessionMeta types and channel slug utility"
```

---

## Task 3: SlackFormatter + SlackTextBuffer — Block Kit + streaming buffer

**Files:**

- New: `src/adapters/slack/formatter.ts`
- New: `src/adapters/slack/text-buffer.ts`
- **Step 1: Create the ISlackFormatter interface and SlackFormatter class**

> **Note:** AI agent responses stream as many small text chunks. Posting each chunk as a separate Slack message creates a very poor UX. `SlackTextBuffer` accumulates chunks per session and flushes them as a single message after a 2-second idle timeout (or immediately on `session_end`). `markdownToMrkdwn` converts standard markdown from AI responses (headers, bold, lists, links) into Slack mrkdwn format before sending.

```typescript
// src/adapters/slack/formatter.ts
import type { Block, KnownBlock } from "@slack/bolt";
import type { OutgoingMessage, PermissionRequest } from "../../core/types.js";

export interface ISlackFormatter {
  formatOutgoing(message: OutgoingMessage): KnownBlock[];
  formatPermissionRequest(req: PermissionRequest): KnownBlock[];
  formatNotification(text: string): KnownBlock[];
  formatSessionEnd(reason?: string): KnownBlock[];
}

// Slack mrkdwn text block, max 3000 chars per section
const SECTION_LIMIT = 3000;

function section(text: string): KnownBlock {
  return { type: "section", text: { type: "mrkdwn", text: text.slice(0, SECTION_LIMIT) } };
}

function context(text: string): KnownBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

/**
 * Split text at SECTION_LIMIT boundary, never inside a fenced code block.
 */
function splitSafe(text: string, limit = SECTION_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) { chunks.push(remaining); break; }
    // Find last newline before limit
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}

export class SlackFormatter implements ISlackFormatter {
  formatOutgoing(message: OutgoingMessage): KnownBlock[] {
    switch (message.type) {
      case "text":
        return splitSafe(message.text ?? "").map(chunk => section(chunk));

      case "thought":
        return [context(`💭 _${(message.text ?? "").slice(0, 500)}`_)];

      case "tool_call": {
        const name = (message as any).metadata?.name ?? "tool";
        const input = (message as any).metadata?.input;
        const inputStr = input ? `\n\`\`\`\n${JSON.stringify(input, null, 2).slice(0, 500)}\n\`\`\`` : "";
        return [context(`🔧 \`${name}\`${inputStr}`)];
      }

      case "tool_update": {
        const name = (message as any).metadata?.name ?? "tool";
        const status = (message as any).metadata?.status ?? "done";
        const icon = status === "error" ? "❌" : "✅";
        return [context(`${icon} \`${name}\` — ${status}`)];
      }

      case "plan":
        return [
          { type: "divider" },
          section(`📋 *Plan*\n${message.text ?? ""}`),
        ];

      case "usage": {
        const meta = (message as any).metadata ?? {};
        const parts = [
          meta.input_tokens != null ? `in: ${meta.input_tokens}` : null,
          meta.output_tokens != null ? `out: ${meta.output_tokens}` : null,
          meta.cost_usd != null ? `$${Number(meta.cost_usd).toFixed(4)}` : null,
        ].filter(Boolean);
        return parts.length ? [context(`📊 ${parts.join(" · ")}`)] : [];
      }

      case "session_end":
        return this.formatSessionEnd(message.text);

      case "error":
        return [section(`⚠️ *Error:* ${message.text ?? "Unknown error"}`)];

      default:
        return [];
    }
  }

  formatPermissionRequest(req: PermissionRequest): KnownBlock[] {
    return [
      section(`🔐 *Permission Request*\n${req.description}`),
      {
        type: "actions",
        block_id: `perm_${req.id}`,
        elements: req.options.map(opt => ({
          type: "button",
          text: { type: "plain_text", text: opt.label, emoji: true },
          value: `${req.id}:${opt.id}`,
          action_id: `perm_action_${opt.id}_${req.id}`,
          style: opt.isAllow ? "primary" : "danger",
        })),
      } as KnownBlock,
    ];
  }

  formatNotification(text: string): KnownBlock[] {
    return [section(text)];
  }

  formatSessionEnd(reason?: string): KnownBlock[] {
    return [
      { type: "divider" },
      context(`✅ Session ended${reason ? ` — ${reason}` : ""}`),
    ];
  }
}
```

- **Step 2: Add `markdownToMrkdwn` converter to formatter.ts**

Converts AI markdown to Slack mrkdwn before posting:

```typescript
export function markdownToMrkdwn(text: string): string {
  return text
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")          // ## Header → *Header*
    .replace(/\*\*(.+?)\*\*/g, "*$1*")               // **bold** → *bold*
    .replace(/~~(.+?)~~/g, "~$1~")                   // ~~strike~~ → ~strike~
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>")  // [text](url) → <url|text>
    .replace(/^[ \t]*[-*]\s+/gm, "• ")              // - item → • item
    .trim();
}
```

Apply in `formatOutgoing` for `type: "text"` — skip posting if text is empty after trimming (avoids `invalid_blocks` error from Slack API).

- **Step 3: Create `src/adapters/slack/text-buffer.ts`**

```typescript
// Buffers streamed text chunks per session, flushes as a single Slack message.
export class SlackTextBuffer {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private channelId: string,
    private sessionId: string,
    private queue: ISlackSendQueue,
  ) {}

  append(text: string): void { /* accumulate + reset 2s timer */ }
  async flush(): Promise<void> { /* convert + post buffered text */ }
  destroy(): void { /* clear timer + buffer on session cleanup */ }
}
```

`SlackAdapter.sendMessage()` routes `type: "text"` through `SlackTextBuffer.append()` instead of posting immediately. On `type: "session_end"` or `type: "error"`, flush and destroy the buffer first.

- **Step 4: Build**

```bash
pnpm build
```

Expected: No type errors.

- **Step 5: Commit**

```bash
git add src/adapters/slack/formatter.ts src/adapters/slack/text-buffer.ts
git commit -m "feat(slack): add SlackFormatter with Block Kit output and SlackTextBuffer for streaming"
```

---

## Task 4: SlackSendQueue — Per-method rate limiter

**Files:**

- New: `src/adapters/slack/send-queue.ts`
- **Step 1: Create ISlackSendQueue interface and SlackSendQueue class**

Slack rate limits each API method independently by tier. `p-queue` is used to throttle each method separately.

```typescript
// src/adapters/slack/send-queue.ts
import PQueue from "p-queue";
import type { WebClient } from "@slack/web-api";

export type SlackMethod =
  | "chat.postMessage"
  | "chat.update"
  | "conversations.create"
  | "conversations.rename"
  | "conversations.archive"
  | "conversations.invite"
  | "conversations.unarchive";

// Requests per minute per method (Slack Tier definitions)
const METHOD_RPM: Record<SlackMethod, number> = {
  "chat.postMessage":      50,   // Tier 3
  "chat.update":           50,   // Tier 3
  "conversations.create":  20,   // Tier 2
  "conversations.rename":  20,   // Tier 2
  "conversations.archive": 20,   // Tier 2
  "conversations.invite":  20,   // Tier 2
  "conversations.unarchive": 20, // Tier 2
};

export interface ISlackSendQueue {
  enqueue<T = unknown>(method: SlackMethod, params: Record<string, unknown>): Promise<T>;
}

export class SlackSendQueue implements ISlackSendQueue {
  private queues = new Map<SlackMethod, PQueue>();

  constructor(private client: WebClient) {
    for (const [method, rpm] of Object.entries(METHOD_RPM) as [SlackMethod, number][]) {
      // Spread requests evenly across the minute
      this.queues.set(method, new PQueue({
        interval: Math.ceil(60_000 / rpm),
        intervalCap: 1,
        carryoverConcurrencyCount: true,
      }));
    }
  }

  async enqueue<T = unknown>(method: SlackMethod, params: Record<string, unknown>): Promise<T> {
    const queue = this.queues.get(method);
    if (!queue) throw new Error(`Unknown Slack method: ${method}`);
    return queue.add(() => this.client.apiCall(method, params) as Promise<T>);
  }
}
```

- **Step 2: Build**

```bash
pnpm build
```

- **Step 3: Commit**

```bash
git add src/adapters/slack/send-queue.ts
git commit -m "feat(slack): add SlackSendQueue with per-method rate limiting (p-queue)"
```

---

## Task 5: SlackChannelManager — Channel CRUD

**Files:**

- New: `src/adapters/slack/channel-manager.ts`
- **Step 1: Create ISlackChannelManager interface and implementation**

```typescript
// src/adapters/slack/channel-manager.ts
import type { WebClient } from "@slack/web-api";
import type { SlackChannelConfig } from "./types.js";
import type { ISlackSendQueue } from "./send-queue.js";

export interface ISlackChannelManager {
  create(slug: string): Promise<string>;               // returns channelId
  rename(channelId: string, slug: string): Promise<void>;
  archive(channelId: string): Promise<void>;
  unarchiveAndPost(channelId: string): Promise<void>;  // for lazy resume on archived channel
  getNotificationChannelId(): string;
}

export class SlackChannelManager implements ISlackChannelManager {
  constructor(
    private client: WebClient,
    private sendQueue: ISlackSendQueue,
    private config: SlackChannelConfig,
  ) {}

  async create(slug: string): Promise<string> {
    let channelId: string;
    try {
      const res = await this.sendQueue.enqueue<{ channel: { id: string } }>(
        "conversations.create",
        { name: slug, is_private: true },
      );
      channelId = res.channel.id;
    } catch (err: any) {
      // Handle name_taken — regenerate suffix and retry once
      if (err?.data?.error === "name_taken") {
        const { toSlug } = await import("./slug.js");
        const newSlug = toSlug(slug.replace(/-[a-z0-9]{4}$/, ""), this.config.channelPrefix);
        const res = await this.sendQueue.enqueue<{ channel: { id: string } }>(
          "conversations.create",
          { name: newSlug, is_private: true },
        );
        channelId = res.channel.id;
      } else {
        throw err;
      }
    }

    // Bot is automatically a member of private channels it creates — no self-join needed.
    // Invite allowedUserIds so they can access the channel (private channels are inaccessible
    // until explicitly invited — user sees a locked link they cannot open).
    const userIds = this.config.allowedUserIds ?? [];
    if (userIds.length > 0) {
      await this.sendQueue.enqueue("conversations.invite", {
        channel: channelId,
        users: userIds.join(","),
      });
    }

    return channelId;
  }

  async rename(channelId: string, slug: string): Promise<void> {
    await this.sendQueue.enqueue("conversations.rename", {
      channel: channelId,
      name: slug,
    });
  }

  async archive(channelId: string): Promise<void> {
    await this.sendQueue.enqueue("conversations.archive", { channel: channelId });
  }

  async unarchiveAndPost(channelId: string): Promise<void> {
    // Unarchive if archived — needed when lazy-resuming a finished session
    // After unarchive, bot must be re-invited (bot is removed when channel is archived)
    await this.sendQueue.enqueue("conversations.unarchive", { channel: channelId });
    await this.sendQueue.enqueue("conversations.invite", { channel: channelId, users: this.botUserId });
  }

  getNotificationChannelId(): string {
    return this.config.notificationChannelId ?? "";
  }
}
```

- **Step 2: Build**

```bash
pnpm build
```

- **Step 3: Commit**

```bash
git add src/adapters/slack/channel-manager.ts
git commit -m "feat(slack): add SlackChannelManager (create/rename/archive/join) with name_taken retry"
```

---

## Task 6: SlackPermissionHandler — Interactive buttons

**Files:**

- New: `src/adapters/slack/permission-handler.ts`
- **Step 1: Create SlackPermissionHandler**

```typescript
// src/adapters/slack/permission-handler.ts
import type { App, ButtonAction, BlockAction } from "@slack/bolt";
import type { ISlackSendQueue } from "./send-queue.js";
import type { ISlackFormatter } from "./formatter.js";
import type { PermissionRequest } from "../../core/types.js";
import { log } from "../../core/log.js";

export class SlackPermissionHandler {
  // requestId → resolve callback
  private pending = new Map<string, (optionId: string) => void>();

  constructor(
    private sendQueue: ISlackSendQueue,
    private formatter: ISlackFormatter,
  ) {}

  /**
   * Register the Bolt action handler for permission button clicks.
   * Must be called once during adapter.start() before app.start().
   */
  register(app: App): void {
    app.action(/^perm_action_/, async ({ action, ack, body, client }) => {
      await ack();

      const btn = action as ButtonAction;
      const [requestId, optionId] = btn.value.split(":");
      const resolve = this.pending.get(requestId);

      if (!resolve) {
        log.warn({ requestId }, "slack: permission response for unknown request (already resolved?)");
        return;
      }

      resolve(optionId);
      this.pending.delete(requestId);

      // Remove the action buttons from the original message (replace with status)
      const blockAction = body as BlockAction;
      if (blockAction.message && blockAction.channel) {
        try {
          const updatedBlocks = (blockAction.message.blocks ?? []).filter(
            (b: any) => b.type !== "actions",
          );
          updatedBlocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: `_Responded: ${btn.text.text}`_ }],
          });
          await client.chat.update({
            channel: blockAction.channel.id,
            ts: blockAction.message.ts!,
            blocks: updatedBlocks,
            text: "Permission response recorded",
          });
        } catch (e) {
          log.warn({ err: e }, "slack: failed to update permission message after response");
        }
      }
    });
  }

  /**
   * Send a permission request to a session channel.
   * Returns a promise that resolves when the user clicks a button.
   */
  async send(channelId: string, req: PermissionRequest): Promise<string> {
    const blocks = this.formatter.formatPermissionRequest(req);
    await this.sendQueue.enqueue("chat.postMessage", {
      channel: channelId,
      blocks,
      text: `Permission request: ${req.description}`,
    });

    return new Promise<string>(resolve => {
      this.pending.set(req.id, resolve);
    });
  }
}
```

- **Step 2: Build**

```bash
pnpm build
```

- **Step 3: Commit**

```bash
git add src/adapters/slack/permission-handler.ts
git commit -m "feat(slack): add SlackPermissionHandler with interactive button routing"
```

---

## Task 7: SlackEventRouter — Bolt events → core

**Files:**

- New: `src/adapters/slack/event-router.ts`
- **Step 1: Create SlackEventRouter**

```typescript
// src/adapters/slack/event-router.ts
import type { App } from "@slack/bolt";
import type { OpenACPCore } from "../../core/core.js";
import type { SlackChannelConfig } from "./types.js";
import { log } from "../../core/log.js";

export class SlackEventRouter {
  constructor(
    private core: OpenACPCore,
    private config: SlackChannelConfig,
  ) {}

  /**
   * Register all Bolt event listeners.
   * Called once during adapter construction, before app.start().
   */
  register(app: App): void {
    this.registerMessages(app);
    this.registerSlashCommands(app);
  }

  private registerMessages(app: App): void {
    app.message(async ({ message }) => {
      // Type guard — only handle plain messages (not edits/deletes)
      if (message.subtype != null) return;
      if (!("user" in message) || !message.user) return;
      if ("bot_id" in message && message.bot_id) return;   // ignore bot posts

      // Only handle messages in private channels (session channels)
      if (message.channel_type !== "group") return;

      if (!this.isAllowedUser(message.user)) {
        log.warn({ userId: message.user }, "slack: message from non-allowed user rejected");
        return;
      }

      const text = ("text" in message ? message.text : "") ?? "";

      await this.core.handleMessage({
        channelId: "slack",
        threadId: message.channel,
        userId: message.user,
        text,
      });
    });
  }

  private registerSlashCommands(app: App): void {
    // /openacp-new — create a new session
    app.command("/openacp-new", async ({ ack, body, respond }) => {
      await ack();
      if (!this.isAllowedUser(body.user_id)) {
        await respond({ text: "⛔ You are not authorized to use OpenACP." });
        return;
      }
      // Trigger new session via a special internal message
      await this.core.handleMessage({
        channelId: "slack",
        threadId: body.channel_id,
        userId: body.user_id,
        text: "/new",
      });
    });

    // /openacp-cancel — cancel current session in channel
    app.command("/openacp-cancel", async ({ ack, body, respond }) => {
      await ack();
      if (!this.isAllowedUser(body.user_id)) return;
      await this.core.handleMessage({
        channelId: "slack",
        threadId: body.channel_id,
        userId: body.user_id,
        text: "/cancel",
      });
    });

    // /openacp-status — current session status
    app.command("/openacp-status", async ({ ack, body, respond }) => {
      await ack();
      await this.core.handleMessage({
        channelId: "slack",
        threadId: body.channel_id,
        userId: body.user_id,
        text: "/status",
      });
    });
  }

  private isAllowedUser(userId: string): boolean {
    const allowed = this.config.allowedUserIds ?? [];
    if (allowed.length === 0) return true;   // no restriction = allow all
    return allowed.includes(userId);
  }
}
```

- **Step 2: Build**

```bash
pnpm build
```

- **Step 3: Commit**

```bash
git add src/adapters/slack/event-router.ts
git commit -m "feat(slack): add SlackEventRouter — Bolt messages + slash commands → core.handleMessage"
```

---

## Task 8: SlackAdapter — Orchestrator + main.ts wiring

**Files:**

- New: `src/adapters/slack/adapter.ts`
- Modify: `src/main.ts`
- **Step 1: Create SlackAdapter**

```typescript
// src/adapters/slack/adapter.ts
import { App } from "@slack/bolt";
import type { OpenACPCore } from "../../core/core.js";
import { ChannelAdapter } from "../../core/channel.js";
import type { OutgoingMessage, PermissionRequest } from "../../core/types.js";
import type { SlackChannelConfig } from "./types.js";
import type { ISlackChannelManager } from "./channel-manager.js";
import type { ISlackFormatter } from "./formatter.js";
import type { ISlackSendQueue } from "./send-queue.js";
import type { SlackPermissionHandler } from "./permission-handler.js";
import type { SlackEventRouter } from "./event-router.js";
import { toSlug } from "./slug.js";
import { log } from "../../core/log.js";

export class SlackAdapter extends ChannelAdapter {
  constructor(
    core: OpenACPCore,
    private config: SlackChannelConfig,
    private app: App,
    private channelManager: ISlackChannelManager,
    private formatter: ISlackFormatter,
    private sendQueue: ISlackSendQueue,
    private permissionHandler: SlackPermissionHandler,
    private eventRouter: SlackEventRouter,
  ) {
    super(core);
    // Register event/action listeners before app.start()
    eventRouter.register(app);
    permissionHandler.register(app);
  }

  // ── ChannelAdapter abstract methods ──────────────────────────────────────

  async sendMessage(threadId: string, message: OutgoingMessage): Promise<void> {
    const blocks = this.formatter.formatOutgoing(message);
    if (!blocks.length) return;
    await this.sendQueue.enqueue("chat.postMessage", {
      channel: threadId,
      blocks,
      text: this.fallbackText(message),
    });
  }

  async sendPermissionRequest(threadId: string, req: PermissionRequest): Promise<void> {
    // SlackPermissionHandler.send() waits for user to click — returns selected optionId
    const optionId = await this.permissionHandler.send(threadId, req);
    // Route response back to session via core
    await this.core.handlePermissionResponse(req.id, optionId);
  }

  async sendNotification(text: string): Promise<void> {
    const notifChannelId = this.channelManager.getNotificationChannelId();
    if (!notifChannelId) {
      log.warn("slack: notificationChannelId not configured — notification skipped");
      return;
    }
    await this.sendQueue.enqueue("chat.postMessage", {
      channel: notifChannelId,
      blocks: this.formatter.formatNotification(text),
      text,
    });
  }

  async createSessionThread(_parentThreadId: string, label: string): Promise<string> {
    const slug = toSlug(label, this.config.channelPrefix);
    // channelManager.create handles both channel creation and user invite (allowedUserIds)
    const channelId = await this.channelManager.create(slug);
    return channelId;
  }

  async renameSessionThread(threadId: string, name: string): Promise<void> {
    const slug = toSlug(name, this.config.channelPrefix);
    try {
      await this.channelManager.rename(threadId, slug);
    } catch (err) {
      // Non-fatal — rename failure should not break session flow
      log.warn({ err, threadId, name }, "slack: failed to rename session channel");
    }
  }

  async deleteSessionThread(threadId: string): Promise<void> {
    // Slack API cannot delete channels — archive instead
    try {
      await this.channelManager.archive(threadId);
    } catch (err) {
      log.warn({ err, threadId }, "slack: failed to archive session channel");
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.app.start();
    log.info("slack: adapter started (Socket Mode)");
    await this.sendNotification("✅ OpenACP is online");
  }

  async stop(): Promise<void> {
    await this.sendNotification("🛑 OpenACP is shutting down");
    await this.app.stop();
    log.info("slack: adapter stopped");
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private fallbackText(message: OutgoingMessage): string {
    // Required by Slack API — shown in notifications when blocks can't render
    switch (message.type) {
      case "text":       return message.text ?? "";
      case "tool_call":  return `🔧 Tool: ${(message as any).metadata?.name ?? ""}`;
      case "tool_update":return `✅ Tool completed`;
      case "plan":       return `📋 Plan: ${(message.text ?? "").slice(0, 100)}`;
      case "session_end":return `✅ Session ended`;
      case "error":      return `⚠️ Error: ${message.text ?? ""}`;
      default:           return message.type;
    }
  }
}
```

- **Step 2: Add Slack registration block to main.ts**

Find the section in `src/main.ts` where Telegram adapter is registered (look for `TelegramAdapter` or `core.registerAdapter`). Add the Slack block **after** it, keeping Telegram untouched:

```typescript
// Slack adapter (optional)
if (config.channels?.slack?.enabled) {
  const slackCfg = config.channels.slack as SlackChannelConfig;

  const { App } = await import("@slack/bolt");
  const { WebClient } = await import("@slack/web-api");
  const { SlackAdapter } = await import("./adapters/slack/adapter.js");
  const { SlackChannelManager } = await import("./adapters/slack/channel-manager.js");
  const { SlackFormatter } = await import("./adapters/slack/formatter.js");
  const { SlackSendQueue } = await import("./adapters/slack/send-queue.js");
  const { SlackPermissionHandler } = await import("./adapters/slack/permission-handler.js");
  const { SlackEventRouter } = await import("./adapters/slack/event-router.js");

  const boltApp = new App({
    token: slackCfg.botToken,
    appToken: slackCfg.appToken,
    socketMode: true,
  });

  const client = new WebClient(slackCfg.botToken);
  const sendQueue = new SlackSendQueue(client);
  const channelManager = new SlackChannelManager(client, sendQueue, slackCfg);
  const formatter = new SlackFormatter();
  const permissionHandler = new SlackPermissionHandler(sendQueue, formatter);
  const eventRouter = new SlackEventRouter(core, slackCfg);

  const slackAdapter = new SlackAdapter(
    core, slackCfg, boltApp,
    channelManager, formatter, sendQueue, permissionHandler, eventRouter,
  );

  core.registerAdapter("slack", slackAdapter);
  log.info("slack: adapter registered");
}
```

- **Step 3: Add SlackChannelConfig import to main.ts**

At the top of `src/main.ts`, add to existing config import:

```typescript
// Add SlackChannelConfig to the existing config import line
import type { SlackChannelConfig } from "./core/config.js";
```

- **Step 4: Build**

```bash
pnpm build
```

Expected: Full compile, no errors.

- **Step 5: Smoke test — start without Slack config**

```bash
node dist/cli.js start
```

Expected: Starts normally, no Slack-related errors (Slack block skipped because `enabled: false` by default).

- **Step 6: Commit**

```bash
git add src/adapters/slack/adapter.ts src/main.ts
git commit -m "feat(slack): add SlackAdapter orchestrator and register in main.ts"
```

---

## Task 9: Setup guide

**Files:**

- New: `src/adapters/slack/setup-guide.ts`

This module is invoked during `openacp setup` or `openacp setup --slack` to walk the user through creating a Slack App with the correct scopes.

- **Step 1: Create setup-guide.ts**

```typescript
// src/adapters/slack/setup-guide.ts
import { input, confirm } from "@inquirer/prompts";
import type { ConfigManager } from "../../core/config.js";

const REQUIRED_BOT_SCOPES = [
  "channels:manage",
  "channels:history",   // required to receive message events from public channels
  "channels:join",
  "channels:read",
  "groups:write",
  "groups:history",     // required to receive message events from private channels
  "groups:read",
  "chat:write",
  "chat:write.public",
  "commands",
];

const REQUIRED_APP_SCOPES = ["connections:write"];

export async function runSlackSetup(configManager: ConfigManager): Promise<void> {
  console.log("\n🔧 Slack Adapter Setup\n");
  console.log("Before continuing, create a Slack App at https://api.slack.com/apps");
  console.log("\nRequired Bot Token Scopes:");
  REQUIRED_BOT_SCOPES.forEach(s => console.log(`  • ${s}`));
  console.log("\nRequired App-Level Token Scopes (for Socket Mode):");
  REQUIRED_APP_SCOPES.forEach(s => console.log(`  • ${s}`));
  console.log("\nEnable Socket Mode in your app settings.\n");

  const proceed = await confirm({ message: "Have you created the app and configured scopes?" });
  if (!proceed) {
    console.log("Setup cancelled. Run `openacp setup --slack` when ready.");
    return;
  }

  const botToken = await input({
    message: "Bot Token (xoxb-...):",
    validate: v => v.startsWith("xoxb-") || "Must start with xoxb-",
  });

  const appToken = await input({
    message: "App-Level Token (xapp-...) for Socket Mode:",
    validate: v => v.startsWith("xapp-") || "Must start with xapp-",
  });

  const signingSecret = await input({ message: "Signing Secret:" });

  const notificationChannelId = await input({
    message: "Notification Channel ID (C... — create #openacp-notifications first):",
    validate: v => v.startsWith("C") || "Slack channel IDs start with C",
  });

  console.log("\n⚙️  Saving config...");

  await configManager.update({
    channels: {
      slack: {
        enabled: true,
        botToken,
        appToken,
        signingSecret,
        notificationChannelId,
        allowedUserIds: [],
        channelPrefix: "openacp",
      },
    },
  });

  console.log("✅ Slack adapter configured. Restart OpenACP to activate.\n");
  console.log("Next: Register slash commands in your Slack App:");
  console.log("  /openacp-new    — Start a new session");
  console.log("  /openacp-cancel — Cancel current session");
  console.log("  /openacp-status — Show session status\n");
}
```

- **Step 2: Plug into existing setup.ts**

In `src/core/setup.ts` (or wherever `openacp setup` is handled), add:

```typescript
// Inside setup flow, after Telegram:
const setupSlack = await confirm({ message: "Configure Slack adapter?" });
if (setupSlack) {
  const { runSlackSetup } = await import("../adapters/slack/setup-guide.js");
  await runSlackSetup(configManager);
}
```

- **Step 3: Build**

```bash
pnpm build
```

- **Step 4: Commit**

```bash
git add src/adapters/slack/setup-guide.ts src/core/setup.ts
git commit -m "feat(slack): add interactive setup guide for Slack App configuration"
```

---

## Task 10: Tests

**Files:**

- New: `src/adapters/slack/slug.test.ts`
- New: `src/adapters/slack/formatter.test.ts`
- New: `src/adapters/slack/send-queue.test.ts`
- **Step 1: slug.test.ts**

```typescript
// src/adapters/slack/slug.test.ts
import { describe, it, expect } from "vitest";
import { toSlug } from "./slug.js";

describe("toSlug", () => {
  it("lowercases and replaces spaces with dashes", () => {
    const result = toSlug("Fix Auth Bug", "openacp");
    expect(result).toMatch(/^openacp-fix-auth-bug-[a-z0-9]{4}$/);
  });

  it("strips special characters", () => {
    const result = toSlug("OAuth 2.0 & JWT!", "openacp");
    expect(result).not.toMatch(/[^a-z0-9-]/);
  });

  it("collapses multiple dashes", () => {
    const result = toSlug("a  b   c", "openacp");
    expect(result).not.toMatch(/--/);
  });

  it("truncates long names to ≤80 chars total", () => {
    const longName = "a".repeat(100);
    const result = toSlug(longName, "openacp");
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it("always appends a 4-char suffix", () => {
    const result = toSlug("Test", "openacp");
    expect(result).toMatch(/-[a-zA-Z0-9]{4}$/);
  });

  it("two calls produce different suffixes", () => {
    const a = toSlug("Same Name", "openacp");
    const b = toSlug("Same Name", "openacp");
    expect(a).not.toBe(b);
  });
});
```

- **Step 2: formatter.test.ts**

```typescript
// src/adapters/slack/formatter.test.ts
import { describe, it, expect } from "vitest";
import { SlackFormatter } from "./formatter.js";

const fmt = new SlackFormatter();

describe("SlackFormatter.formatOutgoing", () => {
  it("formats text message as section blocks", () => {
    const blocks = fmt.formatOutgoing({ type: "text", text: "Hello world" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("section");
  });

  it("splits text longer than 3000 chars into multiple sections", () => {
    const long = "x".repeat(6500);
    const blocks = fmt.formatOutgoing({ type: "text", text: long });
    expect(blocks.length).toBeGreaterThan(1);
    for (const b of blocks) {
      expect(b.type).toBe("section");
    }
  });

  it("formats thought as context block", () => {
    const blocks = fmt.formatOutgoing({ type: "thought", text: "thinking..." });
    expect(blocks[0].type).toBe("context");
  });

  it("formats tool_call as context block with tool name", () => {
    const blocks = fmt.formatOutgoing({
      type: "tool_call",
      text: "",
      metadata: { name: "read_file" },
    } as any);
    expect(blocks[0].type).toBe("context");
    const ctx = blocks[0] as any;
    expect(ctx.elements[0].text).toContain("read_file");
  });

  it("returns empty array for unknown message type", () => {
    const blocks = fmt.formatOutgoing({ type: "unknown" as any, text: "" });
    expect(blocks).toHaveLength(0);
  });
});

describe("SlackFormatter.formatPermissionRequest", () => {
  it("includes actions block with one button per option", () => {
    const req = {
      id: "req1",
      description: "Run npm install",
      options: [
        { id: "allow", label: "Allow", isAllow: true },
        { id: "deny",  label: "Deny",  isAllow: false },
      ],
    };
    const blocks = fmt.formatPermissionRequest(req);
    const actionsBlock = blocks.find(b => b.type === "actions") as any;
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock.elements).toHaveLength(2);
    expect(actionsBlock.elements[0].style).toBe("primary");
    expect(actionsBlock.elements[1].style).toBe("danger");
  });
});
```

- **Step 3: send-queue.test.ts**

```typescript
// src/adapters/slack/send-queue.test.ts
import { describe, it, expect, vi } from "vitest";
import { SlackSendQueue } from "./send-queue.js";

describe("SlackSendQueue", () => {
  it("calls client.apiCall with correct method and params", async () => {
    const mockClient = {
      apiCall: vi.fn().mockResolvedValue({ ok: true }),
    } as any;

    const queue = new SlackSendQueue(mockClient);
    await queue.enqueue("chat.postMessage", { channel: "C123", text: "hi" });

    expect(mockClient.apiCall).toHaveBeenCalledWith(
      "chat.postMessage",
      { channel: "C123", text: "hi" },
    );
  });

  it("uses separate queues for different methods", () => {
    const mockClient = { apiCall: vi.fn().mockResolvedValue({ ok: true }) } as any;
    const queue = new SlackSendQueue(mockClient) as any;

    const postQueue = queue.queues.get("chat.postMessage");
    const createQueue = queue.queues.get("conversations.create");
    expect(postQueue).not.toBe(createQueue);
  });

  it("throws for unknown method", async () => {
    const mockClient = { apiCall: vi.fn() } as any;
    const queue = new SlackSendQueue(mockClient);
    await expect(
      queue.enqueue("unknown.method" as any, {}),
    ).rejects.toThrow("Unknown Slack method");
  });
});
```

- **Step 4: Run tests**

```bash
pnpm test
```

Expected: All new tests pass.

- **Step 5: Commit**

```bash
git add src/adapters/slack/slug.test.ts src/adapters/slack/formatter.test.ts src/adapters/slack/send-queue.test.ts
git commit -m "test(slack): add unit tests for slug, formatter, send-queue"
```

---

## Task 11: Final verification

- **Step 1: Full build**

```bash
pnpm build
```

Expected: Zero errors, zero warnings about missing types.

- **Step 2: Full test suite**

```bash
pnpm test
```

Expected: All tests pass (new + existing).

- **Step 3: Start without Slack enabled (regression check)**

```bash
node dist/cli.js start
```

Expected: Starts normally, Telegram adapter works, no Slack errors.

- **Step 4: Verify zero changes to core**

```bash
git diff HEAD~11 -- src/core/core.ts src/core/session.ts src/core/channel.ts src/adapters/telegram/
```

Expected: Empty diff — core and Telegram adapter unchanged.

- **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(slack): complete Slack channel adapter (SOLID, channel-per-session, Socket Mode)"
```

---

## Task 12: Fix code review issues (PR #42)

Issues identified by code review that must be fixed before merge. See spec section "Post-Implementation Issues" for full context.

**Files:**

- Modify: `src/adapters/slack/formatter.ts`
- Modify: `src/adapters/slack/text-buffer.ts`
- Modify: `src/adapters/slack/adapter.ts`
- Modify: `src/adapters/slack/event-router.ts`
- Modify: `src/core/core.ts`
- New: `src/adapters/slack/utils.ts`
- New: `src/adapters/slack/index.ts`
- New: `src/adapters/slack/text-buffer.test.ts`
- Modify: `src/adapters/slack/formatter.test.ts`

---

### Fix 1: Bold/italic regex ordering bug

**File:** `src/adapters/slack/formatter.ts`

- **Step 1: Write failing test**

In `src/adapters/slack/formatter.test.ts`, add:

```typescript
import { markdownToMrkdwn } from "./formatter.js";

describe("markdownToMrkdwn", () => {
  it("converts bold without converting to italic", () => {
    expect(markdownToMrkdwn("**bold text**")).toBe("*bold text*");
  });

  it("converts italic correctly", () => {
    expect(markdownToMrkdwn("*italic text*")).toBe("_italic text_");
  });

  it("bold and italic in same string stay separate", () => {
    const result = markdownToMrkdwn("**bold** and *italic*");
    expect(result).toBe("*bold* and _italic_");
  });

  it("converts headers to bold", () => {
    expect(markdownToMrkdwn("## Hello")).toBe("*Hello*");
  });

  it("converts links", () => {
    expect(markdownToMrkdwn("[text](https://example.com)")).toBe("<https://example.com|text>");
  });
});
```

- **Step 2: Run test — verify bold test fails**

```bash
pnpm test formatter
```

Expected: `"converts bold without converting to italic"` FAILS — bold gets converted to italic.

- **Step 3: Fix `markdownToMrkdwn` in `formatter.ts`**

Replace the current `markdownToMrkdwn` function with placeholder-based approach:

```typescript
export function markdownToMrkdwn(text: string): string {
  return text
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "\x00BOLD\x00$1\x00BOLD\x00")
    .replace(/(?<!\x00BOLD\x00)\*(?!\x00BOLD\x00)(.+?)(?<!\x00BOLD\x00)\*(?!\x00BOLD\x00)/g, "_$1_")
    .replace(/\x00BOLD\x00(.+?)\x00BOLD\x00/g, "*$1*")
    .replace(/~~(.+?)~~/g, "~$1~")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>")
    .replace(/^[ \t]*[-*]\s+/gm, "• ")
    .trim();
}
```

- **Step 4: Run tests — verify pass**

```bash
pnpm test formatter
```

Expected: All `markdownToMrkdwn` tests PASS.

- **Step 5: Commit**

```bash
git add src/adapters/slack/formatter.ts src/adapters/slack/formatter.test.ts
git commit -m "fix(slack): fix bold/italic ordering bug in markdownToMrkdwn using placeholder tokens"
```

---

### Fix 2: `botUserId` race condition — throw instead of warn

**File:** `src/adapters/slack/adapter.ts`

- **Step 1: Replace warn with throw in `start()`**

Find this block in `adapter.ts`:

```typescript
try {
  const authResult = await this.webClient.auth.test();
  this.botUserId = (authResult.user_id as string) ?? "";
  log.info({ botUserId: this.botUserId }, "Slack bot authenticated");
} catch (err) {
  log.warn({ err }, "Failed to resolve Slack bot user ID");
}
```

Replace with:

```typescript
const authResult = await this.webClient.auth.test();
if (!authResult.user_id) {
  throw new Error("Slack auth.test() did not return user_id — verify botToken is valid");
}
this.botUserId = authResult.user_id as string;
log.info({ botUserId: this.botUserId }, "Slack bot authenticated");
```

- **Step 2: Build**

```bash
pnpm build
```

Expected: Compiles without errors.

- **Step 3: Commit**

```bash
git add src/adapters/slack/adapter.ts
git commit -m "fix(slack): throw on auth.test() failure to prevent infinite message loop"
```

---

### Fix 3: `onNewSession` — reply with guidance instead of no-op

**File:** `src/adapters/slack/adapter.ts`

- **Step 1: Replace no-op callback with reply**

Find the `onNewSession` callback in `start()`:

```typescript
// onNewSession: no-op — session is created at startup, not on demand
(_text, _userId) => {},
```

Replace with:

```typescript
async (_text, _userId) => {
  if (this.slackConfig.notificationChannelId) {
    await this.queue.enqueue("chat.postMessage", {
      channel: this.slackConfig.notificationChannelId,
      text: "💬 To start a new session, use the `/openacp-new` slash command in any channel.",
    }).catch((err) => log.warn({ err }, "Failed to send onNewSession reply"));
  }
},
```

- **Step 2: Build**

```bash
pnpm build
```

- **Step 3: Commit**

```bash
git add src/adapters/slack/adapter.ts
git commit -m "fix(slack): reply with guidance when user messages notification channel directly"
```

---

### Fix 4: `allowedUserIds` not enforced in EventRouter

**File:** `src/adapters/slack/event-router.ts`

- **Step 1: Add `config` param and `isAllowedUser` check**

Add `config` parameter to `SlackEventRouter` constructor and enforce `allowedUserIds`:

```typescript
import type { SlackChannelConfig } from "./types.js";

export class SlackEventRouter implements ISlackEventRouter {
  constructor(
    private sessionLookup: SessionLookup,
    private onIncoming: IncomingMessageCallback,
    private botUserId: string,
    private notificationChannelId: string | undefined,
    private onNewSession: NewSessionCallback,
    private config: SlackChannelConfig,   // ADD THIS
  ) {}

  register(app: App): void {
    app.message(async ({ message }) => {
      // ... existing guards ...
      const userId: string = (message as any).user ?? "";

      // ADD: allowedUserIds check
      if (!this.isAllowedUser(userId)) {
        log.warn({ userId }, "slack: message from non-allowed user rejected");
        return;
      }

      // ... rest of existing routing ...
    });
  }

  private isAllowedUser(userId: string): boolean {
    const allowed = this.config.allowedUserIds ?? [];
    if (allowed.length === 0) return true;
    return allowed.includes(userId);
  }
}
```

- **Step 2: Pass `config` when constructing `SlackEventRouter` in `adapter.ts`**

Find the `new SlackEventRouter(...)` call in `adapter.ts` and add `this.slackConfig` as the last argument.

- **Step 3: Build**

```bash
pnpm build
```

- **Step 4: Commit**

```bash
git add src/adapters/slack/event-router.ts src/adapters/slack/adapter.ts
git commit -m "fix(slack): enforce allowedUserIds in SlackEventRouter"
```

---

### Fix 5: `renameSessionThread` — use `toSlug()` instead of inline logic

**File:** `src/adapters/slack/adapter.ts`

- **Step 1: Replace inline slug logic**

Find `renameSessionThread` in `adapter.ts`:

```typescript
const newSlug = newName
  .toLowerCase()
  .replace(/[^a-z0-9\s-]/g, "")
  .trim()
  .replace(/\s+/g, "-")
  .replace(/-+/g, "-")
  .slice(0, 60);
```

Replace with:

```typescript
const newSlug = toSlug(newName, this.slackConfig.channelPrefix ?? "openacp");
```

> **Note:** `toSlug(name, prefix)` signature — check `slug.ts` to confirm the second argument is `prefix` (not a suffix/nanoid). The function in Task 2 is defined as `toSlug(name: string, prefix = "openacp"): string`. So passing `channelPrefix` here is correct — the nanoid suffix is appended internally by the function itself.

Make sure `toSlug` is imported at the top of `adapter.ts`.

- **Step 2: Build**

```bash
pnpm build
```

- **Step 3: Commit**

```bash
git add src/adapters/slack/adapter.ts
git commit -m "fix(slack): use toSlug() in renameSessionThread to prevent channel name collisions"
```

---

### Fix 6: `adoptSession` — store `threadId` as string not Number

**File:** `src/core/core.ts`

- **Step 1: Fix the `Number()` cast**

In `core.ts`, find `adoptSession`. Locate:

```typescript
platform: { topicId: Number(session.threadId) },
```

Replace with:

```typescript
platform: { topicId: session.threadId },
```

- **Step 2: Verify Telegram still works**

Check the `topicId` field type in the Telegram adapter — Telegram uses numeric topic IDs. Verify the type definition of `platform` allows `string | number`:

```bash
grep -r "topicId" src/
```

If `topicId` is typed as `number` somewhere, change to `string | number`.

- **Step 3: Build**

```bash
pnpm build
```

Expected: No type errors.

- **Step 4: Commit**

```bash
git add src/core/core.ts
git commit -m "fix(core): store adoptSession threadId as string to support Slack channel slugs"
```

---

### Fix 7: `SlackTextBuffer` concurrent flush data loss

**File:** `src/adapters/slack/text-buffer.ts`

- **Step 1: Write failing test for concurrent flush**

Create `src/adapters/slack/text-buffer.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { SlackTextBuffer } from "./text-buffer.js";

describe("SlackTextBuffer", () => {
  it("flushes buffered text as a single message", async () => {
    const mockQueue = {
      enqueue: vi.fn().mockResolvedValue({}),
    } as any;
    const buf = new SlackTextBuffer("C123", "sess1", mockQueue);

    buf.append("Hello ");
    buf.append("world");
    await buf.flush();

    expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
    const call = mockQueue.enqueue.mock.calls[0];
    expect(call[1].text).toContain("Hello");
    expect(call[1].text).toContain("world");
  });

  it("does not lose content appended during flush", async () => {
    let resolveFn!: () => void;
    const mockQueue = {
      enqueue: vi.fn().mockImplementation(() => new Promise<void>(r => { resolveFn = r; })),
    } as any;
    const buf = new SlackTextBuffer("C123", "sess1", mockQueue);

    buf.append("first");
    const flushPromise = buf.flush();  // starts flush, blocks on enqueue

    // Append more content while flush is in progress
    buf.append(" second");

    resolveFn();                        // unblock first flush
    await flushPromise;

    // Wait for re-flush triggered by content that arrived during flush
    await new Promise(r => setTimeout(r, 50));

    const allText = mockQueue.enqueue.mock.calls
      .map((c: any) => c[1].text)
      .join(" ");
    expect(allText).toContain("second");
  });

  it("does not post empty content", async () => {
    const mockQueue = { enqueue: vi.fn().mockResolvedValue({}) } as any;
    const buf = new SlackTextBuffer("C123", "sess1", mockQueue);
    await buf.flush();
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
});
```

- **Step 2: Run test — verify concurrent flush test fails**

```bash
pnpm test text-buffer
```

Expected: `"does not lose content appended during flush"` FAILS.

- **Step 3: Fix `flush()` in `text-buffer.ts`**

Replace the current `flush()` implementation:

```typescript
async flush(): Promise<void> {
  if (this.flushing) return;
  const text = this.buffer.trim();
  if (!text) return;
  this.buffer = "";
  if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }

  this.flushing = true;
  try {
    const converted = markdownToMrkdwn(text);
    const chunks = splitSafe(converted);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      await this.queue.enqueue("chat.postMessage", {
        channel: this.channelId,
        text: chunk,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: chunk } }],
      });
    }
  } finally {
    this.flushing = false;
    // Re-flush if content arrived while we were flushing
    if (this.buffer.trim()) {
      await this.flush();
    }
  }
}
```

- **Step 4: Run tests — verify all pass**

```bash
pnpm test text-buffer
```

Expected: All 3 tests PASS.

- **Step 5: Commit**

```bash
git add src/adapters/slack/text-buffer.ts src/adapters/slack/text-buffer.test.ts
git commit -m "fix(slack): prevent TextBuffer data loss during concurrent flush"
```

---

### Fix 8: Minor — extract `splitSafe` to shared utils, fix header comment, add barrel export

**Files:** `src/adapters/slack/utils.ts` (new), `src/adapters/slack/formatter.ts`, `src/adapters/slack/text-buffer.ts`, `src/adapters/slack/adapter.ts` (header), `src/adapters/slack/index.ts` (new)

- **Step 1: Create `src/adapters/slack/utils.ts`**

```typescript
// src/adapters/slack/utils.ts

const SECTION_LIMIT = 3000;

/**
 * Split text at `limit` boundary, never inside a fenced code block.
 * Used by SlackFormatter and SlackTextBuffer.
 */
export function splitSafe(text: string, limit = SECTION_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}
```

- **Step 2: Update `formatter.ts` and `text-buffer.ts` to import from `utils.ts`**

In `formatter.ts`, remove the local `splitSafe` function and add:

```typescript
import { splitSafe } from "./utils.js";
```

In `text-buffer.ts`, remove the local `splitSafe` function and add:

```typescript
import { splitSafe } from "./utils.js";
```

- **Step 3: Fix file header comment in `adapter.ts`**

Change line 1:

```typescript
// src/adapters/slack/index.ts
```

to:

```typescript
// src/adapters/slack/adapter.ts
```

- **Step 3b: Fix `config as never` type cast in `SlackAdapter` constructor**

In `adapter.ts`, find:

```typescript
constructor(core: OpenACPCore, config: SlackChannelConfig) {
  super(core, config as never);
```

`ChannelAdapter` is generic — fix by passing the correct type argument:

```typescript
export class SlackAdapter extends ChannelAdapter<OpenACPCore, SlackChannelConfig> {
  constructor(core: OpenACPCore, config: SlackChannelConfig) {
    super(core, config);
```

Check `src/core/channel.ts` for the exact generic signature of `ChannelAdapter` to confirm the type parameters before making this change.

- **Step 4: Create `src/adapters/slack/index.ts` barrel export**

```typescript
// src/adapters/slack/index.ts
export { SlackAdapter } from "./adapter.js";
export type { SlackChannelConfig } from "./types.js";
```

- **Step 5: Build and run all tests**

```bash
pnpm build && pnpm test
```

Expected: Zero errors, all tests pass.

- **Step 6: Commit**

```bash
git add src/adapters/slack/utils.ts src/adapters/slack/index.ts src/adapters/slack/formatter.ts src/adapters/slack/text-buffer.ts src/adapters/slack/adapter.ts
git commit -m "refactor(slack): extract splitSafe to utils, add barrel export, fix header comment"
```

---

### Final verification for Task 12

- **Step 1: Full test suite**

```bash
pnpm test
```

Expected: All tests pass including new ones for `markdownToMrkdwn` and `SlackTextBuffer`.

- **Step 2: Build**

```bash
pnpm build
```

Expected: Zero errors.

- **Step 3: Verify core diff is minimal**

```bash
git diff origin/main -- src/core/core.ts
```

Expected: Only the `Number(session.threadId)` → `session.threadId` change.

---

## Task 13: Fix code review issues — Review Round 2 (PR #42)

Issues identified by @0xmrpeter in second review (2026-03-24). See spec section "Post-Implementation Issues — Review Round 2" for full context.

**Files:**

- Modify: `src/adapters/slack/event-router.ts`
- Modify: `src/adapters/slack/utils.ts`
- Modify: `src/adapters/slack/adapter.ts`
- Modify: `src/adapters/slack/channel-manager.ts`
- Modify: `src/core/config.ts`
- Modify: `src/main.ts`
- New: `src/adapters/slack/__tests__/event-router.test.ts`
- New: `src/adapters/slack/__tests__/permission-handler.test.ts`

---

### Fix R2-1: Make `config` required in `SlackEventRouter`

**File:** `src/adapters/slack/event-router.ts`

- [ ] **Step 1: Change `config?` to `config` in constructor**

In `event-router.ts`, line 28, change:

```typescript
private config?: SlackChannelConfig,
```

to:

```typescript
private config: SlackChannelConfig,
```

- [ ] **Step 2: Remove optional chaining in `isAllowedUser`**

Change:

```typescript
const allowed = this.config?.allowedUserIds ?? [];
```

to:

```typescript
const allowed = this.config.allowedUserIds ?? [];
```

- [ ] **Step 3: Build**

```bash
pnpm build
```

Expected: Compiles — the adapter already passes `this.slackConfig` as last arg.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/slack/event-router.ts
git commit -m "fix(slack): make config required in SlackEventRouter to prevent security bypass"
```

---

### Fix R2-2: Fix `splitSafe` docstring

**File:** `src/adapters/slack/utils.ts`

- [ ] **Step 1: Update docstring**

Change:

```typescript
/**
 * Split text at `limit` boundary, never inside a fenced code block.
 * Used by SlackFormatter and SlackTextBuffer to avoid exceeding Slack's
 * 3000-char section limit.
 */
```

to:

```typescript
/**
 * Split text at nearest newline boundary before `limit`.
 * Does NOT track code fence state — a triple-backtick block straddling
 * the boundary will be split mid-block.
 * Used by SlackFormatter and SlackTextBuffer to avoid exceeding Slack's
 * 3000-char section limit.
 */
```

- [ ] **Step 2: Commit**

```bash
git add src/adapters/slack/utils.ts
git commit -m "fix(slack): correct splitSafe docstring — does not protect code blocks"
```

---

### Fix R2-3: Document async permission flow in adapter.ts

**File:** `src/adapters/slack/adapter.ts`

- [ ] **Step 1: Add comment above `sendPermissionRequest`**

Before the `sendPermissionRequest` method, add:

```typescript
  // NOTE: Async flow — different from Telegram adapter.
  // Telegram: sendPermissionRequest awaits user response inline.
  // Slack: posts interactive buttons and returns immediately.
  // Resolution happens asynchronously via the Bolt action handler in
  // SlackPermissionHandler, which calls the PermissionResponseCallback
  // passed during construction. The callback iterates sessions to find
  // the matching permissionGate and resolves it.
```

- [ ] **Step 2: Commit**

```bash
git add src/adapters/slack/adapter.ts
git commit -m "docs(slack): document async permission flow difference from Telegram"
```

---

### Fix R2-4: Make `_createStartupSession` configurable

**Files:** `src/core/config.ts`, `src/adapters/slack/adapter.ts`

- [ ] **Step 1: Add `autoCreateSession` to SlackChannelConfigSchema**

In `src/core/config.ts`, find the `SlackChannelConfigSchema` and add:

```typescript
autoCreateSession: z.boolean().default(true),
```

After `channelPrefix`.

- [ ] **Step 2: Guard `_createStartupSession` with config check**

In `adapter.ts`, find `start()` where `_createStartupSession` is called:

```typescript
    // Create the startup session + channel
    await this._createStartupSession();
```

Replace with:

```typescript
    // Create startup session + channel (configurable — set autoCreateSession: false to skip)
    if (this.slackConfig.autoCreateSession !== false) {
      await this._createStartupSession();
    }
```

- [ ] **Step 3: Build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/core/config.ts src/adapters/slack/adapter.ts
git commit -m "feat(slack): make startup session creation configurable via autoCreateSession"
```

---

### Fix R2-5: Fix `channelConfig as any` cast in main.ts

**File:** `src/main.ts`

- [ ] **Step 1: Replace `as any` with proper type**

In `main.ts`, find:

```typescript
core.registerAdapter('slack', new SlackAdapter(core, channelConfig as any))
```

Replace with:

```typescript
core.registerAdapter('slack', new SlackAdapter(core, channelConfig as SlackChannelConfig))
```

Ensure `SlackChannelConfig` is imported. If it's not already, add to the imports at top:

```typescript
import type { SlackChannelConfig } from "./adapters/slack/types.js";
```

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "fix(slack): replace 'as any' with proper SlackChannelConfig type in main.ts"
```

---

### Fix R2-6: Tighten auto-approve match in sendPermissionRequest

**File:** `src/adapters/slack/adapter.ts`

- [ ] **Step 1: Replace broad string match with specific check**

In `adapter.ts`, find:

```typescript
    // Auto-approve openacp CLI commands
    if (request.description.includes("openacp")) {
```

Replace with a more specific check. The auto-approve is meant for OpenACP's own internal commands (like openacp CLI subcommands). Use the command/tool metadata instead of description:

```typescript
    // Auto-approve openacp's own internal CLI commands (e.g., openacp install, openacp setup)
    const toolName = (request as any).metadata?.name ?? "";
    const isOpenacpInternal = toolName === "openacp" || toolName.startsWith("openacp ");
    if (isOpenacpInternal) {
```

If `request.metadata` is not available, fallback to checking if the description starts with "Run `openacp " (prefix match, not substring):

```typescript
    // Auto-approve openacp's own internal CLI commands
    const isOpenacpInternal =
      request.description.startsWith("Run `openacp ") ||
      request.description.startsWith("Execute `openacp ");
    if (isOpenacpInternal) {
```

Verify which approach fits by checking the actual PermissionRequest shape from `core/types.ts`.

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/adapters/slack/adapter.ts
git commit -m "fix(slack): tighten auto-approve match to prevent unintended approvals"
```

---

### Fix R2-7: Add `name_taken` retry in channel-manager.ts

**File:** `src/adapters/slack/channel-manager.ts`

- [ ] **Step 1: Add retry logic on `name_taken` error**

In `channel-manager.ts`, wrap the `conversations.create` call with a try/catch:

```typescript
  async createChannel(sessionId: string, sessionName: string): Promise<SlackSessionMeta> {
    let finalSlug = toSlug(sessionName, this.config.channelPrefix ?? "openacp");

    let channelId: string;
    try {
      const res = await this.queue.enqueue<{ channel: { id: string } }>(
        "conversations.create",
        { name: finalSlug, is_private: true }
      );
      channelId = res.channel.id;
    } catch (err: any) {
      // Retry once with regenerated suffix on name collision
      if (err?.data?.error === "name_taken") {
        finalSlug = toSlug(sessionName, this.config.channelPrefix ?? "openacp");
        const res = await this.queue.enqueue<{ channel: { id: string } }>(
          "conversations.create",
          { name: finalSlug, is_private: true }
        );
        channelId = res.channel.id;
      } else {
        throw err;
      }
    }

    // Invite configured users
    const userIds = this.config.allowedUserIds ?? [];
    if (userIds.length > 0) {
      await this.queue.enqueue("conversations.invite", {
        channel: channelId,
        users: userIds.join(","),
      });
    }

    return { channelId, channelSlug: finalSlug };
  }
```

Note: `toSlug()` generates a fresh nanoid suffix each call, so the retry slug will differ.

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Add test for name_taken retry**

Create or update `src/adapters/slack/__tests__/channel-manager.test.ts`:

```typescript
// src/adapters/slack/__tests__/channel-manager.test.ts
import { describe, it, expect, vi } from "vitest";
import { SlackChannelManager } from "../channel-manager.js";

function createConfig(overrides = {}) {
  return {
    enabled: true,
    botToken: "xoxb-test",
    appToken: "xapp-test",
    signingSecret: "secret",
    allowedUserIds: [],
    channelPrefix: "openacp",
    autoCreateSession: true,
    ...overrides,
  };
}

describe("SlackChannelManager", () => {
  it("retries with new slug on name_taken error", async () => {
    const mockQueue = {
      enqueue: vi.fn()
        .mockRejectedValueOnce({ data: { error: "name_taken" } })
        .mockResolvedValueOnce({ channel: { id: "C_RETRY" } })
        .mockResolvedValue({}),  // for invite
    } as any;

    const manager = new SlackChannelManager(mockQueue, createConfig() as any);
    const result = await manager.createChannel("sess1", "test session");

    expect(result.channelId).toBe("C_RETRY");
    expect(mockQueue.enqueue).toHaveBeenCalledTimes(2); // create failed + create retry (no invite since allowedUserIds empty)
  });

  it("throws non-name_taken errors", async () => {
    const mockQueue = {
      enqueue: vi.fn().mockRejectedValue({ data: { error: "other_error" } }),
    } as any;

    const manager = new SlackChannelManager(mockQueue, createConfig() as any);
    await expect(manager.createChannel("sess1", "test")).rejects.toEqual(
      { data: { error: "other_error" } },
    );
  });
});
```

- [ ] **Step 4: Run test**

```bash
pnpm test channel-manager
```

Expected: Both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/slack/channel-manager.ts src/adapters/slack/__tests__/channel-manager.test.ts
git commit -m "fix(slack): add name_taken retry with regenerated suffix in channel creation"
```

---

### Fix R2-8: Add tests for EventRouter and PermissionHandler

**Files:** `src/adapters/slack/__tests__/event-router.test.ts`, `src/adapters/slack/__tests__/permission-handler.test.ts`

- [ ] **Step 1: Create EventRouter test**

```typescript
// src/adapters/slack/__tests__/event-router.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackEventRouter } from "../event-router.js";

function createMockApp() {
  const handlers: Record<string, Function> = {};
  const commands: Record<string, Function> = {};
  return {
    message: vi.fn((handler: Function) => { handlers.message = handler; }),
    command: vi.fn((name: string, handler: Function) => { commands[name] = handler; }),
    _trigger: (event: string, payload: any) => handlers[event]?.(payload),
    _triggerCommand: (name: string, payload: any) => commands[name]?.(payload),
    handlers,
    commands,
  };
}

function createConfig(overrides = {}) {
  return {
    enabled: true,
    botToken: "xoxb-test",
    appToken: "xapp-test",
    signingSecret: "secret",
    allowedUserIds: [],
    channelPrefix: "openacp",
    autoCreateSession: true,
    ...overrides,
  };
}

describe("SlackEventRouter", () => {
  let sessionLookup: ReturnType<typeof vi.fn>;
  let onIncoming: ReturnType<typeof vi.fn>;
  let onNewSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionLookup = vi.fn();
    onIncoming = vi.fn();
    onNewSession = vi.fn();
  });

  it("rejects messages from non-allowed users", async () => {
    const config = createConfig({ allowedUserIds: ["U_ALLOWED"] });
    const router = new SlackEventRouter(
      sessionLookup, onIncoming, "BOT_ID", undefined, onNewSession, config,
    );
    const app = createMockApp();
    router.register(app as any);

    // Simulate message from unauthorized user
    await app._trigger("message", {
      message: {
        channel: "C123",
        user: "U_NOT_ALLOWED",
        text: "hello",
        channel_type: "group",
      },
    });

    expect(onIncoming).not.toHaveBeenCalled();
  });

  it("allows messages when allowedUserIds is empty (open access)", async () => {
    const config = createConfig({ allowedUserIds: [] });
    const router = new SlackEventRouter(
      sessionLookup, onIncoming, "BOT_ID", undefined, onNewSession, config,
    );
    const app = createMockApp();
    router.register(app as any);

    sessionLookup.mockReturnValue({ channelSlug: "test-session" });

    await app._trigger("message", {
      message: {
        channel: "C123",
        user: "U_ANYONE",
        text: "hello",
        channel_type: "group",
      },
    });

    expect(onIncoming).toHaveBeenCalledWith("test-session", "hello", "U_ANYONE");
  });

  it("ignores bot messages", async () => {
    const config = createConfig();
    const router = new SlackEventRouter(
      sessionLookup, onIncoming, "BOT_ID", undefined, onNewSession, config,
    );
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", {
      message: {
        channel: "C123",
        user: "BOT_ID",
        text: "echo",
        channel_type: "group",
      },
    });

    expect(onIncoming).not.toHaveBeenCalled();
  });

  it("ignores messages with bot_id", async () => {
    const config = createConfig();
    const router = new SlackEventRouter(
      sessionLookup, onIncoming, "BOT_ID", undefined, onNewSession, config,
    );
    const app = createMockApp();
    router.register(app as any);

    await app._trigger("message", {
      message: {
        channel: "C123",
        user: "U_OTHER",
        text: "hello",
        bot_id: "B123",
        channel_type: "group",
      },
    });

    expect(onIncoming).not.toHaveBeenCalled();
  });

  it("rejects slash commands from non-allowed users", async () => {
    const config = createConfig({ allowedUserIds: ["U_ALLOWED"] });
    const router = new SlackEventRouter(
      sessionLookup, onIncoming, "BOT_ID", undefined, onNewSession, config,
    );
    const app = createMockApp();
    router.register(app as any);

    const respond = vi.fn();
    await app._triggerCommand("/openacp-new", {
      ack: vi.fn(),
      body: { user_id: "U_NOT_ALLOWED", channel_id: "C123" },
      respond,
    });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("not authorized") }),
    );
    // /openacp-new routes through onNewSession, not onIncoming — verify neither is called
    expect(onNewSession).not.toHaveBeenCalled();
    expect(onIncoming).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Create PermissionHandler test**

```typescript
// src/adapters/slack/__tests__/permission-handler.test.ts
import { describe, it, expect, vi } from "vitest";
import { SlackPermissionHandler } from "../permission-handler.js";

describe("SlackPermissionHandler", () => {
  it("resolves callback when button is clicked", async () => {
    const mockQueue = { enqueue: vi.fn().mockResolvedValue({}) } as any;
    const onResponse = vi.fn();
    const handler = new SlackPermissionHandler(mockQueue, onResponse);

    // Register with mock app
    let actionHandler: Function;
    const mockApp = {
      action: vi.fn((_pattern: any, handler: Function) => { actionHandler = handler; }),
    };
    handler.register(mockApp as any);

    // Simulate button click
    await actionHandler!({
      action: { value: "req123:allow", text: { text: "Allow" } },
      ack: vi.fn(),
      body: { message: { blocks: [], ts: "123.456" }, channel: { id: "C123" } },
      client: { chat: { update: vi.fn().mockResolvedValue({}) } },
    });

    expect(onResponse).toHaveBeenCalledWith("req123", "allow");
  });

  it("ignores unknown request IDs", async () => {
    const mockQueue = { enqueue: vi.fn().mockResolvedValue({}) } as any;
    const onResponse = vi.fn();
    const handler = new SlackPermissionHandler(mockQueue, onResponse);

    let actionHandler: Function;
    const mockApp = {
      action: vi.fn((_pattern: any, handler: Function) => { actionHandler = handler; }),
    };
    handler.register(mockApp as any);

    // Click for a request that was never registered
    await actionHandler!({
      action: { value: "unknown:allow", text: { text: "Allow" } },
      ack: vi.fn(),
      body: {},
      client: { chat: { update: vi.fn() } },
    });

    // Should not throw, just log warning
    expect(onResponse).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test event-router permission-handler
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/slack/__tests__/event-router.test.ts src/adapters/slack/__tests__/permission-handler.test.ts
git commit -m "test(slack): add unit tests for EventRouter and PermissionHandler"
```

---

### Final verification for Task 13

- [ ] **Step 1: Full build**

```bash
pnpm build
```

Expected: Zero errors.

- [ ] **Step 2: Full test suite**

```bash
pnpm test
```

Expected: All tests pass (new + existing).

- [ ] **Step 3: Verify config backward compat**

Ensure `autoCreateSession` has `.default(true)` — existing configs without this field should parse without error and keep the current behavior.

```bash
pnpm build && node -e "
const { ConfigSchema } = require('./dist/core/config.js');
const result = ConfigSchema.safeParse({ channels: { slack: { enabled: true, botToken: 'xoxb-test', appToken: 'xapp-test', signingSecret: 'x' } }, defaultAgent: 'test' });
console.log('autoCreateSession:', result.data?.channels?.slack?.autoCreateSession);
"
```

Expected: `autoCreateSession: true` (default applied).