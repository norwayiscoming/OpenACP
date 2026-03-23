# Development

## Setup

```bash
git clone https://github.com/Open-ACP/OpenACP.git
cd OpenACP
pnpm install
pnpm build
```

## Run

```bash
pnpm start                    # Start server
OPENACP_DEBUG=1 pnpm start    # Debug mode
```

## Tests

```bash
pnpm test
pnpm test:watch               # Watch mode
```

## Pre-commit Hook

Husky runs `pnpm build` before every commit to catch type errors.

## Project Structure

```
src/
  cli.ts                           CLI entry point (openacp command)
  main.ts                          Server startup & shutdown
  index.ts                         Public API exports
  cli/
    commands.ts                    All CLI command implementations
    version.ts                     Version checking & updates
    integrate.ts                   Integration utilities
  core/
    core.ts                        OpenACPCore orchestrator
    config.ts                      ConfigManager + Zod schema
    config-registry.ts             Config field definitions
    config-migrations.ts           Config schema migrations
    config-editor.ts               Interactive config editor
    setup.ts                       Interactive setup wizard
    session.ts                     Session state machine & lifecycle
    session-manager.ts             Session collection manager
    session-bridge.ts              Wires session events to adapter
    session-store.ts               JSON file persistence (debounced)
    agent-instance.ts              ACP subprocess client + resume
    agent-manager.ts               Agent lifecycle management
    agent-catalog.ts               Registry + installed agents
    agent-store.ts                 Persistent agent metadata
    agent-installer.ts             Agent installation pipeline
    agent-dependencies.ts          Runtime dependency checking
    channel.ts                     ChannelAdapter abstract class
    plugin-manager.ts              Plugin install/uninstall/load
    api-server.ts                  HTTP API server (daemon mode)
    api-client.ts                  CLI ↔ daemon communication
    daemon.ts                      Daemon process management
    autostart.ts                   System auto-start hooks
    log.ts                         Pino logging (console + file rotation)
    notification.ts                Notification routing
    permission-gate.ts             Permission request handler
    prompt-queue.ts                Serial prompt queue
    message-transformer.ts         AgentEvent → OutgoingMessage
    topic-manager.ts               Session thread/topic management
    typed-emitter.ts               Generic typed event emitter
    types.ts                       Shared types
    streams.ts                     Node ↔ Web stream adapters
    stderr-capture.ts              Agent stderr logging
    doctor/                        System diagnostics
      checks/                     Individual checks (config, telegram, tunnel, etc.)
  adapters/
    telegram/
      adapter.ts                   TelegramAdapter (grammY)
      streaming.ts                 MessageDraft (throttled streaming)
      topics.ts                    Forum topic lifecycle
      permissions.ts               Permission inline buttons
      assistant.ts                 AI assistant topic
      formatting.ts                Markdown → Telegram HTML
      send-queue.ts                Rate-limited send queue
      draft-manager.ts             Edit message updates
      tool-call-tracker.ts         Tool execution tracking
      skill-command-manager.ts     Dynamic command buttons
      activity.ts                  Session activity tracking
      action-detect.ts             Button action routing
      commands/
        new-session.ts             /new, /newchat
        session.ts                 /cancel, /status, /sessions
        menu.ts                    Menu commands
        agents.ts                  Agent listing + installation
        admin.ts                   /enable_dangerous, /restart
        settings.ts                Settings UI
        integrate.ts               Integration management
        doctor.ts                  Diagnostics UI
  tunnel/
    tunnel-service.ts              Orchestrator: server + provider + store
    server.ts                      Hono HTTP routes
    provider.ts                    TunnelProvider interface
    viewer-store.ts                In-memory store with TTL
    extract-file-info.ts           ACP content → file info parser
    providers/
      cloudflare.ts                Cloudflare Tunnel
      ngrok.ts                     ngrok
      bore.ts                      bore
      tailscale.ts                 Tailscale Funnel
    templates/
      file-viewer.ts               Monaco Editor HTML
      diff-viewer.ts               Monaco Diff Editor HTML
  data/
    registry-snapshot.json         Bundled agent registry
```

## Architecture

```
ChannelAdapter (Telegram, plugin adapters)
  ↕ messages
OpenACPCore
  ├── SessionManager → Session → AgentInstance (ACP SDK)
  │     └── SessionBridge (wires session events ↔ adapter)
  ├── AgentManager → AgentCatalog (registry + installed)
  │     └── AgentInstaller (npx/uvx/binary/custom)
  ├── ConfigManager (Zod validation, env overrides, hot-reload)
  ├── SessionStore (JSON file, debounced writes, lazy resume)
  ├── NotificationManager
  ├── MessageTransformer (AgentEvent → OutgoingMessage)
  ├── API Server (daemon mode, HTTP API)
  └── TunnelService (optional)
        ├── HTTP Server (Hono)
        ├── TunnelProvider (cloudflare/ngrok/bore/tailscale)
        └── ViewerStore (in-memory, TTL)
```

## Message Flow

```
User (Telegram)
  ↓ message
TelegramAdapter.handleMessage(IncomingMessage)
  ↓
OpenACPCore.handleMessage()
  ↓ route to Session by threadId
Session.enqueuePrompt(text)
  ↓ queued (serial), then:
AgentInstance.prompt(text)
  ↓ nd-json over stdio
Agent subprocess (ACP)
  ↓ events
AgentInstance → Session.emit("agent_event")
  ↓ SessionBridge listens
MessageTransformer → OutgoingMessage
  ↓
TelegramAdapter.sendMessage()
  ↓
User sees result
```

## Session State Machine

```
initializing → active → finished (terminal)
                  ↓ ↗
               error
                  ↓ ↗
              cancelled
```

## CLI Commands

### Daemon Management

```
openacp                         Start (mode from config: foreground or daemon)
openacp start                   Start as background daemon
openacp stop                    Stop background daemon
openacp status                  Show daemon status
openacp logs                    Tail daemon log file
```

### Configuration

```
openacp config                  Edit configuration (interactive)
openacp config set <key> <val>  Set config value
openacp reset                   Delete all data & start fresh
```

### Agents

```
openacp agents                  List available agents
openacp agents install <name>   Install agent
openacp agents uninstall <name> Uninstall agent
openacp agents refresh          Update agent list from registry
openacp agents info <name>      Show agent details
```

### Plugins

```
openacp install <package>       Install plugin adapter
openacp uninstall <package>     Uninstall plugin adapter
openacp plugins                 List installed plugins
```

### Integrations

```
openacp adopt <agent> <id>      Adopt external agent session
openacp integrate <agent>       Install/uninstall integration
```

### Diagnostics & Updates

```
openacp update                  Update to latest version
openacp doctor                  System diagnostics
openacp doctor --dry-run        Check only, don't fix
```

### API (requires running daemon)

```
openacp api status              Show active sessions
openacp api session <id>        Show session details
openacp api new [agent] [ws]    Create new session
openacp api send <id> <prompt>  Send prompt
openacp api cancel <id>         Cancel session
openacp api dangerous <id>      Toggle dangerous mode
openacp api agents              List available agents
openacp api topics              List topics
openacp api delete-topic <id>   Delete topic
openacp api cleanup             Cleanup finished topics
openacp api health              Show system health
openacp api adapters            List adapters
openacp api tunnel              Show tunnel status
openacp api restart             Restart daemon
openacp api notify <message>    Send notification
openacp api version             Show daemon version
```

## Key Design Decisions

- **Fire-and-forget message handling** — Telegram handler doesn't await the agent prompt, preventing a deadlock between polling and permission callbacks
- **Session state machine** — Validated state transitions prevent invalid states (e.g., can't go from `finished` to `active`)
- **SessionBridge pattern** — Decouples Session from Adapter; connect/disconnect lifecycle enables any adapter to wire into sessions
- **Serial prompt queue** — FIFO queue ensures one prompt executes at a time per session
- **Permission gate** — Wraps pending permission as a Promise with 10-minute timeout
- **Lazy resume** — Sessions only reconnect when a user sends a message, not on startup (avoids subprocess explosion)
- **Debounced session store** — Writes batched every 2s with force flush on shutdown
- **Pluggable adapters** — `ChannelAdapter` abstract class, loaded dynamically for plugins
- **Pluggable tunnel providers** — `TunnelProvider` interface, add providers with `start()`/`stop()`/`getPublicUrl()`
- **Config hot-reload** — ConfigManager emits `config:changed` events; listeners react to runtime changes
- **Config auto-migration** — New sections auto-added to existing config files on upgrade
- **Agent catalog** — Merges registry (remote + bundled snapshot) with locally installed agents
- **Daemon mode** — HTTP API server enables CLI ↔ daemon communication

## Standard Paths

| Path | Purpose |
|------|---------|
| `~/.openacp/config.json` | Configuration |
| `~/.openacp/sessions.json` | Session persistence |
| `~/.openacp/agents.json` | Installed agent metadata |
| `~/.openacp/registry-cache.json` | Agent registry cache (24h TTL) |
| `~/.openacp/plugins/` | Installed plugin adapters |
| `~/.openacp/agents/` | Agent binaries (binary distribution) |
| `~/.openacp/logs/openacp.log` | Combined log (JSONL, rotated) |
| `~/.openacp/logs/sessions/` | Per-session log files |
| `~/openacp-workspace/` | Default workspace base |
