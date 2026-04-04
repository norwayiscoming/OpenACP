# Daemon Mode

## Foreground vs Daemon

OpenACP can run in two modes, controlled by the `runMode` config field.

**Foreground** (`runMode: "foreground"`) — The process stays attached to your terminal. Log output is printed to stdout. The process exits when you close the terminal or press Ctrl+C. Use this during initial setup, debugging, or when you want to watch logs in real time.

**Daemon** (`runMode: "daemon"`) — The process detaches from the terminal and runs in the background. Output is written to a log file. The process survives terminal closure. This is the recommended mode for production self-hosting.

## Commands

All daemon commands use the `openacp` CLI:

```bash
openacp start       # Start (foreground or daemon depending on runMode config)
openacp stop        # Send SIGTERM to the daemon, wait up to 5 s, then SIGKILL
openacp status      # Print running/stopped and PID if running
openacp logs        # Tail the daemon log file
openacp restart     # stop + start
openacp attach      # Connect to running daemon: show status + tail logs
```

### `openacp start`

When `runMode` is `daemon`, this spawns a detached child process (`--daemon-child` flag) and returns immediately. The child writes its PID to the PID file and begins accepting messages.

When `runMode` is `foreground`, this runs the server in the current process.

### `openacp stop`

Reads the PID file and sends `SIGTERM`. Polls every 100 ms for up to 5 seconds waiting for the process to exit. If the process does not exit within 5 seconds, `SIGKILL` is sent. The PID file is removed after a successful stop.

Calling `stop` also removes the running marker file (`~/.openacp/running`), which suppresses autostart on the next boot.

### `openacp restart`

Equivalent to `stop` followed by `start`. If no daemon is running, it skips the stop step and starts a new one. Useful after updating OpenACP to pick up the new version without manually stopping first.

### `openacp status`

Checks whether the PID in the PID file is alive (using `kill -0`). Cleans up stale PID files automatically.

### `openacp logs`

Tails `~/.openacp/logs/openacp.log`. In daemon mode this is where all server output goes.

### `openacp attach`

Connects to a running daemon and shows a rich status display (uptime, active sessions, adapters, tunnel status) followed by live log tailing. Press Ctrl+C to detach without affecting the daemon.

Useful when you want to monitor a daemon that was started earlier or by autostart, without managing it as a foreground process.

## Smart startup

When you run `openacp` (no arguments) and a daemon is already running, instead of printing an error, OpenACP shows a rich status display with an interactive menu:

| Key | Action |
|-----|--------|
| `r` | Restart the daemon |
| `f` | Restart in foreground mode |
| `s` | Show full status details |
| `l` | Tail the log file |
| `q` | Quit |

The display also shows which instance is active (global vs. local) and suggests the local instance when one is available but the global is being used.

You can force a specific mode on startup:

```bash
openacp start --foreground    # force foreground regardless of config
openacp start --daemon        # force daemon regardless of config
```

## File Locations

| File | Path | Purpose |
|---|---|---|
| PID file | `~/.openacp/openacp.pid` | Process ID of the running daemon |
| Log file | `~/.openacp/logs/openacp.log` | Daemon stdout/stderr and application logs |
| Running marker | `~/.openacp/running` | Written on start, removed on stop; used to decide whether to autostart on boot |
| Port file | `~/.openacp/api.port` | Current API port (written by the server on startup) |

## Autostart on Boot

OpenACP can register itself to start automatically when you log in. This is configured separately per platform.

### macOS — LaunchAgent

On macOS, autostart uses a user-level `launchd` plist:

```
~/Library/LaunchAgents/com.openacp.daemon.plist
```

When autostart is enabled, the plist is written and loaded with `launchctl load`. The daemon is configured with `RunAtLoad: true` and `KeepAlive` set to restart on non-zero exit. Log output goes to `~/.openacp/logs/openacp.log`.

To enable autostart from the CLI:

```bash
openacp config     # → Run Mode → Enable auto-start
```

Or via onboard:

```bash
openacp onboard    # → Run Mode → switch to daemon mode (enables autostart automatically)
```

To remove the LaunchAgent:

```bash
openacp config     # → Run Mode → Disable auto-start
```

This runs `launchctl unload` and deletes the plist file.

### Linux — systemd User Service

On Linux, autostart uses a systemd user service:

```
~/.config/systemd/user/openacp.service
```

When autostart is enabled, the unit file is written and enabled with `systemctl --user enable openacp`. The service uses `Restart=on-failure`.

To enable or disable, use the same `openacp config` or `openacp onboard` flow as on macOS.

### Windows

Autostart is not supported natively on Windows. Use WSL2 and follow the Linux instructions, or configure a Windows Task Scheduler entry manually pointing to the WSL binary.

## When to Use Each Mode

| Scenario | Recommended mode |
|---|---|
| First-time setup | Foreground — watch the logs live |
| Debugging a problem | Foreground with `OPENACP_DEBUG=true` |
| Persistent personal server | Daemon with autostart enabled |
| CI / container | Foreground (process managed by container runtime) |
| Server with uptime requirements | Daemon + systemd (Linux) or LaunchAgent (macOS) |
