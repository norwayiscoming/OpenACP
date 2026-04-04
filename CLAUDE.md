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
  main.ts             — Server startup, plugin boot
  index.ts            — Public API exports
  core/               — Core modules
    config/           — Zod-validated config, migrations, editor
    agents/           — Agent instance, catalog, installer, store
    sessions/         — Session, session-manager, session-bridge, permission-gate
    plugin/           — Plugin infrastructure (LifecycleManager, ServiceRegistry, MiddlewareChain, PluginContext)
    commands/         — System chat commands (session, agents, admin, help, menu)
    adapter-primitives/ — Shared adapter framework (MessagingAdapter, StreamAdapter, SendQueue, etc.)
    utils/            — Logger, typed-emitter, file utilities
    setup/            — First-run setup wizard
  plugins/            — All plugins (adapters + services)
    telegram/         — Telegram adapter (grammY)
    slack/            — Slack adapter (@slack/bolt)
    speech/           — TTS/STT (Edge TTS, Groq STT)
    tunnel/           — Port forwarding (Cloudflare, ngrok, Bore, Tailscale)
    security/         — Access control, rate limiting
    usage/            — Cost tracking, budget
    api-server/       — REST API + SSE
    file-service/     — File I/O for agents
    notifications/    — Cross-session alerts
    context/          — Conversation history
  cli/
    commands/         — CLI commands (start, plugins, dev, etc.)
    plugin-template/  — Scaffold templates for `openacp plugin create`
  packages/
    plugin-sdk/       — @openacp/plugin-sdk (types + testing utilities)
```

### Core Abstractions

**OpenACPCore** (`core.ts`) — Registers adapters, routes messages, creates sessions, wires agent events to adapters. Accesses services via ServiceRegistry.

**Session** (`session.ts`) — Wraps an AgentInstance with a prompt queue (serial processing), auto-naming, and lifecycle management.

**AgentInstance** (`agent-instance.ts`) — Spawns agent subprocess, implements full ACP Client interface. Converts ACP events to AgentEvent types.

**LifecycleManager** (`plugin/lifecycle-manager.ts`) — Boots plugins in dependency order (topo-sort), manages setup/teardown, handles version migration.

**ServiceRegistry** (`plugin/service-registry.ts`) — Central service discovery. Plugins register services, core accesses them via typed interfaces.

**CommandRegistry** (`command-registry.ts`) — Central command registry for chat commands. System and plugin commands registered here, adapters dispatch via generic handler.

**PluginContext** (`plugin/plugin-context.ts`) — Scoped API for plugins: events, services, middleware, commands, storage, logging.

### Plugin System

All features are plugins. Core only provides infrastructure (ServiceRegistry, MiddlewareChain, EventBus, LifecycleManager). Plugins register services, commands, and middleware in their `setup()` hook.

- 18 middleware hook points (message:incoming, agent:beforePrompt, permission:beforeRequest, etc.)
- 9 permission types (events:read, services:register, commands:register, etc.)
- Per-plugin settings via SettingsManager (~/.openacp/plugins/<name>/settings.json)

### Adapter Patterns

- **Forum topics** (Telegram): Each session gets its own topic
- **Callback routing**: Permission buttons use `p:` prefix, command buttons use `c/` prefix
- **Response renderers**: Adapters render CommandResponse types (text, menu, list, confirm, error, silent) per platform

## npm Publishing

Published as `@openacp/cli` on npm. Users install with `npm install -g @openacp/cli`.

- `pnpm build:publish` bundles CLI via tsup + builds SDK via tsc
- GitHub Action auto-publishes both `@openacp/cli` and `@openacp/plugin-sdk` on tag push (`v*`)
- Plugin system: `openacp plugin install <name>` installs from npm to `~/.openacp/plugins/`

## Versioning

Format: `YYYY.MMDD.<patch>` — e.g. `2026.327.1` is the first patch on March 27, 2026.

- `YYYY` — year
- `MMDD` — month (2-digit) + day (2-digit), leading zeros stripped by semver. Jan 5 = `105`, Mar 27 = `327`, Apr 1 = `401`, Dec 5 = `1205`
- `<patch>` — sequential patch number for that day, starting from 1

## Documentation Sync

When changing code, **you must update corresponding docs** to keep code and documentation in sync:

- **New features**: Must update README and `docs/` (GitBook) to describe the feature, usage, and config if applicable.
- **Feature updates**: Update related docs to reflect changes.
- **Bug fixes**: Update docs if the bug relates to documented behavior. Not required if docs are still accurate.
- **General rule**: Do not merge code without updating docs for new features or changes. README is for users, `docs/` is for both users and contributors.
- **Plugin Template Sync**: When changing plugin API, architecture, PluginContext, CommandDef, middleware hooks, permissions, or anything affecting how plugins are written → **must update plugin template** at `src/cli/plugin-template/` (especially `claude-md.ts` and `plugin-guide.ts`) so templates always reflect the current API. These templates are the primary reference for both AI agents and plugin developers.

## Conventions

- **English only**: All code, comments, commit messages, documentation, specs, plans, and any text in the repository must be written in English. No exceptions.
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
- `src/plugins/*/` — Plugin-specific unit tests
- Name files descriptively: `session-lifecycle.test.ts`, `session-bridge-autoapprove.test.ts`

## Backward Compatibility

Users who installed and ran older versions will have config, data, and storage in the old format. When adding or changing anything related, **you must ensure backward compatibility**:

- **Config** (`~/.openacp/config.json`): When adding new fields to Zod schema, always use `.default()` or `.optional()` so old configs don't fail validation. Never rename or remove fields without migration.
- **Storage / Data files** (`~/.openacp/`): When changing data format (sessions, topics, state...), must handle old format — read old data and auto-migrate to new format if needed. Must not crash on data from previous versions.
- **CLI flags & commands**: Do not remove or rename existing commands/flags. If deprecating, keep them working and log a warning.
- **Plugin API**: When changing interfaces that plugins use, must maintain backward compat or bump major version.
- **General rule**: New code must work with old data/config without requiring user action. If migration is needed, run it automatically on startup.
