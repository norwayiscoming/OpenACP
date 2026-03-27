# Core Design

This document covers the core modules that form OpenACP's kernel -- the infrastructure that exists before any plugin loads.

---

## OpenACPCore

The main orchestrator. Routes messages between adapters and sessions, enforces security, and provides the service registry for plugin lookups.

```typescript
class OpenACPCore {
  constructor(opts: {
    configManager: ConfigManager
    serviceRegistry: ServiceRegistry
    lifecycleManager: LifecycleManager
    settingsManager: SettingsManager
    pluginRegistry: PluginRegistry
  })

  // Adapter management
  registerAdapter(name: string, adapter: IChannelAdapter): void
  getAdapter(name: string): IChannelAdapter | undefined

  // Message routing
  handleIncomingMessage(msg: IncomingMessage): Promise<void>

  // Session management (delegates to SessionManager)
  handleNewSession(channelId: string, userId: string, agentName?: string): Promise<void>
  cancelSession(sessionId: string): Promise<void>
  resolvePermission(sessionId: string, requestId: string, optionId: string): Promise<void>

  // Service lookups (lazy, via ServiceRegistry)
  get security(): SecurityService | undefined
  get fileService(): FileServiceInterface | undefined
  get notifications(): NotificationService | undefined
}
```

After the microkernel refactor, `OpenACPCore` no longer creates services directly. All services are registered by plugins during `setup()` and accessed through typed getters backed by the ServiceRegistry.

---

## Session and SessionManager

### SessionManager

Manages the lifecycle of all sessions. Handles creation, lookup, destruction, and enforces limits.

```typescript
class SessionManager {
  create(opts: SessionCreateOpts): Promise<Session>
  get(sessionId: string): Session | undefined
  getByThread(channelId: string, threadId: string): Session | undefined
  listActive(): Session[]
  destroy(sessionId: string, reason: string): Promise<void>
  destroyAll(): Promise<void>
}
```

### Session

Wraps an `AgentInstance` with:

- **Prompt queue** -- messages are processed serially, never in parallel
- **Auto-naming** -- after the first prompt, asks the agent to summarize the conversation into a short title
- **Lifecycle management** -- tracks state (idle, processing, waiting_permission, ended)

```typescript
class Session {
  readonly id: string
  readonly agentName: string
  state: SessionState  // 'idle' | 'processing' | 'waiting_permission' | 'ended'

  enqueuePrompt(text: string, attachments?: Attachment[]): Promise<void>
  cancel(reason?: string): Promise<void>
  destroy(): Promise<void>
}
```

Sessions emit events through the EventBus that plugins can subscribe to (e.g., `session:afterDestroy` for cleanup).

---

## AgentInstance

The bridge between OpenACP and an AI coding agent. Spawns the agent as a subprocess, communicates via the Agent Client Protocol (ACP), and converts ACP events into internal `AgentEvent` types.

```typescript
class AgentInstance {
  readonly sessionId: string

  prompt(text: string, attachments?: Attachment[]): Promise<void>
  cancel(): Promise<void>
  destroy(): Promise<void>

  // ACP event handling
  onPermissionRequest(handler: (request: PermissionRequest) => void): void
}
```

Key sub-managers extracted from AgentInstance:

- **TerminalManager** -- manages agent terminal/shell sessions
- **McpManager** -- handles MCP (Model Context Protocol) server connections
- **AuthHandler** -- handles agent authentication flows

---

## LifecycleManager

Orchestrates plugin boot and shutdown in dependency order.

### Boot

1. Receives list of discovered plugins (already topo-sorted)
2. For each plugin in order:
   - Check version mismatch with stored version -> call `migrate()` if needed
   - Validate settings against `settingsSchema`
   - Create `PluginContext` scoped to this plugin's permissions
   - Call `plugin.setup(ctx)` with a 30-second timeout
3. On failure: mark plugin as failed, cascade-skip all dependents
4. After all plugins: emit `system:commands-ready`, then `system:ready`

### Shutdown

1. Emit `system:shutdown`
2. 30-second grace period for in-flight prompts
3. Call `plugin.teardown()` in **reverse** dependency order (10s timeout each)
4. Auto-cleanup: remove event listeners, middleware, commands for each plugin
5. Cancel remaining sessions, destroy agent subprocesses
6. Clear ServiceRegistry, flush EventBus, save state

---

## ServiceRegistry

Central registry for service discovery. Plugins register services during `setup()`, and other plugins (or core) look them up by name.

```typescript
class ServiceRegistry {
  register<T>(name: string, implementation: T, pluginName: string): void
  get<T>(name: string): T | undefined
  has(name: string): boolean
  list(): Array<{ name: string; pluginName: string }>
  unregister(name: string): void
}
```

### Registration rules

| Scenario | Behavior |
|----------|----------|
| First registration for a name | Accept |
| Duplicate by built-in (no override) | Startup error -- must fix |
| Duplicate by community (no override) | Error -- community plugin skipped |
| Duplicate with `overrides` declared | Replace -- overridden plugin's setup() never called |
| `get()` before registration | Returns `undefined` |
| `get()` for required dependency's service | Guaranteed non-undefined (loaded in order) |

### Built-in service interfaces

All built-in plugins register services with typed interfaces. Community plugins that override or consume these must implement the same interface:

- `SecurityService` -- `checkAccess()`, `checkSessionLimit()`, `getUserRole()`
- `FileServiceInterface` -- `saveFile()`, `resolveFile()`, `readTextFileWithRange()`
- `NotificationService` -- `notify()`, `notifyAll()`
- `UsageService` -- `trackUsage()`, `checkBudget()`, `getSummary()`
- `SpeechServiceInterface` -- `textToSpeech()`, `speechToText()`
- `TunnelServiceInterface` -- `getPublicUrl()`, `isConnected()`, `start()`, `stop()`
- `ContextService` -- `buildContext()`, `registerProvider()`

---

## EventBus

In-memory typed event emitter. The communication backbone for inter-plugin messaging.

Plugins subscribe with `ctx.on()` (requires `events:read` permission) and emit with `ctx.emit()` (requires `events:emit` permission).

### System events

| Event | When |
|-------|------|
| `kernel:booted` | Core infrastructure initialized |
| `plugin:loaded` | A plugin completed setup() |
| `plugin:failed` | A plugin's setup() threw or timed out |
| `plugin:disabled` | A plugin was auto-disabled (error budget) |
| `system:commands-ready` | All commands registered, adapters can sync |
| `system:ready` | System fully operational |
| `system:shutdown` | Shutdown initiated |

Plugins can also emit custom events, but community plugins must prefix event names with their plugin name (e.g., `@community/translator:translated`).

---

## MiddlewareChain

Pipeline engine with 18 hook points covering every ACP interaction. Each hook has a typed payload.

```typescript
type MiddlewareFn<T> = (payload: T, next: () => Promise<T>) => Promise<T | null>
```

- Return `next()` -- pass through unchanged
- Return modified payload -- transform and continue
- Return `null` -- block/skip (stop the chain)

### Hook points

| Hook | Modifiable? | Purpose |
|------|------------|---------|
| `message:incoming` | Yes | Intercept user messages |
| `message:outgoing` | Yes | Modify messages before delivery |
| `agent:beforePrompt` | Yes | Transform prompts before sending to agent |
| `agent:beforeEvent` | Yes | Filter agent events |
| `agent:afterEvent` | Read-only | Observe agent events |
| `turn:start` | Read-only | Track turn starts |
| `turn:end` | Read-only | Track turn completions |
| `fs:beforeRead` | Yes | Control file reads |
| `fs:beforeWrite` | Yes | Control file writes |
| `terminal:beforeCreate` | Yes | Control process spawning |
| `terminal:afterExit` | Read-only | Observe process exits |
| `permission:beforeRequest` | Yes | Auto-resolve permissions |
| `permission:afterResolve` | Read-only | Observe permission decisions |
| `session:beforeCreate` | Yes | Control session creation |
| `session:afterDestroy` | Read-only | Observe session cleanup |
| `mode:beforeChange` | Yes | Control mode changes |
| `model:beforeChange` | Yes | Control model selection |
| `config:beforeChange` | Yes | Control config changes |

### Execution order

1. **Base order**: topological sort -- plugins loaded earlier run their middleware first
2. **Priority override**: reorders within the same dependency level only (priority cannot violate dependency order)
3. **Same level + same priority**: registration order

Each handler has a 5-second timeout. Timeout or error skips the handler, passes the original payload to the next handler, and increments the plugin's error budget.

---

## ConfigManager

Zod-validated configuration from `~/.openacp/config.json`. After the plugin refactor, config.json contains **core settings only**:

```json
{
  "defaultAgent": "claude-code",
  "workspace": { "baseDir": "~/openacp-workspace" },
  "security": { "allowedUserIds": ["123"], "maxConcurrentSessions": 3 },
  "logging": { "level": "info" },
  "runMode": "foreground"
}
```

Plugin-specific settings live in per-plugin `settings.json` files under `~/.openacp/plugins/@scope/name/settings.json`, managed by the SettingsManager.

---

## MessageTransformer

Converts ACP `AgentEvent` objects into `OutgoingMessage` types that adapters can render. Decoupled from plugins -- uses ServiceRegistry for optional enrichment (e.g., tunnel URLs for file viewer links).

```typescript
class MessageTransformer {
  constructor(private serviceRegistry?: ServiceRegistry)

  transform(event: AgentEvent): OutgoingMessage
}
```

The transformer produces `OutgoingMessage` with types: `text`, `thought`, `tool_call`, `tool_update`, `plan`, `usage`, `session_end`, `error`, `attachment`, `system_message`.

---

## Adapter Primitives

Shared framework in `src/core/adapter-primitives/` that adapter plugins build on:

- **MessagingAdapter** -- base class for Telegram/Discord/Slack with drafts, queues, rate limiting, tool tracking. Subclasses implement `send()`, `editMessage()`, and platform-specific rendering.
- **StreamAdapter** -- lightweight base for WebSocket/API transports. Just `emit()` and `broadcast()`.
- **IRenderer + BaseRenderer** -- separates rendering logic from adapter logic. Each platform provides its own renderer (HTML for Telegram, Markdown+Embeds for Discord, Block Kit for Slack).
- **DraftManager** -- buffers text chunks and sends periodic batch updates
- **SendQueue** -- rate-limited message queue with per-category intervals
- **ToolCallTracker** -- tracks tool calls to enable message editing on status updates
- **ActivityTracker** -- manages thinking indicators

```
IChannelAdapter (thin interface)
  |
  +-- MessagingAdapter (rich base class)
  |     +-- TelegramAdapter
  |     +-- DiscordAdapter
  |     +-- SlackAdapter
  |
  +-- StreamAdapter (lightweight base)
        +-- WebSocketAdapter (future)
        +-- APIAdapter (future)
```

---

## Further Reading

- [Architecture Overview](README.md) -- high-level picture
- [Plugin System](plugin-system.md) -- complete plugin infrastructure
- [Command System](command-system.md) -- how chat commands work
