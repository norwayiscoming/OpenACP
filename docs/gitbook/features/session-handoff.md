# Session Handoff

## What it is

Session handoff lets you transfer a running agent session from your terminal to your phone (or any other device with Telegram or Discord), or in the other direction. You start a session in the terminal, realize you want to continue the conversation on the go, and hand it off to your messaging app with a single command.

No state is lost. The agent process keeps running; only the "owner" of the session changes from the terminal to the chat interface.

---

## Use case: terminal to phone

A typical flow:

1. You are working at your desk with Claude Code open in the terminal.
2. You need to step away but want to keep supervising the agent.
3. You run `openacp integrate` (or trigger the `/openacp:handoff` slash command from inside the agent).
4. The session appears as a new topic in your Telegram group or Discord server.
5. You continue sending prompts and approving permission requests from your phone.

---

## How it works

Handoff relies on two components installed by `openacp integrate`:

### 1. Inject hook (`openacp-inject-session.sh`)

This shell script runs as an agent hook (e.g. on every new conversation turn for Claude Code). It reads the agent's session ID and working directory from the hook payload and injects them as context variables so the agent is always aware of its own ACP session ID.

### 2. Handoff script (`openacp-handoff.sh`)

This script calls `openacp adopt <agent> <session_id>` to register the terminal session with the running OpenACP daemon, making it visible in the messaging platform.

```bash
# Manually trigger a handoff
openacp-handoff.sh <session_id> [working_directory] [channel]
```

### 3. Slash command / skill

`openacp integrate` also installs a slash command (for Claude Code: `/openacp:handoff`) that instructs the agent to run the handoff script automatically:

```
/openacp:handoff              # hand off to the default adapter
/openacp:handoff telegram     # hand off specifically to Telegram
/openacp:handoff discord      # hand off to Discord
```

---

## Installation

Run the integrate command to install hooks for a supported agent:

```bash
openacp integrate
```

This is interactive and asks which agent to integrate (Claude Code, Cursor, Gemini CLI, GitHub Copilot, Cline, Codex, etc.). It installs scripts to the agent's hooks directory and adds an entry to the agent's settings file.

To uninstall:

```bash
openacp integrate --uninstall
```

---

## Requirements

- The OpenACP daemon must be running in daemon mode (`openacp start --daemon`) on the same machine as the terminal agent.
- The daemon must have at least one messaging adapter (Telegram or Discord) configured and connected.
- `jq` must be installed on the machine (`brew install jq` on macOS, `apt install jq` on Linux). The inject hook uses `jq` to parse the agent's hook payload.

---

## Supported agents

`openacp integrate` supports agents that expose a hook system for injecting context into every session. Currently supported agents include Claude Code, Cursor, Gemini CLI, GitHub Copilot CLI, Cline, OpenAI Codex, and others. Run `openacp integrate --list` to see the full list.
