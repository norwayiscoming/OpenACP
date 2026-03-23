# Agent Management

OpenACP supports **28+ AI coding agents** from the official [ACP Registry](https://agentclientprotocol.com/get-started/registry). Agents are discovered, installed, and managed through both the CLI and Telegram.

## How It Works

Agent definitions are loaded from the [ACP Registry CDN](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json):
- A **bundled snapshot** ships with OpenACP for offline use
- A **local cache** (`~/.openacp/registry-cache.json`) refreshes every 24 hours
- Force-refresh: `openacp agents refresh`

Installed agents are stored in `~/.openacp/agents.json`.

---

## Quick Start

```bash
# Browse available agents
openacp agents

# Install an agent
openacp agents install gemini

# Login / setup (if needed)
openacp agents run gemini

# Create a session with the agent
openacp api new gemini ~/code/my-project
# Or from Telegram: /new gemini
```

---

## Browse Agents

### CLI

```bash
openacp agents
```

### Telegram

Use `/agents` — shows a paginated list with descriptions and install buttons.

---

## Install an Agent

### CLI

```bash
openacp agents install <name>
```

### Telegram

Use `/install <name>` or tap the install button in `/agents`.

After installation, setup steps are shown automatically. You can also view them anytime:

```bash
openacp agents info <name>
```

---

## Agent Setup Guide

Each agent has different authentication requirements. Here's how to set up every supported agent.

### Claude Agent

**Requires:** Claude CLI installed separately

```bash
# 1. Install Claude CLI
npm install -g @anthropic-ai/claude-code

# 2. Login (opens browser)
claude login

# 3. Install in OpenACP
openacp agents install claude
```

### Gemini CLI

**Auth:** Google account (free tier: 60 req/min, 1000 req/day)

```bash
# 1. Install
openacp agents install gemini

# 2. Login with Google (opens browser)
openacp agents run gemini
# Select "Sign in with Google" when prompted

# Alternative: use API key
export GEMINI_API_KEY="your-key"  # Get from aistudio.google.com/apikey
```

### Codex CLI

**Requires:** Codex CLI installed separately

```bash
# 1. Install Codex CLI
npm install -g @openai/codex

# 2. Login with ChatGPT account
codex
# Select "Sign in with ChatGPT"

# Alternative: use API key
export OPENAI_API_KEY="your-key"

# 3. Install in OpenACP
openacp agents install codex
```

### GitHub Copilot

**Requires:** Active GitHub Copilot subscription

```bash
# 1. Install
openacp agents install copilot

# 2. Login with GitHub
openacp agents run copilot
# Use /login command inside the CLI

# Alternative: use personal access token
export GITHUB_TOKEN="ghp_your-token"
# Token needs "Copilot Requests" permission
```

### Cursor

**Requires:** Active Cursor subscription

```bash
# 1. Install (downloads binary)
openacp agents install cursor

# 2. Login (opens browser for Cursor account)
openacp agents run cursor
```

### Cline

**Auth:** Supports 10+ providers (Anthropic, OpenAI, Gemini, Ollama, etc.)

```bash
# 1. Install
openacp agents install cline

# 2. Interactive auth setup
openacp agents run cline -- auth
# Follow prompts to select provider and enter API key

# Alternative: set env var for your provider
export ANTHROPIC_API_KEY="your-key"
# or: OPENAI_API_KEY, GOOGLE_API_KEY, etc.
```

### goose

**Auth:** Choose your LLM provider on first run

```bash
# 1. Install (downloads binary)
openacp agents install goose

# 2. First run auto-enters setup — choose provider
openacp agents run goose
# Options: OpenAI, Anthropic, Google Gemini, OpenRouter, local models

# Set provider API key
export OPENAI_API_KEY="your-key"  # or other provider

# Reconfigure anytime
goose configure
```

### Auggie CLI (Augment Code)

**Auth:** Augment Code account

```bash
# 1. Install
openacp agents install auggie

# 2. Login (opens browser)
openacp agents run auggie -- login
```

### Qwen Code

**Auth:** Qwen OAuth (free: 1000 req/day) or API key

```bash
# 1. Install
openacp agents install qwen

# 2. Login with Qwen OAuth (opens browser)
openacp agents run qwen
# Use /auth command, select "Qwen OAuth"

# Alternative: API key
export OPENAI_API_KEY="your-key"  # Configure in ~/.qwen/settings.json
```

### Kimi CLI

**Auth:** Kimi Code OAuth (recommended) or provider API key

```bash
# 1. Install (downloads binary)
openacp agents install kimi

# 2. Login
openacp agents run kimi
# Use /login command, select "Kimi Code" for browser OAuth
# Or select another provider and enter API key
```

### Junie (JetBrains)

**Auth:** Bring Your Own Key (BYOK)

```bash
# 1. Install (downloads binary)
openacp agents install junie

# 2. Set your provider API key
export ANTHROPIC_API_KEY="your-key"  # or OPENAI_API_KEY, etc.

# Free: up to $50 with Gemini 3 Flash included
```

### Kilo

**Auth:** Bring your own keys OR use Kilo Gateway (free models included)

```bash
# 1. Install
openacp agents install kilo

# 2a. Use Kilo Gateway (no API key needed, includes free models)
# Just run — Kilo Gateway is pay-as-you-go

# 2b. Or bring your own key
export ANTHROPIC_API_KEY="your-key"  # or OPENAI_API_KEY, etc.
```

### Mistral Vibe

**Auth:** Mistral API key or Free/Pro plan

```bash
# 1. Install (downloads binary)
openacp agents install mistral-vibe

# 2. Get API key from console.mistral.ai/codestral/cli
# Enter key when prompted on first run
```

### DeepAgents

**Auth:** LLM provider API key (powered by LangChain)

```bash
# 1. Install
openacp agents install deepagents

# 2. Set your LLM provider key
export OPENAI_API_KEY="your-key"
# or: ANTHROPIC_API_KEY, etc.
```

### crow-cli

**Requires:** uvx (Python package runner)

```bash
# 1. Install uv first
pip install uv

# 2. Install
openacp agents install crow-cli

# 3. Set your LLM provider API key
export ANTHROPIC_API_KEY="your-key"  # or other provider
```

### Amp

```bash
# Install (downloads binary)
openacp agents install amp
# Follow agent's first-run setup
```

### Autohand Code, Codebuddy Code, Corust Agent, DimCode, Factory Droid, fast-agent, Minion Code, Nova, OpenCode, pi ACP, Qoder CLI, Stakpak

These agents generally work with provider API keys:

```bash
# Install
openacp agents install <name>

# Set your preferred LLM provider key
export OPENAI_API_KEY="your-key"
# or: ANTHROPIC_API_KEY, GOOGLE_API_KEY, etc.
```

Check each agent's docs for specific requirements:
```bash
openacp agents info <name>
```

---

## Run Agent CLI Directly

Use `openacp agents run` to execute the agent's own CLI. This is useful for login, configuration, or troubleshooting:

```bash
openacp agents run <name> [-- <args>]
```

Examples:

```bash
openacp agents run gemini                  # Start Gemini CLI (for login)
openacp agents run gemini -- auth login    # Specific auth command
openacp agents run claude -- login         # Claude login
openacp agents run cline -- auth           # Cline auth setup
openacp agents run goose -- configure      # Reconfigure goose provider
```

---

## Per-Session Agent Selection

Choose which agent to use when creating a session:

### Telegram

```
/new                    # Shows agent picker if multiple installed
/new gemini             # Use specific agent
/new claude ~/code/app  # Agent + workspace
```

### CLI

```bash
openacp api new gemini ~/code/my-project
```

---

## Distribution Types

| Type | How it works | Examples |
|------|-------------|----------|
| **npx** | Node.js package, downloaded on first run | Claude, Gemini, Codex, Cline, Copilot, Auggie, Qwen |
| **uvx** | Python package, downloaded on first run | crow-cli, fast-agent, Minion Code |
| **binary** | Platform binary, downloaded to `~/.openacp/agents/` | Cursor, goose, Amp, Junie, Kilo, Kimi, Mistral Vibe |

---

## Uninstall

```bash
openacp agents uninstall <name>
```

- **npx/uvx**: Removes from agents.json (package cache managed by npm/uv)
- **binary**: Removes from agents.json AND deletes `~/.openacp/agents/<name>/`

---

## Refresh Registry

```bash
openacp agents refresh
```

New agents registered in the [ACP Registry](https://agentclientprotocol.com/get-started/registry) become available immediately after refresh.

---

## File Locations

| Path | Description |
|------|-------------|
| `~/.openacp/agents.json` | Installed agents database |
| `~/.openacp/registry-cache.json` | Cached registry (24h TTL) |
| `~/.openacp/agents/<name>/` | Downloaded binary agents |
