# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
pnpm install            # Install dependencies
pnpm build              # TypeScript compile (tsc)
pnpm build:publish      # Bundle for npm publish (tsup → dist-publish/)
pnpm start              # Run: node dist/cli.js
pnpm dev                # Watch mode (tsc --watch)
pnpm test               # Run tests (vitest)
```

## Architecture

OpenACP bridges AI coding agents to messaging platforms via the Agent Client Protocol (ACP). The flow:

```
User (Telegram) → ChannelAdapter → OpenACPCore → Session → AgentInstance (ACP subprocess)
```

### Project Layout

```
src/
  cli.ts              — CLI entry (start, install, uninstall, plugins, --version, --help)
  main.ts             — Server startup, adapter registration
  index.ts            — Public API exports
  core/               — Core modules
    config.ts         — Zod-validated config from ~/.openacp/config.json
    core.ts           — OpenACPCore orchestrator
    session.ts        — Session with prompt queue, auto-naming
    agent-instance.ts — ACP subprocess client
    channel.ts        — ChannelAdapter abstract base
    plugin-manager.ts — Plugin install/uninstall/load from ~/.openacp/plugins/
    setup.ts          — Interactive first-run setup
  adapters/
    telegram/         — Built-in Telegram adapter (grammY)
```

### Core Abstractions

**OpenACPCore** (`core.ts`) — Registers adapters, routes messages, creates sessions, wires agent events to adapters. Enforces security (allowedUserIds, maxConcurrentSessions).

**Session** (`session.ts`) — Wraps an AgentInstance with a prompt queue (serial processing), auto-naming (asks agent to summarize after first prompt), and lifecycle management.

**AgentInstance** (`agent-instance.ts`) — Spawns agent subprocess, implements full ACP Client interface. Converts ACP events to AgentEvent types.

**ChannelAdapter** (`channel.ts`) — Abstract base. Implementations must handle: sendMessage, sendPermissionRequest, sendNotification, createSessionThread, renameSessionThread.

**ConfigManager** (`config.ts`) — Zod-validated config. Supports env overrides: `OPENACP_TELEGRAM_BOT_TOKEN`, `OPENACP_TELEGRAM_CHAT_ID`, `OPENACP_DEFAULT_AGENT`, `OPENACP_DEBUG`.

### Telegram Adapter Patterns

- **Forum topics**: Each session gets its own topic. System topics: Notifications, Assistant
- **MessageDraft** (`streaming.ts`): Buffers text chunks, sends periodic batch updates
- **Callback routing**: Permission buttons use `p:` prefix, menu buttons use `m:` prefix. Must use `bot.callbackQuery(/^prefix/)` to avoid blocking the middleware chain
- **Topic-first creation**: Create forum topic BEFORE `core.handleNewSession()` to prevent race condition

## npm Publishing

Published as `@openacp/cli` on npm. Users install with `npm install -g @openacp/cli`.

- `pnpm build:publish` bundles via tsup into `dist-publish/`
- GitHub Action auto-publishes on tag push (`v*`)
- Plugin system: `openacp install @openacp/adapter-discord` installs to `~/.openacp/plugins/`

## Conventions

- ESM-only (`"type": "module"`), all imports use `.js` extension
- TypeScript strict mode, target ES2022, NodeNext module resolution

## Testing Conventions

### General Principles

- **Test framework**: Vitest. Test files live in `src/**/__tests__/*.test.ts` or `src/**/*.test.ts`.
- **Objective tests**: Tests must be objective — verify behavior against specifications and expected outcomes, not against current implementation details. The source code is for understanding, but tests should validate what the code *should* do.
- **Test flows, not internals**: Focus on testing user-facing flows and integration between components rather than individual private methods. Test the public API surface.
- **Edge cases matter**: Always test boundary conditions, error paths, and state machine transitions. These are where bugs hide.

### What to Test

1. **State machines**: Test ALL valid transitions AND all invalid transitions. Verify events emitted on each transition.
2. **Flow tests**: Test complete user flows end-to-end (e.g., message → session lookup → prompt → response → notification).
3. **Error recovery**: Test that errors don't leave the system in a broken state. After an error, the system should be usable again.
4. **Concurrency**: Test serial processing guarantees, queue ordering, lock behavior, and race conditions.
5. **Boundary values**: Test exact boundaries (e.g., `maxConcurrentSessions` at exactly the limit, budget at exactly the threshold).
6. **Cleanup**: Test that resources (timers, listeners, files) are cleaned up properly.
7. **Idempotency**: Test double-calls (double connect, double disconnect, double resolve) are safe.

### How to Write Tests

```typescript
// Use vi.fn() for mocks, TypedEmitter for event-based mocks
function mockAgentInstance() {
  const emitter = new TypedEmitter<{ agent_event: (event: AgentEvent) => void }>();
  return Object.assign(emitter, {
    sessionId: "agent-sess-1",
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    onPermissionRequest: vi.fn(),
  }) as any;
}
```

- **Mock at boundaries**: Mock AgentInstance, ChannelAdapter, SessionStore — not internal classes.
- **Use `vi.waitFor()`** for async assertions on fire-and-forget operations.
- **Use `vi.useFakeTimers()`** for timeout-based tests (e.g., PermissionGate timeout).
- **Cleanup in afterEach**: Always destroy stores, clear timers, remove temp files.
- **No sleep/polling**: Use `await Promise.resolve()` for microtask timing, `vi.waitFor()` for async ops.

### Test Organization

- `src/core/__tests__/` — Core module tests (session, bridge, queue, permissions, store, etc.)
- `src/__tests__/` — Integration tests and adapter-level tests
- `src/adapters/*/` — Adapter-specific unit tests (formatting, streaming, etc.)
- Name files descriptively: `session-lifecycle.test.ts`, `session-bridge-autoapprove.test.ts`

## Backward Compatibility

Users đã cài và chạy các version cũ sẽ có config, data, storage ở trạng thái cũ. Khi thêm hoặc thay đổi bất kỳ thứ gì liên quan, **phải đảm bảo tương thích ngược**:

- **Config** (`~/.openacp/config.json`): Khi thêm field mới vào Zod schema, luôn đặt `.default()` hoặc `.optional()` để config cũ không bị validation error. Không bao giờ đổi tên hoặc xóa field mà không có migration.
- **Storage / Data files** (`~/.openacp/`): Khi thay đổi format dữ liệu (sessions, topics, state...), phải handle được format cũ — đọc được data cũ và tự động migrate sang format mới nếu cần. Không được crash khi gặp data từ version trước.
- **CLI flags & commands**: Không xóa hoặc đổi tên command/flag đang có. Nếu deprecate thì vẫn giữ hoạt động và log warning.
- **Plugin API**: Khi thay đổi interface mà plugin dùng, phải giữ backward compat hoặc bump major version.
- **Nguyên tắc chung**: Code mới phải chạy được với data/config cũ mà không cần user làm gì thêm. Nếu cần migration, tự động chạy khi khởi động.
