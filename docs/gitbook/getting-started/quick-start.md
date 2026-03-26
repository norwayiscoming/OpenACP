# Quick Start

This guide gets you from zero to chatting with an AI agent in your Telegram (or Discord, or Slack) in about ten minutes.

## What you'll need

- **Node.js 20 or later** — check with `node --version`
- **A bot token** for your chat platform:
  - Telegram: create one via [@BotFather](https://t.me/BotFather)
  - Discord: create one in the [Discord Developer Portal](https://discord.com/developers/applications)
  - Slack: create one at [api.slack.com/apps](https://api.slack.com/apps)
- **An ACP-compatible agent** installed on your machine (e.g. `claude` CLI, `gemini` CLI)

---

## Step 1: Install OpenACP

```bash
npm install -g @openacp/cli
```

Verify it installed:

```bash
openacp --version
```

---

## Step 2: Run the setup wizard

```bash
openacp
```

The first time you run `openacp`, it detects there's no config and launches an interactive setup wizard that walks you through:

1. **Choose your platform** — Telegram, Discord, or Slack
2. **Enter your bot token** — paste the token you created above
3. **Validate the token** — confirms it can reach the platform API
4. **Detect agents** — scans your system for installed ACP-compatible agents
5. **Set your workspace** — the directory your agents will have access to
6. **Choose run mode** — foreground (for testing) or daemon (runs in background)

Most prompts have sensible defaults — just press Enter to accept them.

---

## Step 3: Start OpenACP

If you chose foreground mode:

```bash
openacp start
```

If you chose daemon mode, it started automatically. Check with:

```bash
openacp status
```

---

## Step 4: Chat with your AI agent

Open the Telegram group (or Discord server, or Slack channel) linked to your bot and send:

```
/new
```

OpenACP creates a **session** — a dedicated thread between you and an AI agent. On Telegram this becomes a forum topic, on Discord and Slack a thread.

Now send a real message:

```
What files are in the src/ directory?
```

You should see:

- **Streaming text** — the agent's response arrives piece by piece in real time
- **Tool calls** — status updates like `🔧 Running: read_file src/main.ts` when the agent reads files or runs commands
- **Permission requests** — some actions show **Approve** / **Deny** buttons and wait for your response
- **Auto-naming** — the session topic gets renamed based on your first message

---

## Step 5: Useful commands

| Command | What it does |
|---|---|
| `/new` | Start a new session with a fresh agent |
| `/cancel` | Stop the current response |
| `/status` | Check the status of your active session |
| `/menu` | Open the action menu |

For the full list, see [Chat Commands](../using-openacp/chat-commands.md).

---

## What just happened?

When you ran `openacp start`, OpenACP:

1. Loaded your config from `~/.openacp/config.json`
2. Connected your bot to the chat platform
3. Started listening for messages

When you sent `/new`, OpenACP:

1. Created a new **Session** for you
2. Spawned an **AgentInstance** — a subprocess running your AI agent via ACP
3. Routed your message to the agent and streamed the response back to chat

---

## Your data directory

Everything OpenACP stores lives in `~/.openacp/`:

| Path | What's in it |
|---|---|
| `config.json` | Your configuration (bot token, agent, allowed users) |
| `sessions.json` | Active and recent session metadata |
| `usage.json` | Token and cost tracking |
| `logs/` | Application logs |
| `files/` | Files shared through the chat |
| `plugins/` | Installed plugins |

To reconfigure at any time:

```bash
openacp onboard
```

---

## Next steps

- **Platform setup** — detailed guides for [Telegram](../platform-setup/telegram.md), [Discord](../platform-setup/discord.md), and [Slack](../platform-setup/slack.md)
- **[Configuration](../self-hosting/configuration.md)** — all config options explained
- **[Agents](../using-openacp/agents.md)** — configure and switch between agents
- **[Daemon Mode](../self-hosting/daemon-mode.md)** — running OpenACP as a background service
- **[Voice & Speech](../using-openacp/voice-and-speech.md)** — voice messages and audio responses
