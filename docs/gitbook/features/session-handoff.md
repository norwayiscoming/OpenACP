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

## How to set up handoff

### Step 1: Install the integration

Run the integrate command and follow the prompts:

```bash
openacp integrate
```

You will be asked which agent to integrate (Claude Code, Cursor, Gemini CLI, GitHub Copilot, Cline, Codex, etc.). The command installs the necessary hooks so your agent can hand off sessions to OpenACP.

To uninstall later:

```bash
openacp integrate --uninstall
```

### Step 2: Use the handoff command

Once integrated, you can hand off any session from your terminal to your messaging app:

```
/openacp:handoff              # hand off to the default platform
/openacp:handoff telegram     # hand off specifically to Telegram
/openacp:handoff discord      # hand off to Discord
```

The session appears as a new topic in your Telegram group or Discord server. You can continue sending prompts and approving permission requests from your phone.

---

## Requirements

- The OpenACP daemon must be running (`openacp start`) on the same machine as the terminal agent.
- At least one messaging adapter (Telegram, Discord, or Slack) must be configured and connected.
- `jq` must be installed on the machine (`brew install jq` on macOS, `apt install jq` on Linux).

---

## Supported agents

Currently supported agents include Claude Code, Cursor, Gemini CLI, GitHub Copilot CLI, Cline, OpenAI Codex, and others. Run `openacp integrate --list` to see the full list.

---

## Technical details

Handoff relies on two shell scripts installed by `openacp integrate`:

- **Inject hook** (`openacp-inject-session.sh`) — runs as an agent hook on every conversation turn, reads the agent's session ID from the hook payload, and injects it as a context variable.
- **Handoff script** (`openacp-handoff.sh`) — calls `openacp adopt <agent> <session_id>` to register the terminal session with the running OpenACP daemon, making it visible in the messaging platform.
