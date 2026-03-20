# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
pnpm install            # Install all workspace dependencies
pnpm build              # Build all packages (tsc in each)
pnpm start              # Run: node packages/core/dist/main.js
pnpm dev                # Watch mode for @openacp/core only
```

Build order matters: `@openacp/core` must build before `@openacp/adapter-telegram`. `pnpm build` handles this via recursive workspace build.

No test framework or linter is configured yet.

## Architecture

OpenACP bridges AI coding agents to messaging platforms via the Agent Client Protocol (ACP). The flow:

```
User (Telegram) → ChannelAdapter → OpenACPCore → Session → AgentInstance (ACP subprocess)
```

### Monorepo Layout

- `packages/core` (`@openacp/core`) — Orchestrator, session management, ACP client, config
- `packages/adapters/telegram` (`@openacp/adapter-telegram`) — Telegram bot via grammY

### Core Abstractions

**OpenACPCore** (`core.ts`) — Registers adapters, routes messages, creates sessions, wires agent events to adapters. Enforces security (allowedUserIds, maxConcurrentSessions).

**Session** (`session.ts`) — Wraps an AgentInstance with a prompt queue (serial processing), auto-naming (asks agent to summarize after first prompt), and lifecycle management. Key fields: `threadId` (set by adapter after topic creation), `promptQueue`, `pendingPermission`.

**AgentInstance** (`agent-instance.ts`) — Spawns agent subprocess, implements full ACP `Client` interface (sessionUpdate, permissions, file I/O, terminal management). Resolves commands via node_modules/.bin inspection. Converts ACP events to `AgentEvent` types.

**ChannelAdapter** (`channel.ts`) — Abstract base. Implementations must handle: `sendMessage`, `sendPermissionRequest`, `sendNotification`, `createSessionThread`, `renameSessionThread`.

**ConfigManager** (`config.ts`) — Zod-validated config from `~/.openacp/config.json`. Supports env overrides: `OPENACP_TELEGRAM_BOT_TOKEN`, `OPENACP_TELEGRAM_CHAT_ID`, `OPENACP_DEFAULT_AGENT`, `OPENACP_DEBUG`.

### Event Flow

AgentInstance emits `AgentEvent`s → `OpenACPCore.wireSessionEvents()` converts to `OutgoingMessage` → adapter renders to platform. Permission requests use async resolve pattern: adapter sends buttons, stores resolve callback, user clicks, callback resolves.

### Telegram Adapter Patterns

- **Forum topics**: Each session gets its own topic. System topics: 📋 Notifications, 🤖 Assistant
- **MessageDraft** (`streaming.ts`): Buffers text chunks, sends periodic batch updates to avoid message spam
- **Callback routing**: Permission buttons use `p:` prefix, menu buttons use `m:` prefix. Must use `bot.callbackQuery(/^prefix/)` (not `bot.on('callback_query:data')`) to avoid blocking the middleware chain
- **Native fetch required**: grammY must use `{ client: { fetch } }` to avoid ETIMEDOUT with node-fetch on Node 20
- **Topic-first creation**: Create forum topic BEFORE `core.handleNewSession()` to prevent race condition where agent events fire before `threadId` is set

## Config

Default location: `~/.openacp/config.json` (override with `OPENACP_CONFIG_PATH`).

Agents are defined as `{ command, args, env }` in the `agents` record. Command resolution tries: local node_modules → .bin wrapper → which → raw command.

## Conventions

- ESM-only (`"type": "module"`), all imports use `.js` extension
- TypeScript strict mode, target ES2022, NodeNext module resolution
- Use `as never` instead of `as any` for type assertions
