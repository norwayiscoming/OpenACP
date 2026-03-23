# Slack Channel Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a full Slack channel adapter so OpenACP users can interact with AI agents via Slack workspaces, with zero impact on existing Telegram adapter and core modules.

**Architecture:** SOLID — 7 focused classes injected into a thin `SlackAdapter` orchestrator. Channel-per-session threading. Socket Mode event delivery via `@slack/bolt`.

**Tech Stack:** TypeScript ESM, `@slack/bolt`, `p-queue`, `nanoid`

**Spec:** `docs/superpowers/specs/2026-03-23-slack-adapter-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/adapters/slack/types.ts` | **New** | `SlackChannelConfig`, `SlackSessionMeta` |
| `src/adapters/slack/slug.ts` | **New** | Channel name slugifier |
| `src/adapters/slack/formatter.ts` | **New** | `ISlackFormatter` + Block Kit impl |
| `src/adapters/slack/send-queue.ts` | **New** | `ISlackSendQueue` + per-method rate limiter |
| `src/adapters/slack/channel-manager.ts` | **New** | `ISlackChannelManager` + Slack API CRUD |
| `src/adapters/slack/permission-handler.ts` | **New** | Interactive components (buttons) |
| `src/adapters/slack/event-router.ts` | **New** | Bolt events → `core.handleMessage` |
| `src/adapters/slack/adapter.ts` | **New** | `SlackAdapter extends ChannelAdapter` (~200 lines) |
| `src/core/config.ts` | **Minor** | +`SlackChannelConfigSchema` (~25 lines) |
| `src/main.ts` | **Minor** | +Slack registration block (~25 lines) |
| `src/adapters/telegram/` | **No change** | |
| `src/core/core.ts` | **No change** | |
| `src/core/session.ts` | **No change** | |
| `src/core/channel.ts` | **No change** | |

---

## Task 1: Install dependency + Config schema

**Files:**
- Modify: `package.json` (via pnpm)
- Modify: `src/core/config.ts`

- [ ] **Step 1: Install @slack/bolt and p-queue**

```bash
pnpm add @slack/bolt p-queue
```

Expected: Both appear in `package.json` dependencies.

- [ ] **Step 2: Add SlackChannelConfigSchema to config.ts**

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

- [ ] **Step 3: Register in channels union**

Find where the `channels` field is defined in `ConfigSchema` and add the Slack case. Keep all existing entries — additive only:

```typescript
// Inside ConfigSchema, channels field:
slack: SlackChannelConfigSchema.optional(),
```

- [ ] **Step 4: Build and verify no type errors**

```bash
pnpm build
```

Expected: Compiles successfully. `SlackChannelConfig` is now exported from config.ts.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/core/config.ts
git commit -m "feat(slack): add @slack/bolt dependency and SlackChannelConfig schema"
```

---

## Task 2: Types + Slug utility

**Files:**
- New: `src/adapters/slack/types.ts`
- New: `src/adapters/slack/slug.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// src/adapters/slack/types.ts
export type { SlackChannelConfig } from "../../core/config.js";

// Per-session metadata stored in SessionRecord.platform
export interface SlackSessionMeta {
  channelId: string;     // Slack channel ID for this session (C...)
  channelSlug: string;   // e.g. "openacp-fix-auth-bug-a3k9"
}
```

- [ ] **Step 2: Create slug.ts**

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

- [ ] **Step 3: Build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/adapters/slack/types.ts src/adapters/slack/slug.ts
git commit -m "feat(slack): add SlackSessionMeta types and channel slug utility"
```

---

## Task 3: SlackFormatter — Block Kit

**Files:**
- New: `src/adapters/slack/formatter.ts`

- [ ] **Step 1: Create the ISlackFormatter interface and SlackFormatter class**

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
        return [context(`💭 _${(message.text ?? "").slice(0, 500)}_`)];

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

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/slack/formatter.ts
git commit -m "feat(slack): add SlackFormatter with Block Kit output for all OutgoingMessage types"
```

---

## Task 4: SlackSendQueue — Per-method rate limiter

**Files:**
- New: `src/adapters/slack/send-queue.ts`

- [ ] **Step 1: Create ISlackSendQueue interface and SlackSendQueue class**

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
  | "conversations.join"
  | "conversations.unarchive";

// Requests per minute per method (Slack Tier definitions)
const METHOD_RPM: Record<SlackMethod, number> = {
  "chat.postMessage":      50,   // Tier 3
  "chat.update":           50,   // Tier 3
  "conversations.create":  20,   // Tier 2
  "conversations.rename":  20,   // Tier 2
  "conversations.archive": 20,   // Tier 2
  "conversations.join":    20,   // Tier 2
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

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/adapters/slack/send-queue.ts
git commit -m "feat(slack): add SlackSendQueue with per-method rate limiting (p-queue)"
```

---

## Task 5: SlackChannelManager — Channel CRUD

**Files:**
- New: `src/adapters/slack/channel-manager.ts`

- [ ] **Step 1: Create ISlackChannelManager interface and implementation**

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
  ensureBotJoined(channelId: string): Promise<void>;
  getNotificationChannelId(): string;
}

export class SlackChannelManager implements ISlackChannelManager {
  constructor(
    private client: WebClient,
    private sendQueue: ISlackSendQueue,
    private config: SlackChannelConfig,
  ) {}

  async create(slug: string): Promise<string> {
    try {
      const res = await this.sendQueue.enqueue<{ channel: { id: string } }>(
        "conversations.create",
        { name: slug, is_private: true },
      );
      return res.channel.id;
    } catch (err: any) {
      // Handle name_taken — regenerate suffix and retry once
      if (err?.data?.error === "name_taken") {
        const { toSlug } = await import("./slug.js");
        const newSlug = toSlug(slug.replace(/-[a-z0-9]{4}$/, ""), this.config.channelPrefix);
        const res = await this.sendQueue.enqueue<{ channel: { id: string } }>(
          "conversations.create",
          { name: newSlug, is_private: true },
        );
        return res.channel.id;
      }
      throw err;
    }
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
    await this.sendQueue.enqueue("conversations.unarchive", { channel: channelId });
    await this.ensureBotJoined(channelId);
  }

  async ensureBotJoined(channelId: string): Promise<void> {
    await this.sendQueue.enqueue("conversations.join", { channel: channelId });
  }

  getNotificationChannelId(): string {
    return this.config.notificationChannelId ?? "";
  }
}
```

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/adapters/slack/channel-manager.ts
git commit -m "feat(slack): add SlackChannelManager (create/rename/archive/join) with name_taken retry"
```

---

## Task 6: SlackPermissionHandler — Interactive buttons

**Files:**
- New: `src/adapters/slack/permission-handler.ts`

- [ ] **Step 1: Create SlackPermissionHandler**

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
            elements: [{ type: "mrkdwn", text: `_Responded: ${btn.text.text}_` }],
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

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/adapters/slack/permission-handler.ts
git commit -m "feat(slack): add SlackPermissionHandler with interactive button routing"
```

---

## Task 7: SlackEventRouter — Bolt events → core

**Files:**
- New: `src/adapters/slack/event-router.ts`

- [ ] **Step 1: Create SlackEventRouter**

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

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/adapters/slack/event-router.ts
git commit -m "feat(slack): add SlackEventRouter — Bolt messages + slash commands → core.handleMessage"
```

---

## Task 8: SlackAdapter — Orchestrator + main.ts wiring

**Files:**
- New: `src/adapters/slack/adapter.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create SlackAdapter**

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
    const channelId = await this.channelManager.create(slug);
    await this.channelManager.ensureBotJoined(channelId);
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

- [ ] **Step 2: Add Slack registration block to main.ts**

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

- [ ] **Step 3: Add SlackChannelConfig import to main.ts**

At the top of `src/main.ts`, add to existing config import:

```typescript
// Add SlackChannelConfig to the existing config import line
import type { SlackChannelConfig } from "./core/config.js";
```

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: Full compile, no errors.

- [ ] **Step 5: Smoke test — start without Slack config**

```bash
node dist/cli.js start
```

Expected: Starts normally, no Slack-related errors (Slack block skipped because `enabled: false` by default).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/slack/adapter.ts src/main.ts
git commit -m "feat(slack): add SlackAdapter orchestrator and register in main.ts"
```

---

## Task 9: Setup guide

**Files:**
- New: `src/adapters/slack/setup-guide.ts`

This module is invoked during `openacp setup` or `openacp setup --slack` to walk the user through creating a Slack App with the correct scopes.

- [ ] **Step 1: Create setup-guide.ts**

```typescript
// src/adapters/slack/setup-guide.ts
import { input, confirm } from "@inquirer/prompts";
import type { ConfigManager } from "../../core/config.js";

const REQUIRED_BOT_SCOPES = [
  "channels:manage",
  "groups:write",
  "groups:read",
  "chat:write",
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

- [ ] **Step 2: Plug into existing setup.ts**

In `src/core/setup.ts` (or wherever `openacp setup` is handled), add:

```typescript
// Inside setup flow, after Telegram:
const setupSlack = await confirm({ message: "Configure Slack adapter?" });
if (setupSlack) {
  const { runSlackSetup } = await import("../adapters/slack/setup-guide.js");
  await runSlackSetup(configManager);
}
```

- [ ] **Step 3: Build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

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

- [ ] **Step 1: slug.test.ts**

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

- [ ] **Step 2: formatter.test.ts**

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

- [ ] **Step 3: send-queue.test.ts**

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

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

Expected: All new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/slack/slug.test.ts src/adapters/slack/formatter.test.ts src/adapters/slack/send-queue.test.ts
git commit -m "test(slack): add unit tests for slug, formatter, send-queue"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full build**

```bash
pnpm build
```

Expected: Zero errors, zero warnings about missing types.

- [ ] **Step 2: Full test suite**

```bash
pnpm test
```

Expected: All tests pass (new + existing).

- [ ] **Step 3: Start without Slack enabled (regression check)**

```bash
node dist/cli.js start
```

Expected: Starts normally, Telegram adapter works, no Slack errors.

- [ ] **Step 4: Verify zero changes to core**

```bash
git diff HEAD~11 -- src/core/core.ts src/core/session.ts src/core/channel.ts src/adapters/telegram/
```

Expected: Empty diff — core and Telegram adapter unchanged.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(slack): complete Slack channel adapter (SOLID, channel-per-session, Socket Mode)"
```
