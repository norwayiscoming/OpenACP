# Chat Commands

OpenACP responds to commands sent in your chat platform. This page covers every available command, how to use it, and which platforms support it.

## Platform comparison

| Command | Telegram | Discord | Notes |
|---|---|---|---|
| `/new` | Yes | Yes (`/new`) | Create a new agent session |
| `/newchat` | Yes | Yes | New chat, same agent and workspace |
| `/cancel` | Yes | Yes | Cancel current session prompt |
| `/status` | Yes | Yes | Show session or system status |
| `/sessions` | Yes | Yes | List all sessions |
| `/agents` | Yes | Yes | Browse installed and available agents |
| `/install` | Yes | Yes | Install an agent |
| `/menu` | Yes | Yes | Show interactive menu |
| `/resume` | Yes | No | Resume from Entire checkpoints |
| `/settings` | Yes | Yes | Change configuration in-chat |
| `/doctor` | Yes | Yes | Run system diagnostics |
| `/tunnel` | Yes | No | Create a public URL for a local port |
| `/tunnels` | Yes | No | List active tunnels |
| `/enable_dangerous` | Yes | No | Auto-approve all permissions |
| `/disable_dangerous` | Yes | No | Restore normal permission prompts |
| `/dangerous` | No | Yes | Toggle dangerous mode (Discord) |
| `/text_to_speech` | Yes | No | Toggle TTS for a session |
| `/tts` | No | Yes | Toggle TTS (Discord) |
| `/verbosity` | Yes | Yes | Set output detail level |
| `/usage` | Yes | No | View token usage and cost |
| `/archive` | Yes | No | Archive a session topic |
| `/summary` | Yes | No | Generate an AI summary of a session |
| `/handoff` | Yes | Yes | Continue session in your terminal |
| `/integrate` | Yes | Yes | Manage agent integrations |
| `/restart` | Yes | Yes | Restart OpenACP |
| `/update` | Yes | Yes | Update to latest version |
| `/clear` | Yes | Yes | Clear assistant history |
| `/help` | Yes | Yes | Show help text |

---

## Command reference

### `/new [agent] [workspace]`

Create a new agent session. If you omit arguments, OpenACP walks you through an interactive picker: choose your agent, then your project directory.

```
/new                          # interactive picker
/new claude                   # pick workspace interactively
/new claude ~/code/my-project # create directly
```

On Telegram, each session gets its own forum topic. On Discord, a new thread is created in the configured channel.

### `/newchat`

Start a fresh conversation with the same agent and workspace as the current session. Run this inside an existing session topic or thread. Useful when you want a clean context without changing your setup.

### `/cancel`

Abort the currently running prompt. The session stays active — you can send another message immediately. Run this inside a session topic or thread.

### `/status`

Show status for the current session (when run inside a session topic) or a system-wide summary of all sessions (when run in the main chat).

Session status includes: name, agent, status, workspace path, and queue depth.

### `/sessions`

List all sessions with their status and names. On Telegram, this also provides cleanup buttons to remove finished, errored, or all sessions.

### `/agents`

Browse installed and available agents. Installed agents are shown first, then the full registry with install buttons. The registry is paginated six entries at a time.

### `/install <name>`

Install an agent by name.

```
/install claude
/install gemini
```

Progress updates appear in-line. After installation, a button lets you start a session with the new agent immediately. If post-install setup steps are needed (e.g. API key configuration), they appear as copyable commands.

### `/menu`

Display an interactive inline keyboard with quick access to: New Session, Sessions, Status, Agents, Settings, Integrate, Restart, Update, Help, and Doctor.

### `/resume` (Telegram only)

Resume a session with conversation history loaded from Entire checkpoints. Supports multiple query formats:

```
/resume                                    # latest 5 sessions
/resume pr 19                              # by pull request number
/resume branch main                        # by branch name
/resume commit e0dd2fa4                    # by commit hash
/resume f634acf05138                       # by checkpoint ID
/resume https://entire.io/gh/.../...       # by Entire URL
/resume https://github.com/org/repo/pull/19
```

After the query, a workspace picker lets you choose which repository to load context from.

### `/settings`

Open an interactive settings panel. Toggle and select configuration values without editing config files. Some changes take effect immediately; others require a restart. Changes that need a restart show a notification.

### `/doctor`

Run system diagnostics. Checks configuration, agent dependencies, disk access, and connectivity. Results are shown inline with pass/warn/fail status. Fixable issues show a "Fix" button.

### `/tunnel <port> [label]` (Telegram only)

Create a public HTTPS URL for a local port. Useful when an agent starts a dev server and you need to access it from outside.

```
/tunnel 3000
/tunnel 3000 my-app
/tunnel stop 3000
```

### `/tunnels` (Telegram only)

List all active tunnels with their public URLs and stop buttons.

### `/enable_dangerous` / `/disable_dangerous` (Telegram) · `/dangerous` (Discord)

Toggle dangerous mode for the current session. When enabled, all permission requests are auto-approved without showing buttons. Run inside a session topic. See [Permissions](permissions.md) for details.

### `/text_to_speech [on|off]` (Telegram) · `/tts [on|off]` (Discord)

Toggle text-to-speech for the current session. Without an argument, enables TTS for the next message only. With `on`, enables persistently. With `off`, disables.

### `/verbosity low|medium|high`

Set how much detail OpenACP shows for agent activity.

- `low` — minimal output, title only
- `medium` — balanced (default)
- `high` — full detail including tool call content

### `/usage [today|week|month]` (Telegram only)

Show a token usage and cost report. Without arguments, shows today, this week, and this month. Pass a period to see just that range.

### `/archive` (Telegram only)

Archive the current session: stops the agent, removes the session record, and deletes the Telegram topic. This cannot be undone.

### `/summary` (Telegram only)

Ask the agent to summarize what it has accomplished in the current session. Works inside a session topic.

### `/handoff`

Generate a terminal command to continue the current session in your local terminal. The agent session ID is included so context is preserved.

### `/integrate`

Manage agent integrations — for example, installing the handoff integration that lets you resume sessions from the terminal.

### `/restart`

Restart OpenACP. Use this after configuration changes that cannot be hot-reloaded, or when something is stuck.

### `/update`

Check for a newer version and update in place. OpenACP restarts automatically after a successful update.

### `/clear`

Reset the assistant session history. Only works in the Assistant topic on Telegram.

### `/help`

Show a quick-reference help message.
