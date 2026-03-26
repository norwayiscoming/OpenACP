# CLI Commands

All commands are invoked as `openacp <command> [subcommand] [options]`. Every command accepts `-h` / `--help` for inline help.

---

## adopt

Transfers an existing external agent session into OpenACP so it appears as a messaging thread. Requires a running daemon.

**Usage**
```
openacp adopt <agent> <session_id> [--cwd <path>] [--channel <name>]
```

**Options**

| Flag | Description |
|---|---|
| `--cwd <path>` | Working directory for the session (default: current directory) |
| `--channel <name>` | Target channel adapter, e.g. `telegram`, `discord` (default: first registered) |

**Examples**
```bash
openacp adopt claude abc123-def456
openacp adopt claude abc123 --cwd /path/to/project
openacp adopt claude abc123 --channel discord
```

---

## agents

Browse and manage AI coding agents from the ACP Registry.

**Usage**
```
openacp agents [subcommand]
```

### agents (no subcommand)

Lists all installed agents and agents available to install from the registry.

**Example**
```bash
openacp agents
```

### agents install

Installs an agent from the ACP Registry. Automatically installs the handoff integration if the agent supports it.

```
openacp agents install <name> [--force]
```

| Flag | Description |
|---|---|
| `--force` | Reinstall even if already installed |

```bash
openacp agents install claude
openacp agents install gemini --force
```

### agents uninstall

Removes an installed agent and its handoff integration (if any).

```
openacp agents uninstall <name>
```

```bash
openacp agents uninstall gemini
```

### agents info

Shows version, distribution type, command, setup steps, and installation status for an agent.

```
openacp agents info <name>
```

```bash
openacp agents info cursor
openacp agents info claude
```

### agents run

Runs the agent's CLI directly (useful for first-run login and configuration). ACP-specific flags are automatically stripped before passing arguments.

```
openacp agents run <name> [-- <args>]
```

Use `--` to separate OpenACP flags from agent-specific arguments.

```bash
openacp agents run gemini          # Login to Google (first run)
openacp agents run copilot         # Login to GitHub Copilot
openacp agents run cline           # Configure API keys
```

### agents refresh

Force-refreshes the agent catalog from the ACP Registry, bypassing the normal staleness check.

```
openacp agents refresh
```

---

## api

Interacts with a running OpenACP daemon over the local REST API. Requires a running daemon (`openacp start`).

**Usage**
```
openacp api <subcommand> [args]
```

### api cancel

Cancels a session.

```
openacp api cancel <session-id>
```

### api cleanup

Deletes finished topics from channel adapters.

```
openacp api cleanup [--status <statuses>]
```

`--status` accepts a comma-separated list (e.g. `finished,error`). Defaults to finished topics.

### api config

Shows or updates runtime config. Prefer `openacp config` for general use — it works whether the daemon is running or not.

```
openacp api config
openacp api config set <key> <value>
```

### api dangerous

Enables or disables dangerous mode for a session. When enabled, the agent runs destructive commands without confirmation prompts.

```
openacp api dangerous <session-id> on|off
```

### api delete-topic

Deletes a topic for a given session ID.

```
openacp api delete-topic <session-id> [--force]
```

`--force` deletes even if the session is currently active.

### api health

Shows system health: status, uptime, version, memory, session counts, adapters, and tunnel status.

```
openacp api health
```

### api new

Creates a new session.

```
openacp api new [agent] [workspace]
openacp api new [agent] --workspace <path>
```

Both `agent` and `workspace` are optional. Uses `defaultAgent` and `workspace.baseDir` from config if omitted.

```bash
openacp api new
openacp api new claude /path/to/project
openacp api new gemini --workspace /path/to/project
```

### api notify

Sends a notification message to all registered channel adapters.

```
openacp api notify <message>
```

All remaining arguments are joined into the message.

```bash
openacp api notify "Deployment complete"
```

### api restart

Sends a restart signal to the running daemon.

```
openacp api restart
```

### api send

Sends a prompt to a session. The prompt is enqueued; responses arrive asynchronously via the channel adapter.

```
openacp api send <session-id> <prompt>
```

All arguments after `<session-id>` are joined as the prompt.

```bash
openacp api send abc123 "Fix the login bug"
openacp api send abc123 refactor the auth module
```

### api session

Shows detailed information about one session.

```
openacp api session <session-id>
```

### api status

Lists all active sessions with ID, agent, status, and name.

```
openacp api status
```

### api topics

Lists topics across all channel adapters.

```
openacp api topics [--status <statuses>]
```

`--status` accepts a comma-separated filter (e.g. `active,finished`).

### api tunnel

Shows tunnel status (provider, URL).

```
openacp api tunnel
```

### api version

Shows the version of the currently running daemon.

```
openacp api version
```

---

## config

Views and edits configuration. Works with both a running and a stopped daemon.

**Usage**
```
openacp config
openacp config set <key> <value>
```

`openacp config` (no args) opens an interactive terminal editor. When the daemon is running, changes are applied live via the API; otherwise the config file is edited directly.

`openacp config set` applies a single value by dot-notation path. Values are JSON-parsed if possible, otherwise treated as strings.

```bash
openacp config set defaultAgent claude
openacp config set security.maxConcurrentSessions 5
openacp config set channels.telegram.botToken "123:ABC"
```

---

## doctor

Runs system diagnostics. Checks config validity, agent availability, dependencies, and connectivity. Fixable issues can be auto-repaired interactively.

**Usage**
```
openacp doctor [--dry-run]
```

| Flag | Description |
|---|---|
| `--dry-run` | Report issues only; do not apply any fixes |

---

## install

Installs an adapter plugin from npm into `~/.openacp/plugins/`.

**Usage**
```
openacp install <package>
```

```bash
openacp install @openacp/adapter-discord
```

---

## integrate

Manages agent integrations that enable features like session handoff from an agent to OpenACP.

**Usage**
```
openacp integrate <agent>
openacp integrate <agent> --uninstall
```

```bash
openacp integrate claude
openacp integrate claude --uninstall
```

---

## logs

Tails the daemon log file (last 50 lines, then follows new output). Equivalent to `tail -f`. Press Ctrl+C to stop.

**Usage**
```
openacp logs
```

Log directory is configured via `logging.logDir` (default: `~/.openacp/logs/`).

---

## onboard

Runs the first-run setup wizard if no config exists. If config already exists, runs the reconfiguration wizard, which allows modifying or disabling individual channels, agents, workspace settings, run mode, and integrations. Individual sections (e.g. a specific channel) can be modified, disabled, or deleted without affecting the rest of the config.

**Usage**
```
openacp onboard
```

---

## plugins

Lists all plugins installed in `~/.openacp/plugins/`.

**Usage**
```
openacp plugins
```

---

## reset

Deletes all OpenACP data (`~/.openacp`) and allows starting fresh. This is destructive — config, plugins, and agent data are removed. The daemon must be stopped first.

**Usage**
```
openacp reset
```

Prompts for confirmation before proceeding.

---

## restart

There is no standalone `restart` command. Use `openacp api restart` to restart a running daemon, or stop and start it manually:

```bash
openacp stop && openacp start
```

---

## start

Starts OpenACP as a background daemon. Requires an existing config (run `openacp` first to set up).

**Usage**
```
openacp start
```

---

## status

Shows whether the OpenACP daemon is running and its PID.

**Usage**
```
openacp status
```

---

## stop

Sends a stop signal to the running daemon.

**Usage**
```
openacp stop
```

---

## tunnel

Manages tunnels to local ports. Requires a running daemon.

**Usage**
```
openacp tunnel <subcommand> [args]
```

### tunnel add

Creates a tunnel to a local port.

```
openacp tunnel add <port> [--label <name>] [--session <id>]
```

```bash
openacp tunnel add 3000
openacp tunnel add 8080 --label "dev server"
```

### tunnel list

Lists all active tunnels with their ports, labels, and public URLs.

```
openacp tunnel list
```

### tunnel stop

Stops the tunnel for a specific local port.

```
openacp tunnel stop <port>
```

### tunnel stop-all

Stops all user tunnels.

```
openacp tunnel stop-all
```

---

## uninstall

Removes an adapter plugin.

**Usage**
```
openacp uninstall <package>
```

```bash
openacp uninstall @openacp/adapter-discord
```

---

## update

Checks npm for the latest version of `@openacp/cli` and installs it if an update is available.

**Usage**
```
openacp update
```

---

## (no command / --foreground)

Running `openacp` with no arguments starts the server. On first run, the setup wizard launches. After setup, behavior depends on `runMode` in config:

- `foreground` — runs in the current terminal.
- `daemon` — spawns a background process and exits.

`openacp --foreground` forces foreground mode regardless of config.

---

## --version / -v

Prints the installed version.

```bash
openacp --version
```

---

## --help / -h

Prints the top-level help message listing all commands.

```bash
openacp --help
```
