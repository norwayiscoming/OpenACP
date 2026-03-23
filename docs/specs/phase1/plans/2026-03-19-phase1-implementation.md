# OpenACP Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Telegram bot that bridges messaging to AI coding agents via ACP protocol.

**Architecture:** Monorepo with `@openacp/core` (abstract channel adapter, session/agent managers, ACP SDK integration) and `@openacp/adapter-telegram` (grammy bot, forum topics, streaming). Core spawns ACP agent subprocesses, communicates via JSON-RPC over stdio using `@agentclientprotocol/sdk`.

**Tech Stack:** TypeScript, Node.js, pnpm workspace, @agentclientprotocol/sdk, grammy, Zod, nanoid

**Spec:** `docs/specs/phase1/`

---

## File Map

### packages/core/

| File | Responsibility |
|------|----------------|
| `package.json` | Package config, dependencies |
| `tsconfig.json` | TypeScript config extending base |
| `src/types.ts` | All shared interfaces/types |
| `src/log.ts` | Simple logger utility |
| `src/config.ts` | ConfigManager + Zod schema + workspace resolution |
| `src/channel.ts` | ChannelAdapter abstract class |
| `src/streams.ts` | Node→Web stream converters |
| `src/stderr-capture.ts` | StderrCapture for agent crash diagnostics |
| `src/formatting.ts` | Shared markdown utilities (used by adapters) |
| `src/agent-instance.ts` | AgentInstance (ACP SDK ClientSideConnection wrapper) |
| `src/agent-manager.ts` | AgentManager (spawn, list, get agents) |
| `src/session.ts` | Session class (prompt queue, auto-name) |
| `src/session-manager.ts` | SessionManager (CRUD sessions, lookup by thread) |
| `src/notification.ts` | NotificationManager |
| `src/core.ts` | OpenACPCore orchestrator (wire everything, message/event routing) |
| `src/main.ts` | CLI entry point (load config, register adapters, start, shutdown) |
| `src/index.ts` | Public API exports |

### packages/adapters/telegram/

| File | Responsibility |
|------|----------------|
| `package.json` | Package config, dependencies |
| `tsconfig.json` | TypeScript config extending base |
| `src/formatting.ts` | Markdown→HTML, escapeHtml, formatToolCall, formatPlan, splitMessage |
| `src/streaming.ts` | MessageDraft class (accumulate text, throttled send/edit) |
| `src/topics.ts` | Topic creation, renaming, ensure auto-created topics |
| `src/commands.ts` | Bot command handlers (/new, /newchat, /cancel, /status, /agents, /help) |
| `src/permissions.ts` | Permission request UI + callback query handling |
| `src/assistant.ts` | Assistant topic: spawn agent, system prompt, message handling |
| `src/adapter.ts` | TelegramAdapter extends ChannelAdapter (sendMessage, routing) |
| `src/types.ts` | Telegram-specific types (TelegramChannelConfig, etc.) |
| `src/index.ts` | Public export |

### Root

| File | Responsibility |
|------|----------------|
| `package.json` | pnpm workspace root |
| `pnpm-workspace.yaml` | Workspace packages list |
| `tsconfig.base.json` | Shared TypeScript config |
| `.gitignore` | Node/TS ignores |

---

## Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/adapters/telegram/package.json`
- Create: `packages/adapters/telegram/tsconfig.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "openacp",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm --filter @openacp/core dev",
    "start": "node packages/core/dist/main.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/core"
  - "packages/adapters/*"
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
.env
```

- [ ] **Step 5: Create packages/core/package.json**

```json
{
  "name": "@openacp/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "openacp": "dist/main.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@agentclientprotocol/sdk": "^0.16.0",
    "nanoid": "^5.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 6: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create packages/adapters/telegram/package.json**

```json
{
  "name": "@openacp/adapter-telegram",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@openacp/core": "workspace:*",
    "grammy": "^1.30.0",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 8: Create packages/adapters/telegram/tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Install dependencies**

Run: `pnpm install`
Expected: lockfile created, node_modules populated

- [ ] **Step 10: Verify build works**

Create empty `packages/core/src/index.ts` (just `export {}`) and `packages/adapters/telegram/src/index.ts` (same).

Run: `pnpm build`
Expected: dist/ folders created with .js and .d.ts files

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with core and telegram adapter packages"
```

---

## Task 2: Core Types & Logger

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/log.ts`

- [ ] **Step 1: Create types.ts with all shared interfaces**

See spec `03-core-modules.md` "Types" section. Export all interfaces:
`IncomingMessage`, `OutgoingMessage`, `PermissionRequest`, `PermissionOption`, `NotificationMessage`, `AgentEvent`, `PlanEntry`, `AgentDefinition`, `SessionStatus`.

- [ ] **Step 2: Create log.ts**

Simple logger per spec `05-startup-and-errors.md` "Logging" section. Four methods: `info`, `warn`, `error`, `debug` (debug gated by `OPENACP_DEBUG` env).

- [ ] **Step 3: Update index.ts to export types**

```typescript
export * from './types.js'
export { log } from './log.js'
```

- [ ] **Step 4: Build and verify**

Run: `pnpm build`
Expected: compiles cleanly

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/log.ts packages/core/src/index.ts
git commit -m "feat(core): add shared types and logger"
```

---

## Task 3: ConfigManager

**Files:**
- Create: `packages/core/src/config.ts`

- [ ] **Step 1: Create config.ts with Zod schema**

Implement `ConfigSchema` per spec `03-core-modules.md`. Include:
- Zod schema with defaults
- `Config` type inference
- `expandHome()` helper (replace `~` with `os.homedir()`)

- [ ] **Step 2: Implement ConfigManager class**

Methods per spec:
- `load()` — resolve path, read JSON, apply env overrides, validate
- `get()` — return config
- `save(updates)` — merge, validate, write
- `resolveWorkspace(input?)` — workspace resolution logic

Handle default config generation when file missing (per `05-startup-and-errors.md`).

- [ ] **Step 3: Add env var override logic**

Map: `OPENACP_TELEGRAM_BOT_TOKEN` → `channels.telegram.botToken`, etc.
Apply before Zod validation.

- [ ] **Step 4: Export from index.ts**

Add `export { ConfigManager } from './config.js'`

- [ ] **Step 5: Build and verify**

Run: `pnpm build`
Expected: compiles cleanly

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/index.ts
git commit -m "feat(core): add ConfigManager with Zod validation and workspace resolution"
```

---

## Task 4: ChannelAdapter & NotificationManager

**Files:**
- Create: `packages/core/src/channel.ts`
- Create: `packages/core/src/notification.ts`

- [ ] **Step 1: Create channel.ts with ChannelAdapter abstract class**

Per spec `03-core-modules.md` "ChannelAdapter" section. Abstract methods:
`start`, `stop`, `sendMessage`, `sendPermissionRequest`, `sendNotification`, `createSessionThread`, `renameSessionThread`.

- [ ] **Step 2: Create notification.ts with NotificationManager**

Per spec. Methods: `notify(channelId, notification)`, `notifyAll(notification)`.

- [ ] **Step 3: Export from index.ts**

- [ ] **Step 4: Build and verify**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel.ts packages/core/src/notification.ts packages/core/src/index.ts
git commit -m "feat(core): add ChannelAdapter abstract class and NotificationManager"
```

---

## Task 5: Stream Helpers & StderrCapture

**Files:**
- Create: `packages/core/src/streams.ts`
- Create: `packages/core/src/stderr-capture.ts`

- [ ] **Step 1: Create streams.ts**

Per spec `02-acp-integration.md` "Stream Helpers" section.
Functions: `nodeToWebWritable(Writable)`, `nodeToWebReadable(Readable)`.

- [ ] **Step 2: Create stderr-capture.ts**

Per spec `02-acp-integration.md` "StderrCapture" section.
Class with `append(chunk)` and `getLastLines()`. Caps at `maxLines` (default 50).

- [ ] **Step 3: Export from index.ts**

- [ ] **Step 4: Build and verify**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/streams.ts packages/core/src/stderr-capture.ts packages/core/src/index.ts
git commit -m "feat(core): add Node-to-Web stream converters and StderrCapture"
```

---

## Task 6a: AgentInstance — Shell & Spawn

**Files:**
- Create: `packages/core/src/agent-instance.ts`

- [ ] **Step 1: Create AgentInstance class shell**

Class with properties per spec `02-acp-integration.md`:
- `connection`, `child`, `stderrCapture`, `sessionId`, `agentName`
- `terminals` Map
- `onSessionUpdate` and `onPermissionRequest` callbacks

- [ ] **Step 2: Implement static spawn() method**

Per spec. Steps:
1. `child_process.spawn` with stdio pipes + shell
2. Wire stderr to StderrCapture
3. `nodeToWebWritable`/`nodeToWebReadable` → `ndJsonStream` (note: first arg is writable TO agent, second is readable FROM agent)
4. `new ClientSideConnection(callback, stream)`
5. `connection.initialize()` with capabilities
6. `connection.newSession({ cwd, mcpServers: [] })`

- [ ] **Step 3: Implement prompt(), cancel(), destroy()**

Per spec. `prompt()` calls `connection.prompt()`. `destroy()` kills terminals + child process with SIGTERM→SIGKILL timeout.

- [ ] **Step 4: Add subprocess crash detection**

Per spec `05-startup-and-errors.md`:
- `child.on('exit')` → emit error event with stderr
- `connection.closed.then()` → detect connection loss

- [ ] **Step 5: Export from index.ts, build and verify**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent-instance.ts packages/core/src/index.ts
git commit -m "feat(core): add AgentInstance shell with spawn and lifecycle methods"
```

---

## Task 6b: AgentInstance — ACP Client Callbacks

**Files:**
- Modify: `packages/core/src/agent-instance.ts`

- [ ] **Step 1: Implement createClient() — session update & permission callbacks**

- `sessionUpdate` → call `convertSessionUpdate()` → `onSessionUpdate()`
- `requestPermission` → convert to `PermissionRequest` → call `onPermissionRequest()` → return `{ outcome: { outcome: 'selected', optionId } }` (note: discriminant is `outcome`, NOT `type`)

- [ ] **Step 2: Implement createClient() — file operations**

- `readTextFile` → `fs.promises.readFile`
- `writeTextFile` → `fs.promises.mkdir` (ensure dir) + `fs.promises.writeFile`

- [ ] **Step 3: Implement createClient() — terminal operations**

- `createTerminal` → `child_process.spawn` + track in `terminals` Map (1MB output cap)
- `terminalOutput`, `waitForTerminalExit`, `killTerminal`, `releaseTerminal`

- [ ] **Step 4: Implement convertSessionUpdate()**

Per spec. Switch on `update.sessionUpdate`. Important: fields are at TOP LEVEL (e.g., `update.toolCallId`, NOT `update.toolCall.toolCallId`):
- `agent_message_chunk` → `{ type: 'text' }`
- `agent_thought_chunk` → `{ type: 'thought' }`
- `tool_call` → `{ type: 'tool_call' }`
- `tool_call_update` → `{ type: 'tool_update' }`
- `plan` → `{ type: 'plan' }`
- `usage_update` → `{ type: 'usage' }`
- `available_commands_update` → `{ type: 'commands_update' }`

- [ ] **Step 5: Build and verify**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent-instance.ts
git commit -m "feat(core): add ACP client callbacks - session updates, permissions, file ops, terminals"
```

---

## Task 7: AgentManager & SessionManager

**Files:**
- Create: `packages/core/src/agent-manager.ts`
- Create: `packages/core/src/session.ts`
- Create: `packages/core/src/session-manager.ts`

- [ ] **Step 1: Create agent-manager.ts**

Per spec `03-core-modules.md` "AgentManager" section.
Methods: `getAvailableAgents()`, `getAgent(name)`, `spawn(agentName, workingDirectory)`.

- [ ] **Step 2: Create session.ts — Session class**

Per spec. Properties: `id`, `channelId`, `threadId`, `agentName`, `workingDirectory`, `agentInstance`, `status`, `name`, `promptQueue`, `promptRunning`, `createdAt`, `pendingPermission`.

Methods: `enqueuePrompt(text)`, `runPrompt(text)` (private), `autoName()` (private), `cancel()`, `destroy()`.

Session needs a reference to the adapter for `renameSessionThread`. Add `adapter?: ChannelAdapter` property, set by `wireSessionEvents` in OpenACPCore.

Key behaviors:
- Prompt queue: if `promptRunning`, push to queue
- After `runPrompt` completes, process next in queue
- `autoName()` sends summary prompt, captures title, then calls `this.adapter.renameSessionThread(this.id, this.name)` to rename the topic

- [ ] **Step 3: Create session-manager.ts**

Per spec. Methods: `createSession()`, `getSession()`, `getSessionByThread()`, `cancelSession()`, `listSessions()`, `destroyAll()`.

- [ ] **Step 4: Export from index.ts**

- [ ] **Step 5: Build and verify**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent-manager.ts packages/core/src/session.ts packages/core/src/session-manager.ts packages/core/src/index.ts
git commit -m "feat(core): add AgentManager, Session with prompt queue, and SessionManager"
```

---

## Task 8a: OpenACPCore — Shell & Lifecycle

**Files:**
- Create: `packages/core/src/core.ts`

- [ ] **Step 1: Create OpenACPCore class shell**

Per spec `03-core-modules.md`. Wire together: ConfigManager, AgentManager, SessionManager, NotificationManager, adapters Map.

Implement: constructor, `registerAdapter(name, adapter)`, `start()`, `stop()`.

- [ ] **Step 2: Export from index.ts, build and verify**

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/core.ts packages/core/src/index.ts
git commit -m "feat(core): add OpenACPCore shell with lifecycle methods"
```

---

## Task 8b: OpenACPCore — Message Routing

**Files:**
- Modify: `packages/core/src/core.ts`

- [ ] **Step 1: Implement handleMessage()**

Per spec. Security check (allowedUserIds), concurrent session limit, lookup session by thread, forward to session.enqueuePrompt().

- [ ] **Step 2: Implement handleNewSession()**

Resolve agent name (default if omitted), resolve workspace, create session via SessionManager, wire events, return session.

- [ ] **Step 3: Implement handleNewChat()**

Find current session by thread, inherit agentName and workingDirectory, call handleNewSession().

- [ ] **Step 4: Build and verify**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core.ts
git commit -m "feat(core): add message routing, session creation, and new-chat inheritance"
```

---

## Task 8c: OpenACPCore — Event Wiring

**Files:**
- Modify: `packages/core/src/core.ts`

- [ ] **Step 1: Implement toOutgoingMessage()**

Convert AgentEvent to OutgoingMessage. Handle all types: text, thought, tool_call, tool_update, plan, usage, commands_update.

- [ ] **Step 2: Implement wireSessionEvents()**

Per spec. Set `agentInstance.onSessionUpdate` callback — route events to adapter.sendMessage(), notifications for session_end/error.
Set `agentInstance.onPermissionRequest` callback — create Promise, store in session.pendingPermission.
Also set `session.adapter = adapter` so autoName can call renameSessionThread.

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/core.ts
git commit -m "feat(core): add event wiring between agent and channel adapter"
```

---

## Task 9: Telegram Formatting Utilities

**Files:**
- Create: `packages/adapters/telegram/src/formatting.ts`

- [ ] **Step 1: Implement formatting functions**

Per spec `04-telegram-adapter.md` "Formatting Utilities" section:
- `escapeHtml(text)` — escape `&`, `<`, `>`
- `markdownToTelegramHtml(md)` — convert bold, italic, code, code blocks, links. Escape HTML BEFORE transformations to avoid `x < y` breaking tags.
- `formatToolCall(tool)` — kind icon + status icon + name
- `formatToolUpdate(update)` — status icon + output
- `formatPlan(plan)` — numbered list with status icons
- `splitMessage(text, maxLength=4096)` — split at paragraph/line boundaries

- [ ] **Step 2: Build and verify**

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/telegram/src/formatting.ts
git commit -m "feat(telegram): add Markdown-to-HTML formatting and message splitting"
```

---

## Task 10: MessageDraft Streaming

**Files:**
- Create: `packages/adapters/telegram/src/streaming.ts`

- [ ] **Step 1: Implement MessageDraft class**

Per spec `04-telegram-adapter.md` "Message Streaming" section.
- Constructor: bot, chatId, threadId, parseMode
- `append(text)` — buffer + schedule flush
- `scheduleFlush()` — throttle at 1 msg/sec
- `flush()` — send or edit message, fallback on edit failure
- `finalize()` — clear timer, final flush, return messageId

- [ ] **Step 2: Build and verify**

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/telegram/src/streaming.ts
git commit -m "feat(telegram): add MessageDraft with throttled streaming"
```

---

## Task 11: Telegram Topics Management

**Files:**
- Create: `packages/adapters/telegram/src/topics.ts`

- [ ] **Step 1: Implement topic management functions**

Per spec. Functions:
- `ensureTopics(bot, chatId, config, configManager)` — check/create notification + assistant topics, save IDs to config
- `createSessionTopic(bot, chatId, name)` — create forum topic, return threadId
- `renameSessionTopic(bot, chatId, threadId, name)` — edit topic name
- `buildDeepLink(chatId, messageId)` — construct `https://t.me/c/...` URL

- [ ] **Step 2: Build and verify**

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/telegram/src/topics.ts
git commit -m "feat(telegram): add topic management with auto-creation"
```

---

## Task 12: Telegram Commands

**Files:**
- Create: `packages/adapters/telegram/src/commands.ts`

- [ ] **Step 1: Implement command handlers**

Per spec `04-telegram-adapter.md` "Commands" section. Each command as a function:
- `handleNew(ctx, core)` — parse args, call `core.handleNewSession`, create topic
- `handleNewChat(ctx, core)` — call `core.handleNewChat`, create topic
- `handleCancel(ctx, core)` — find session, cancel
- `handleStatus(ctx, core)` — show session or global status
- `handleAgents(ctx, core)` — list agents
- `handleHelp(ctx)` — show help text

- [ ] **Step 2: Create setupCommands(bot, core) function to register all**

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add packages/adapters/telegram/src/commands.ts
git commit -m "feat(telegram): add bot command handlers"
```

---

## Task 13: Telegram Permission Handling

**Files:**
- Create: `packages/adapters/telegram/src/permissions.ts`

- [ ] **Step 1: Implement permission request sending**

Per spec. Function `sendPermissionRequest(bot, chatId, session, request, notificationManager)`:
- Generate short callbackKey via nanoid(8) (Telegram 64-byte limit)
- Build InlineKeyboard with allow/deny buttons
- Send message WITH notification
- Send notification with deep link

- [ ] **Step 2: Implement callback query handler**

Per spec. Function `setupCallbackQueries(bot, pendingPermissions, sessionManager)`:
- Parse `p:{callbackKey}:{optionId}`
- Resolve pending permission promise
- Answer callback, remove buttons

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add packages/adapters/telegram/src/permissions.ts
git commit -m "feat(telegram): add permission request UI with inline keyboard"
```

---

## Task 14: Telegram Assistant

**Files:**
- Create: `packages/adapters/telegram/src/assistant.ts`

- [ ] **Step 1: Implement assistant module**

Per spec `04-telegram-adapter.md` "Assistant Topic" section:
- `spawnAssistant(core, config)` — create session using defaultAgent, wire events, send system prompt
- `buildAssistantSystemPrompt(config)` — generate prompt with agent list, commands reference
- `handleAssistantMessage(session, text)` — forward to assistant session
- `redirectToAssistant(ctx, chatId, assistantTopicId)` — send link to assistant topic

- [ ] **Step 2: Build and verify**

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/telegram/src/assistant.ts
git commit -m "feat(telegram): add AI assistant topic"
```

---

## Task 15: TelegramAdapter (Wire Everything)

**Files:**
- Create: `packages/adapters/telegram/src/adapter.ts`
- Update: `packages/adapters/telegram/src/index.ts`

- [ ] **Step 1: Create TelegramAdapter class extending ChannelAdapter**

Per spec `04-telegram-adapter.md`. This wires all the modules together:
- `start()` — create Bot, setupMiddleware, setupRoutes, setupCommands, setupCallbackQueries, ensureTopics, spawnAssistant, bot.start()
- `stop()` — bot.stop(), destroy assistant session
- `sendMessage(sessionId, content)` — switch on content.type, use MessageDraft for text/thought, send/edit for tools. Handle ALL types including `usage` (format as token count + cost display)
- `sendPermissionRequest(sessionId, request)` — delegate to permissions module
- `sendNotification(notification)` — send to notification topic
- `createSessionThread(sessionId, name)` — delegate to topics
- `renameSessionThread(sessionId, newName)` — delegate to topics

- [ ] **Step 2: Implement setupMiddleware() — chatId filter**

- [ ] **Step 3: Implement setupRoutes() — message routing**

Route by threadId: general→redirect, notification→ignore, assistant→handleAssistantMessage, session→core.handleMessage.

- [ ] **Step 4: Update index.ts to export TelegramAdapter**

```typescript
export { TelegramAdapter } from './adapter.js'
```

- [ ] **Step 5: Build and verify**

Run: `pnpm build`
Expected: both packages compile

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/telegram/src/adapter.ts packages/adapters/telegram/src/index.ts
git commit -m "feat(telegram): add TelegramAdapter wiring all modules together"
```

---

## Task 16: Main Entry Point

**Files:**
- Create: `packages/core/src/main.ts`

- [ ] **Step 1: Implement main.ts**

Per spec `01-project-structure.md` "Entry Point" and `05-startup-and-errors.md`:
1. Ensure `~/.openacp/` directory exists
2. Load config (generate default if missing)
3. Create OpenACPCore
4. Register enabled adapters (dynamic import)
5. Start core
6. Log ready message
7. Signal handlers (SIGINT, SIGTERM) → graceful shutdown
8. uncaughtException / unhandledRejection handlers

- [ ] **Step 2: Add shebang for npx execution**

Add `#!/usr/bin/env node` at top of main.ts.

- [ ] **Step 3: Build and verify**

Run: `pnpm build`
Then: `node packages/core/dist/main.js`
Expected: creates default config, logs instructions, exits (since `enabled: false`)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/main.ts
git commit -m "feat(core): add main entry point with startup flow and graceful shutdown"
```

---

## Task 17: End-to-End Smoke Test

This is a manual integration test to verify everything works together.

- [ ] **Step 1: Set up Telegram bot**

1. Create bot via @BotFather
2. Create Supergroup with Forum/Topics enabled
3. Add bot as admin
4. Get chat ID (send message in group, check `getUpdates`)

- [ ] **Step 2: Configure OpenACP**

Edit `~/.openacp/config.json`:
```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_TOKEN",
      "chatId": YOUR_CHAT_ID
    }
  },
  "agents": {
    "claude": {
      "command": "claude-agent-acp",
      "args": []
    }
  },
  "defaultAgent": "claude"
}
```

- [ ] **Step 3: Start OpenACP**

Run: `node packages/core/dist/main.js`
Expected:
- Notification topic created
- Assistant topic created
- "OpenACP started" logged

- [ ] **Step 4: Test assistant topic**

Send message in 🤖 Assistant topic: "Hello, what can you do?"
Expected: Agent responds with help info

- [ ] **Step 5: Test /new command**

Type `/new` in any topic.
Expected: New topic created, session started confirmation

- [ ] **Step 6: Test messaging**

Send a coding prompt in the session topic: "Write a hello world in Python"
Expected: Agent responds with streaming text, tool calls visible

- [ ] **Step 7: Test /cancel**

Type `/cancel` in the session topic.
Expected: Session cancelled message

- [ ] **Step 8: Test /status and /agents**

Type `/status` and `/agents`.
Expected: Formatted status/agent list

- [ ] **Step 9: Test Ctrl+C shutdown**

Press Ctrl+C.
Expected: "Shutting down" notification sent, clean exit

- [ ] **Step 10: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```

---

## Task Order & Dependencies

```
Task 1  (scaffolding)      → no deps
Task 2  (types, log)       → Task 1
Task 3  (config)           → Task 2
Task 4  (channel, notif)   → Task 2
Task 5  (streams, stderr)  → Task 2
Task 6a (agent shell)      → Task 2, 5
Task 6b (agent callbacks)  → Task 6a
Task 7  (agent-mgr, session) → Task 4, 6b
Task 8a (core shell)       → Task 3, 4, 7
Task 8b (core routing)     → Task 8a
Task 8c (core wiring)      → Task 8b
Task 9  (tg formatting)    → Task 1
Task 10 (tg streaming)     → Task 9
Task 11 (tg topics)        → Task 1
Task 12 (tg commands)      → Task 8c, 9
Task 13 (tg permissions)   → Task 8c
Task 14 (tg assistant)     → Task 8c
Task 15 (tg adapter)       → Task 8c, 9, 10, 11, 12, 13, 14
Task 16 (main)             → Task 8c, 15
Task 17 (smoke test)       → Task 16
```

**Parallelizable groups:**
- Tasks 2-5 can be done in parallel after Task 1
- Tasks 9-11 can be done in parallel after Task 1
- Tasks 12-14 can be done in parallel after Task 8c

**Spec divergences (intentional):**
- `core/src/agent.ts` split into `agent-instance.ts` + `agent-manager.ts` (too complex for one file)
- `core/src/session.ts` split into `session.ts` + `session-manager.ts` (separate concerns)
- `core/src/workspace.ts` merged into `config.ts` (small enough to colocate)
- `telegram/src/bot.ts` merged into `adapter.ts` (bot setup is part of adapter lifecycle)
- Added `core/src/streams.ts`, `core/src/stderr-capture.ts`, `core/src/log.ts`, `core/src/formatting.ts` (extracted utilities)
- Added `telegram/src/permissions.ts` (extracted from adapter for clarity)

**Known Phase 1 limitations (deferred):**
- Session timeout enforcement (config exists but no timer — add in Phase 2)
- Telegram 429 exponential backoff (throttle covers most cases — improve in Phase 2)
- Permission timeout notification after 5 min (agent waits indefinitely — improve in Phase 2)
- `commands_update` events logged but not surfaced to user (add in Phase 3 with skills-as-commands)
