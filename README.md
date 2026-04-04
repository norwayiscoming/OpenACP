<div align="center">

# OpenACP

**Control AI coding agents from Telegram, Discord & Slack**

Send a message. The agent writes code. You see everything — in real time.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D%2020-green.svg)](https://nodejs.org/)
[![ACP Protocol](https://img.shields.io/badge/Protocol-ACP-purple.svg)](https://agentclientprotocol.org/)
[![npm](https://img.shields.io/npm/v/@openacp/cli.svg)](https://www.npmjs.com/package/@openacp/cli)
[![Twitter Follow](https://img.shields.io/twitter/follow/openacp_ai?style=social)](https://x.com/openacp_ai)

[Documentation](https://openacp.gitbook.io/docs) · [Quick Start](#quick-start) · [Features](#features) · [Agents](#supported-agents) · [Contributing](https://openacp.gitbook.io/docs/extending/contributing)

</div>

---

## What is OpenACP?

OpenACP is a self-hosted bridge that connects AI coding agents to your messaging platforms. You chat with an AI agent through Telegram, Discord, or Slack — it reads your codebase, writes code, runs commands, and streams results back to you in real time.

Built on the open [Agent Client Protocol (ACP)](https://agentclientprotocol.org/). Your machine, your keys, your data.

```
You (Telegram / Discord / Slack)
  ↓
OpenACP (bridge + session manager)
  ↓
AI Agent (Claude Code, Codex, Gemini, Cursor, ...)
  ↓
Your Codebase
```

<div align="center">
<table>
<tr>
<td align="center"><img src="docs/images/menu.png" width="250" /><br /><b>Control Panel</b><br />Manage sessions, agents, and settings</td>
<td align="center"><img src="docs/images/agent-working.png" width="250" /><br /><b>Agent at Work</b><br />Plans, reads files, writes code</td>
</tr>
<tr>
<td align="center"><img src="docs/images/tool-calls.png" width="250" /><br /><b>Real-time Tool Calls</b><br />See every action the agent takes</td>
<td align="center"><img src="docs/images/skills.png" width="250" /><br /><b>Agent Skills</b><br />Brainstorming, TDD, debugging & more</td>
</tr>
</table>
</div>

## Installation

**Requirements:** Node.js 20+ (the installer handles this for you)

### macOS

```bash
curl -fsSL https://raw.githubusercontent.com/Open-ACP/OpenACP/main/scripts/install.sh | bash
```

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Open-ACP/OpenACP/main/scripts/install.sh | bash
```

> Works on Debian/Ubuntu, Fedora/RHEL, Arch, and other distros. Also supports WSL (Windows Subsystem for Linux).

### Windows

Open PowerShell and run:

```powershell
powershell -c "irm https://raw.githubusercontent.com/Open-ACP/OpenACP/main/scripts/install.ps1 | iex"
```

> Requires PowerShell 5.1+ (built into Windows 10/11).

### Manual install via npm

If you already have Node.js 20+ installed:

```bash
npm install -g @openacp/cli
openacp
```

---

After installation, the **interactive setup wizard** walks you through everything:

1. Choose your platform (Telegram, Discord, Slack, or multiple)
2. Connect your bot (token validation + auto-detection)
3. Pick a workspace directory
4. Select your default AI agent
5. Choose run mode (foreground or daemon)

That's it. Send a message to your bot and start coding.

> **Need detailed setup for a specific platform?** See the [Platform Setup guides](https://openacp.gitbook.io/docs/platform-setup).

## Features

### Messaging Platforms

| Platform | Status | Highlights |
|----------|--------|------------|
| **Telegram** | Stable | Forum topics per session, streaming, permission buttons, voice |
| **Discord** | Stable | Thread-based sessions, slash commands, button interactions |
| **Slack** | Stable | Socket Mode, channel-based sessions, thread organization |

### Core

- **28+ AI agents** — Claude Code, Codex, Gemini, Cursor, Copilot, and [more](#supported-agents)
- **Session management** — Each conversation gets its own thread/topic with auto-naming
- **Session persistence** — Sessions survive restarts, with configurable TTL
- **Permission control** — Approve or deny agent actions via buttons, with optional auto-approve
- **Real-time streaming** — See agent thinking, tool calls, and output as they happen
- **Agent switching** — Switch agents mid-conversation with `/switch`; history carries over automatically

### Developer Tools

- **Tunnel & port forwarding** — Expose local ports to the internet (Cloudflare, ngrok, bore, Tailscale)
- **Built-in file viewer** — Monaco Editor with syntax highlighting, diffs, and markdown preview
- **Session transfer** — Move sessions between terminal and chat (`/handoff`)
- **Agent switch** — Change which AI agent handles your session mid-conversation (`/switch`)
- **Voice & speech** — Send voice messages, get spoken responses (Groq STT + Edge TTS)
- **Usage tracking** — Token counts, cost reports, optional monthly budget limits
- **Context resume** — Resume sessions with full conversation history

### Operations

- **Daemon mode** — Run as a background service with auto-start on boot
- **CLI API** — Full REST API for automation (`openacp api ...`)
- **Plugin system** — Install adapters as npm packages
- **Doctor diagnostics** — `openacp doctor` checks everything and suggests fixes
- **Structured logging** — Pino with rotation, per-session log files

> **Full feature documentation** — [Documentation](https://openacp.gitbook.io/docs)

## Supported Agents

OpenACP uses the [ACP Registry](https://agentclientprotocol.com/get-started/registry) — new agents are available as soon as they're registered.

| Agent | Type | Description |
|-------|------|-------------|
| [Claude Code](https://github.com/anthropics/claude-code) | npx | Anthropic's Claude coding agent |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | npx | Google's Gemini CLI |
| [Codex CLI](https://github.com/openai/codex) | npx | OpenAI's coding assistant |
| [GitHub Copilot](https://github.com/github/copilot-cli) | npx | GitHub's AI pair programmer |
| [Cursor](https://www.cursor.com/) | binary | Cursor's coding agent |
| [Cline](https://github.com/cline/cline) | npx | Autonomous coding agent |
| [goose](https://github.com/block/goose) | binary | Open source AI agent by Block |
| [Amp](https://github.com/tao12345666333/amp-acp) | binary | The frontier coding agent |
| [Auggie CLI](https://www.augmentcode.com/) | npx | Augment Code's context engine |
| [Junie](https://www.jetbrains.com/) | binary | AI coding agent by JetBrains |
| [Kilo](https://github.com/kilocode/kilo) | npx | Open source coding agent |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | npx | Alibaba's Qwen assistant |
| ...and more | | [Full registry →](https://agentclientprotocol.com/get-started/registry) |

```bash
openacp agents                     # Browse all agents
openacp agents install <name>      # Install from registry
```

## CLI Overview

```bash
# Server
openacp                            # Start (first run = setup wizard)
openacp start / stop / restart     # Daemon management
openacp status                     # Check daemon status
openacp logs                       # Tail daemon logs

# Configuration
openacp config                     # Interactive config editor
openacp reset                      # Re-run setup wizard
openacp doctor                     # System diagnostics

# Sessions & API (requires running daemon)
openacp api new [agent] [workspace]
openacp api status
openacp api cancel <id>

# Tunnels
openacp tunnel add <port> [--label name]
openacp tunnel list
```

> **Full CLI reference** — [CLI Commands](https://openacp.gitbook.io/docs/api-reference/cli-commands)

## Documentation

| Section | Description |
|---------|-------------|
| [Getting Started](https://openacp.gitbook.io/docs/getting-started) | What is OpenACP, quickstart for users & developers |
| [Platform Setup](https://openacp.gitbook.io/docs/platform-setup) | Step-by-step guides for Telegram, Discord, Slack |
| [Using OpenACP](https://openacp.gitbook.io/docs/using-openacp) | Commands, sessions, agents, permissions, voice |
| [Self-Hosting](https://openacp.gitbook.io/docs/self-hosting) | Installation, configuration, daemon, security |
| [Features](https://openacp.gitbook.io/docs/features) | Tunnel, context resume, usage tracking, and more |
| [Extending](https://openacp.gitbook.io/docs/extending) | Plugin system, building adapters, contributing |
| [API Reference](https://openacp.gitbook.io/docs/api-reference) | CLI commands, REST API, config schema, env vars |
| [Troubleshooting](https://openacp.gitbook.io/docs/troubleshooting) | Common issues and FAQ |

## Star History

<a href="https://star-history.com/#Open-ACP/OpenACP&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Open-ACP/OpenACP&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Open-ACP/OpenACP&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Open-ACP/OpenACP&type=Date" />
 </picture>
</a>

## Contributing

We welcome contributions! See the [contributing guide](https://openacp.gitbook.io/docs/extending/contributing) for development setup, testing conventions, and PR process.

## Follow Us

[![Twitter Follow](https://img.shields.io/twitter/follow/openacp_ai?style=social)](https://x.com/openacp_ai)

## License

[MIT](LICENSE)
