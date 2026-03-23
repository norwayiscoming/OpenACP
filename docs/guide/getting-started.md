# Getting Started

## Prerequisites

- Node.js >= 20
- At least one ACP agent installed (e.g., `@zed-industries/claude-agent-acp`)
- A messaging platform — Telegram, Discord, or both:
  - **Telegram**: A bot token from [@BotFather](https://t.me/BotFather) + a Supergroup with **Topics** enabled
  - **Discord**: A bot from [Discord Developer Portal](https://discord.com/developers/applications) + a server with Manage Channels permissions

## Install

```bash
npm install -g @openacp/cli
```

## First Run

```bash
openacp
```

On first run (no config file), an **interactive setup wizard** guides you through:

### Step 1: Choose Channel

- Pick your messaging platform: **Telegram**, **Discord**, or **Both**

### Step 2: Configure Channel(s)

**Telegram** (if selected):
- Enter your bot token from @BotFather
- Token is **validated** against the Telegram API — you'll see the bot name on success
- OpenACP **auto-detects** your supergroup by listening for messages (120s timeout)
- Send any message in your group while it's listening, or enter the chat ID manually
- Validates that it's a supergroup (required for forum topics)

**Discord** (if selected):
- Enter your bot token from the Discord Developer Portal
- Token is validated against the Discord API
- Select your server from detected guilds

### Step 3: Agents & Workspace

- The wizard automatically scans your system for known ACP agents (`claude-agent-acp`, `claude-code`, `claude`, `codex`)
- The first detected agent becomes the default
- Optionally install Claude CLI integration for session transfer (`/openacp:handoff`)
- Choose a base directory for project workspaces (default: `~/openacp-workspace`)

### Step 4: Run Mode

- Choose **foreground** (logs in terminal) or **daemon** (background service with auto-start)

### Done

Config is saved to `~/.openacp/config.json`. Edit it anytime — see [Configuration](configuration.md).

## What Happens on Startup

1. Config loaded and validated (Zod schema)
2. Logger initialized (Pino with file rotation)
3. Session store loaded (`~/.openacp/sessions.json`)
4. Tunnel service started (if enabled — default: Cloudflare)
5. Channel adapters registered and started
6. System topics created in Telegram (Notifications + Assistant)
7. Ready for messages

## Running as a Daemon

After setup, you can run OpenACP as a background service:

```bash
openacp start          # Start daemon
openacp stop           # Stop daemon
openacp status         # Check status
openacp logs           # View logs
```

Or configure daemon mode as default via `openacp config` → Run Mode.

## Next Steps

- [Telegram Setup](telegram-setup.md) — detailed bot & group configuration
- [Discord Setup](discord-setup.md) — detailed bot creation, permissions & server setup
- [Usage Guide](usage.md) — CLI commands, API, sessions, workspaces
- [Configuration Reference](configuration.md) — all config options including API and run mode
- [Tunnel & File Viewer](tunnel.md) — shareable code viewer
