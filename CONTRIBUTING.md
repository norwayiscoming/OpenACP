# Contributing to OpenACP

Welcome! OpenACP is a self-hosted bridge connecting AI coding agents to messaging platforms. Contributions of all kinds are welcome — bug reports, features, docs, and tests.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

---

## Development Setup

**Prerequisites**
- Node.js >= 20
- pnpm 10.5.0+ (`npm install -g pnpm`)

**Getting started**

```bash
git clone https://github.com/Open-ACP/OpenACP.git
cd OpenACP
pnpm install
pnpm build
```

**Development modes**

```bash
pnpm dev          # tsc --watch (type-check + rebuild on change)
pnpm dev:loop     # auto-restart dev server on change
```

**Running tests**

```bash
pnpm test         # run all tests once
pnpm test:watch   # watch mode
```

---

## Project Structure

```
src/
├── core/                    # Core infrastructure
│   ├── config/              # Zod-validated config, migrations, editor
│   ├── agents/              # Agent instance, catalog, installer, store
│   ├── sessions/            # Session, session-manager, session-bridge, permission-gate
│   ├── plugin/              # Plugin system (LifecycleManager, ServiceRegistry, MiddlewareChain)
│   ├── commands/            # System chat commands (session, agents, admin, help, menu)
│   ├── adapter-primitives/  # Shared adapter framework (MessagingAdapter, StreamAdapter, etc.)
│   ├── utils/               # Logger, typed-emitter, file utilities
│   └── setup/               # First-run setup wizard
├── plugins/                 # All platform adapters and service plugins
│   ├── telegram/            # Telegram adapter (grammY)
│   ├── speech/              # TTS/STT (Edge TTS, Groq STT)
│   ├── tunnel/              # Port forwarding (Cloudflare, ngrok, Bore, Tailscale)
│   ├── security/            # Access control, rate limiting
│   ├── api-server/          # REST API + SSE
│   ├── file-service/        # File I/O for agents
│   ├── notifications/       # Cross-session alerts
│   └── context/             # Conversation history
├── cli/
│   ├── commands/            # CLI commands (start, plugins, dev, etc.)
│   └── plugin-template/     # Scaffold for `openacp plugin create`
├── cli.ts                   # CLI entry point
├── main.ts                  # Server startup, plugin boot
└── index.ts                 # Public API exports
packages/
└── plugin-sdk/              # @openacp/plugin-sdk — types + testing utilities
ui/                          # Web UI (React + Vite, separate pnpm project)
```

---

## Architecture Overview

OpenACP uses a **plugin-based architecture**. Core provides only infrastructure (ServiceRegistry, MiddlewareChain, EventBus, LifecycleManager) — all features are plugins.

```
User (Telegram/Slack) → ChannelAdapter → OpenACPCore → Session → AgentInstance (ACP subprocess)
```

- **LifecycleManager** boots plugins in dependency order and manages setup/teardown
- **ServiceRegistry** is the central service discovery layer — plugins register services, core accesses them via typed interfaces
- **MiddlewareChain** provides 18 hook points (e.g. `message:incoming`, `agent:beforePrompt`, `permission:beforeRequest`)
- **CommandRegistry** handles all chat commands from both core and plugins

For a complete architecture reference and AI-friendly codebase guide, see [`CLAUDE.md`](CLAUDE.md).

## Building a Plugin

Install the SDK:

```bash
npm install @openacp/plugin-sdk
```

Scaffold a new plugin:

```bash
openacp plugin create my-plugin
```

See [`packages/plugin-sdk/`](packages/plugin-sdk/) for the full API and [`src/cli/plugin-template/`](src/cli/plugin-template/) for the scaffold template.

---

## Code Style & Conventions

- **English only** — all code, comments, commit messages, and documentation must be in English
- **TypeScript strict mode** — all code must pass `tsc --noEmit`
- **ESM modules** — use `.js` extensions in all imports (even for `.ts` source files)
- **Zod** for config validation and schema definitions
- **Pino** for structured logging — no `console.log` in library code
- Use kebab-case for file names
- **Versioning format**: `YYYY.MDD.<patch>` — e.g. `2026.327.1` is the first patch on March 27 2026

---

## Testing Guidelines

- Framework: [vitest](https://vitest.dev/)
- Test files: `src/core/__tests__/`, `src/__tests__/` (integration), `src/plugins/*/` (plugin unit tests)
- Run with `pnpm test` before submitting a PR
- Test state machines, user flows end-to-end, error recovery, and concurrency
- Mock at boundaries only (AgentInstance, ChannelAdapter, SessionStore) — not internal classes
- Do not mock away real behavior to make tests pass

---

## Pull Request Process

1. **Fork** the repo and create a branch from `main`
2. **Branch naming**: use a prefix that matches the change type
   - `feat/` — new feature
   - `fix/` — bug fix
   - `docs/` — documentation only
   - `refactor/` — code cleanup without behavior change
3. **Implement** your change and write or update tests
4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add slack reaction support`
   - `fix: reconnect on websocket timeout`
   - `docs: update setup instructions`
5. **Push** and open a PR against `main`
6. **Update docs** — if your change adds or modifies a feature, update `README.md` and/or the `docs/` directory
7. **CI must pass** before a PR can be merged
8. At least one maintainer review is required

---

## Where to Start

- Browse [`good first issue`](https://github.com/Open-ACP/OpenACP/labels/good%20first%20issue) for beginner-friendly tasks
- Check [`help wanted`](https://github.com/Open-ACP/OpenACP/labels/help%20wanted) for tasks that need community help
- Join [GitHub Discussions](https://github.com/Open-ACP/OpenACP/discussions) for questions and ideas

---

## Reporting Issues

Use [GitHub Issues](https://github.com/Open-ACP/OpenACP/issues) to report bugs or request features. Please check for existing issues before opening a new one and include reproduction steps where applicable.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
