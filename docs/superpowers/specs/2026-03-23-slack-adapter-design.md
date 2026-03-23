# Slack Channel Adapter Design

**Date:** 2026-03-23
**Scope:** `src/adapters/slack/` — new channel adapter for Slack workspaces
**Approach:** SOLID-first, channel-per-session threading, Socket Mode event delivery
**Constraint:** Zero changes to core modules. External behavior of existing adapters preserved.

---

## Problem Statement

OpenACP currently only supports Telegram as a channel. Adding Slack opens the platform to enterprise/team workspaces where Telegram is uncommon. The implementation must:

1. **Not touch core** — `OpenACPCore`, `Session`, `AgentInstance`, `SessionBridge` stay unchanged
2. **Not touch Telegram adapter** — no shared-state coupling between adapters
3. **Be extensible internally** — SOLID principles so future adapters (Discord, Teams...) can learn from this pattern
4. **Handle Slack-specific constraints** correctly — rate limits, channel naming, interactive payloads, OAuth scopes

---

## Architecture Decision Record

### ADR-1: Channel per Session (not Thread replies)

Each OpenACP session maps to a dedicated Slack **channel** (private, bot-managed).

**Rationale:**
- Threads in Slack are secondary UI — easy to miss, no rename API, hard to navigate across sessions
- Channels are first-class citizens: renameable, navigable from sidebar, archivable
- Maps cleanly to `createSessionThread` / `renameSessionThread` / `deleteSessionThread` in `ChannelAdapter`

**Trade-offs:**
- Requires `channels:manage` / `groups:write` OAuth scopes
- Channels accumulate — `deleteSessionThread` archives (not deletes) due to Slack API limitation
- Channel names must be slugified (Slack rule: lowercase, ≤80 chars, no spaces/special chars)
- Bot must self-join after creation (2 API calls instead of 1)

**Convention:** Use private channels (`conversations.create` with `is_private: true`) to avoid cluttering the workspace's public channel list.

### ADR-2: Socket Mode for Event Delivery

Use `@slack/bolt` with Socket Mode (WebSocket) instead of Events API (HTTP webhook).

**Rationale:**
- OpenACP runs locally — no public URL guaranteed
- Socket Mode requires no tunnel setup (unlike Events API)
- Consistent with Telegram's long-polling model — no inbound HTTP required
- Tunnel feature exists but is optional; Socket Mode keeps Slack setup self-contained

**Trade-off:** Requires `connections:write` scope and an App-level token (separate from bot token).

### ADR-3: SOLID Internal Structure

`SlackAdapter` is the thin orchestrator. All concerns are extracted into focused, injectable classes — mirroring the Telegram refactor design but applied from the start.

---

## Module Structure

```
src/adapters/slack/
  adapter.ts              — SlackAdapter (orchestrator, ~200 lines)
  types.ts                — SlackChannelConfig, SlackSessionMeta
  channel-manager.ts      — ISlackChannelManager + impl (create, rename, archive, join)
  formatter.ts            — ISlackFormatter + impl (Block Kit builder)
  send-queue.ts           — SlackSendQueue (per-method rate limiting)
  permission-handler.ts   — SlackPermissionHandler (interactive components)
  event-router.ts         — SlackEventRouter (Bolt event → IncomingMessage)
  slug.ts                 — Channel name slugifier utility
  setup-guide.ts          — CLI setup wizard for Slack App creation (OAuth scopes, tokens)
```

---

## Design

### 1. Interfaces (Dependency Inversion)

Define interfaces for all major dependencies so `SlackAdapter` depends on abstractions, not concretions.

```ts
// channel-manager.ts
export interface ISlackChannelManager {
  create(name: string): Promise<string>;          // returns channelId
  rename(channelId: string, name: string): Promise<void>;
  archive(channelId: string): Promise<void>;
  ensureBotJoined(channelId: string): Promise<void>;
  getNotificationChannelId(): string;
}

// formatter.ts
export interface ISlackFormatter {
  formatOutgoing(message: OutgoingMessage): Block[];
  formatPermissionRequest(request: PermissionRequest): Block[];
  formatNotification(text: string): Block[];
  formatSessionEnd(reason?: string): Block[];
}

// send-queue.ts
export interface ISlackSendQueue {
  enqueue(method: SlackMethod, params: Record<string, unknown>): Promise<unknown>;
}
```

### 2. SlackAdapter — Thin Orchestrator

```ts
export class SlackAdapter extends ChannelAdapter {
  constructor(
    core: OpenACPCore,
    private config: SlackChannelConfig,
    private app: App,                              // @slack/bolt App instance
    private channelManager: ISlackChannelManager,
    private formatter: ISlackFormatter,
    private sendQueue: ISlackSendQueue,
    private permissionHandler: SlackPermissionHandler,
    private eventRouter: SlackEventRouter,
  ) {
    super(core);
  }

  // --- ChannelAdapter abstract methods ---

  async sendMessage(threadId: string, message: OutgoingMessage): Promise<void> {
    const blocks = this.formatter.formatOutgoing(message);
    if (!blocks.length) return;
    await this.sendQueue.enqueue('chat.postMessage', {
      channel: threadId,
      blocks,
      text: this.fallbackText(message),           // required for notifications
    });
  }

  async sendPermissionRequest(threadId: string, req: PermissionRequest): Promise<void> {
    await this.permissionHandler.send(threadId, req);
  }

  async sendNotification(text: string): Promise<void> {
    const blocks = this.formatter.formatNotification(text);
    await this.sendQueue.enqueue('chat.postMessage', {
      channel: this.channelManager.getNotificationChannelId(),
      blocks,
      text,
    });
  }

  async createSessionThread(channelId: string, label: string): Promise<string> {
    const slug = toSlug(label);                    // "New Session" → "openacp-new-session-a3k9"
    const newChannelId = await this.channelManager.create(slug);
    await this.channelManager.ensureBotJoined(newChannelId);
    return newChannelId;
  }

  async renameSessionThread(threadId: string, name: string): Promise<void> {
    await this.channelManager.rename(threadId, toSlug(name));
  }

  async deleteSessionThread(threadId: string): Promise<void> {
    await this.channelManager.archive(threadId);   // Slack API cannot delete channels
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    this.eventRouter.register(this.app);
    this.permissionHandler.register(this.app);
    await this.app.start();
    await this.sendNotification('✅ OpenACP online');
  }

  async stop(): Promise<void> {
    await this.sendNotification('🛑 OpenACP shutting down');
    await this.app.stop();
  }
}
```

### 3. SlackChannelManager — Single Responsibility: Channel CRUD

```ts
export class SlackChannelManager implements ISlackChannelManager {
  constructor(
    private client: WebClient,
    private config: SlackChannelConfig,
  ) {}

  async create(slug: string): Promise<string> {
    const res = await this.client.conversations.create({
      name: slug,
      is_private: true,
    });
    return res.channel!.id!;
  }

  async rename(channelId: string, slug: string): Promise<void> {
    await this.client.conversations.rename({
      channel: channelId,
      name: slug,
    });
  }

  async archive(channelId: string): Promise<void> {
    await this.client.conversations.archive({ channel: channelId });
  }

  async ensureBotJoined(channelId: string): Promise<void> {
    await this.client.conversations.join({ channel: channelId });
  }

  getNotificationChannelId(): string {
    return this.config.notificationChannelId;
  }
}
```

### 4. SlackFormatter — Single Responsibility: Block Kit

Slack does not support HTML. All formatting uses Block Kit (JSON blocks).

```ts
export class SlackFormatter implements ISlackFormatter {
  formatOutgoing(message: OutgoingMessage): Block[] {
    switch (message.type) {
      case 'text':       return this.text(message.text);
      case 'thought':    return this.thought(message.text);
      case 'tool_call':  return this.toolCall(message);
      case 'tool_update':return this.toolUpdate(message);
      case 'plan':       return this.plan(message.text);
      case 'usage':      return this.usage(message);
      case 'session_end':return this.sessionEnd(message.text);
      case 'error':      return this.error(message.text);
      default:           return [];
    }
  }

  private text(t: string): Block[] {
    // Split at 3000-char Slack limit, never inside code fences
    return splitSafe(t).map(chunk => ({
      type: 'section',
      text: { type: 'mrkdwn', text: chunk },
    }));
  }

  private toolCall(msg: OutgoingMessage): Block[] {
    return [{
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🔧 \`${msg.metadata?.name}\`` }],
    }];
  }

  formatPermissionRequest(req: PermissionRequest): Block[] {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `🔐 *Permission Request*\n${req.description}` },
      },
      {
        type: 'actions',
        block_id: `perm_${req.id}`,
        elements: req.options.map(opt => ({
          type: 'button',
          text: { type: 'plain_text', text: opt.label },
          value: `${req.id}:${opt.id}`,
          action_id: `perm_action_${opt.id}`,
          style: opt.isAllow ? 'primary' : 'danger',
        })),
      },
    ];
  }

  formatNotification(text: string): Block[] {
    return [{ type: 'section', text: { type: 'mrkdwn', text } }];
  }

  formatSessionEnd(reason?: string): Block[] {
    return [{ type: 'divider' }, {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `✅ Session ended${reason ? ` — ${reason}` : ''}` }],
    }];
  }
}
```

### 5. SlackSendQueue — Per-Method Rate Limiting

Slack rate limits by API method tier, not globally. Each method has its own quota.

```ts
type SlackMethod = 'chat.postMessage' | 'conversations.create' | 'conversations.rename' | 'conversations.archive' | 'conversations.join';

// Slack Tier definitions (requests/minute)
const METHOD_TIERS: Record<SlackMethod, number> = {
  'chat.postMessage':     50,   // Tier 3
  'conversations.create': 20,   // Tier 2
  'conversations.rename': 20,   // Tier 2
  'conversations.archive': 20,  // Tier 2
  'conversations.join':   20,   // Tier 2
};

export class SlackSendQueue implements ISlackSendQueue {
  private queues: Map<SlackMethod, PQueue> = new Map();

  constructor(private client: WebClient) {
    for (const [method, rpm] of Object.entries(METHOD_TIERS)) {
      // interval: 60_000ms / rpm to spread evenly
      this.queues.set(method as SlackMethod, new PQueue({
        interval: Math.ceil(60_000 / rpm),
        intervalCap: 1,
      }));
    }
  }

  async enqueue(method: SlackMethod, params: Record<string, unknown>): Promise<unknown> {
    const queue = this.queues.get(method)!;
    return queue.add(() => (this.client.apiCall as Function)(method, params));
  }
}
```

> **Note:** Uses `p-queue` for per-method throttling. On HTTP 429, Bolt's built-in retry handler kicks in as a second defense layer.

### 6. SlackEventRouter — Single Responsibility: Route Bolt Events → Core

```ts
export class SlackEventRouter {
  constructor(
    private core: OpenACPCore,
    private config: SlackChannelConfig,
  ) {}

  register(app: App): void {
    // New message in a session channel
    app.message(async ({ message, say }) => {
      if (!this.isAllowedUser(message.user)) return;
      if (message.channel_type !== 'group') return;  // private channel
      if (message.bot_id) return;                     // ignore bot messages

      await this.core.handleMessage({
        channelId: 'slack',
        threadId: message.channel,
        userId: message.user,
        text: (message as any).text ?? '',
      });
    });

    // Slash command: /new
    app.command('/openacp-new', async ({ ack, body }) => {
      await ack();
      if (!this.isAllowedUser(body.user_id)) return;
      await this.core.handleNewSession({
        channelId: 'slack',
        userId: body.user_id,
        threadId: body.channel_id,   // reply in current channel initially
      });
    });

    // Slash command: /cancel
    app.command('/openacp-cancel', async ({ ack, body }) => {
      await ack();
      await this.core.handleMessage({
        channelId: 'slack',
        threadId: body.channel_id,
        userId: body.user_id,
        text: '/cancel',
      });
    });
  }

  private isAllowedUser(userId?: string): boolean {
    const allowed = this.config.allowedUserIds;
    if (!allowed?.length) return true;
    return !!userId && allowed.includes(userId);
  }
}
```

### 7. SlackPermissionHandler — Interactive Components

Slack interactive payloads route through a separate Bolt action handler (unlike Telegram callback_query which flows through the same bot middleware).

```ts
export class SlackPermissionHandler {
  private pending: Map<string, (optionId: string) => void> = new Map();

  constructor(private sendQueue: ISlackSendQueue) {}

  register(app: App): void {
    // Match all permission action IDs with prefix "perm_action_"
    app.action(/^perm_action_/, async ({ action, ack, body }) => {
      await ack();
      const btn = action as ButtonAction;
      const [requestId, optionId] = btn.value.split(':');
      const resolve = this.pending.get(requestId);
      if (resolve) {
        resolve(optionId);
        this.pending.delete(requestId);
        // Remove buttons from the original message
        await this.removeButtons(body);
      }
    });
  }

  async send(channelId: string, req: PermissionRequest): Promise<void> {
    const formatter = new SlackFormatter();
    await this.sendQueue.enqueue('chat.postMessage', {
      channel: channelId,
      blocks: formatter.formatPermissionRequest(req),
      text: `Permission request: ${req.description}`,
    });
    // Register callback for when user responds
    return new Promise<void>(resolve => {
      this.pending.set(req.id, (_optionId) => resolve());
    });
  }

  private async removeButtons(body: BlockAction): Promise<void> {
    // Edit the original message to replace actions block with a "responded" context
    // Uses body.message.ts + body.channel.id to identify the message
  }
}
```

### 8. Slug Utility

```ts
// slug.ts
export function toSlug(name: string, suffix?: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // remove special chars
    .trim()
    .replace(/\s+/g, '-')            // spaces → dashes
    .replace(/-+/g, '-')             // collapse dashes
    .slice(0, 70);                   // Slack max: 80, leave room for suffix

  const sfx = suffix ?? nanoid(4);  // collision-resistant suffix
  return `${base}-${sfx}`;
}

// Examples:
// "Fix auth bug" → "fix-auth-bug-a3k9"
// "New Session"  → "new-session-x7p2"
// "Implement OAuth 2.0 & JWT refresh" → "implement-oauth-20-jwt-refresh-b8qr"
```

---

## Config Schema

Added to Zod config schema in `config.ts`. All fields have `.default()` or `.optional()` for backward compatibility.

```ts
const SlackChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  adapter: z.literal('slack').optional(),            // plugin adapter marker

  // Auth — from Slack App dashboard
  botToken: z.string().optional(),                   // xoxb-...
  appToken: z.string().optional(),                   // xapp-... (Socket Mode)
  signingSecret: z.string().optional(),              // for request verification

  // Workspace setup
  notificationChannelId: z.string().optional(),      // pre-existing #openacp-notifications

  // Security (mirrors core security but per-channel)
  allowedUserIds: z.array(z.string()).default([]),   // Slack member IDs (U...)

  // Channel naming prefix
  channelPrefix: z.string().default('openacp'),      // e.g. "openacp-fix-auth-bug-a3k9"
});
```

**Config example (`~/.openacp/config.json`):**

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "signingSecret": "...",
      "notificationChannelId": "C0123456789",
      "allowedUserIds": ["U0123456789"],
      "channelPrefix": "openacp"
    }
  }
}
```

---

## main.ts — Registration (Zero Impact)

Only additive change. Existing Telegram registration is untouched.

```ts
// main.ts
if (config.channels.slack?.enabled) {
  const slackCfg = config.channels.slack as SlackChannelConfig;

  const boltApp = new App({
    token: slackCfg.botToken,
    appToken: slackCfg.appToken,
    socketMode: true,
  });

  const client = boltApp.client;
  const sendQueue = new SlackSendQueue(client);
  const channelManager = new SlackChannelManager(client, slackCfg);
  const formatter = new SlackFormatter();
  const permissionHandler = new SlackPermissionHandler(sendQueue);
  const eventRouter = new SlackEventRouter(core, slackCfg);

  const slackAdapter = new SlackAdapter(
    core, slackCfg, boltApp,
    channelManager, formatter, sendQueue, permissionHandler, eventRouter,
  );

  core.registerAdapter('slack', slackAdapter);
}
```

---

## Known Constraints & Mitigations

### Channel archiving — not deletion

Slack API does not allow channel deletion via API (only through UI). `deleteSessionThread` archives the channel instead. Over time this accumulates.

**Mitigation:** Add a cleanup command (`openacp slack:cleanup`) that archives channels older than N days in bulk. Run periodically or on demand.

### Channel name collisions

`toSlug` appends a 4-char nanoid suffix to all generated names. Probability of collision for 1M channels is ~0.002% — acceptable without a uniqueness check loop.

**Fallback:** If `conversations.create` fails with `name_taken`, regenerate suffix and retry once.

### No channel deletion means `sessionStore` diverges

When a session's channel is archived (on session end), the session record in store still has a `threadId` pointing to an archived channel. On lazy resume, posting to an archived channel will fail.

**Mitigation:** In `SlackAdapter.createSessionThread`, check if the channel is archived before posting. If archived, unarchive first (or create a new channel and update the session record's threadId).

### Interactive payload endpoint

Bolt handles Slack interactive payloads (button clicks) via its own internal router in Socket Mode — no separate HTTP endpoint needed. This is transparent in Socket Mode. If switching to Events API later, Hono API server must add `/slack/interactions` route and call `app.processEvent()`.

### OAuth scopes required

The Slack App must be configured with these bot token scopes:

| Scope | Purpose |
|---|---|
| `channels:manage` | Create/rename/archive public channels |
| `groups:write` | Create/rename/archive private channels |
| `groups:read` | List private channels |
| `chat:write` | Post messages |
| `commands` | Register slash commands |
| `connections:write` | Socket Mode (App-level token scope) |

And these app-level token scopes (for Socket Mode):
| Scope | Purpose |
|---|---|
| `connections:write` | Open WebSocket connection |

---

## SOLID Compliance Summary

| Principle | Application |
|---|---|
| **S** — Single Responsibility | 7 focused classes, each ≤200 lines. `adapter.ts` is orchestrator only. |
| **O** — Open/Closed | `SlackAdapter extends ChannelAdapter` — core closed for modification, Slack open for extension. Internal classes use interfaces so implementations are swappable. |
| **L** — Liskov Substitution | `SlackAdapter` correctly implements all `ChannelAdapter` abstract methods. `sendSkillCommands` / `cleanupSkillCommands` are no-ops (valid — optional methods). |
| **I** — Interface Segregation | `ISlackChannelManager`, `ISlackFormatter`, `ISlackSendQueue` each cover exactly one concern. `SlackAdapter` constructor only depends on what it uses. |
| **D** — Dependency Inversion | `SlackAdapter` depends on interfaces, not concrete classes. `main.ts` wires the concrete implementations — classic composition root pattern. |

---

## Implementation Order

| Step | Task | Files |
|---|---|---|
| 1 | Slug utility + unit tests | `slug.ts`, `slug.test.ts` |
| 2 | `ISlackFormatter` + `SlackFormatter` | `formatter.ts`, `formatter.test.ts` |
| 3 | `ISlackSendQueue` + `SlackSendQueue` | `send-queue.ts`, `send-queue.test.ts` |
| 4 | `ISlackChannelManager` + `SlackChannelManager` | `channel-manager.ts` |
| 5 | `SlackPermissionHandler` | `permission-handler.ts` |
| 6 | `SlackEventRouter` | `event-router.ts` |
| 7 | `SlackAdapter` + wire in `main.ts` | `adapter.ts`, `types.ts`, `main.ts` |
| 8 | Config schema update | `config.ts` (+5 lines Zod) |
| 9 | Setup wizard | `setup-guide.ts`, update `setup.ts` |
| 10 | Integration test (mocked Bolt) | `adapter.test.ts` |

---

## Files

| File | Action | Notes |
|---|---|---|
| `src/adapters/slack/adapter.ts` | **New** | ~200 lines, thin orchestrator |
| `src/adapters/slack/types.ts` | **New** | `SlackChannelConfig`, `SlackSessionMeta` |
| `src/adapters/slack/channel-manager.ts` | **New** | `ISlackChannelManager` + impl |
| `src/adapters/slack/formatter.ts` | **New** | `ISlackFormatter` + Block Kit impl |
| `src/adapters/slack/send-queue.ts` | **New** | Per-method rate limiter |
| `src/adapters/slack/permission-handler.ts` | **New** | Interactive components |
| `src/adapters/slack/event-router.ts` | **New** | Bolt event → `core.handleMessage` |
| `src/adapters/slack/slug.ts` | **New** | Channel name slugifier |
| `src/adapters/slack/setup-guide.ts` | **New** | Interactive setup wizard |
| `src/core/config.ts` | **Minor** | +`SlackChannelConfigSchema` (~20 lines) |
| `src/main.ts` | **Minor** | +Slack adapter registration (~20 lines) |
| `src/core/channel.ts` | **No change** | Abstract base unchanged |
| `src/core/core.ts` | **No change** | |
| `src/core/session.ts` | **No change** | |
| `src/adapters/telegram/` | **No change** | |

**New dependency:** `@slack/bolt` — official Slack framework.

---

## Testing Strategy

- **Unit tests per class** — all testable without a real Slack workspace
  - `slug.test.ts` — edge cases: unicode, long names, special chars
  - `formatter.test.ts` — each `OutgoingMessage` type → correct Block Kit JSON
  - `send-queue.test.ts` — verify per-method throttling, queue isolation
- **Integration test** — mock `@slack/bolt` App, assert `core.handleMessage` called correctly
- **No tests needed in core** — no core changes
