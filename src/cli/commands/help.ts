export function printHelp(): void {
  console.log(`
\x1b[1mOpenACP\x1b[0m — Self-hosted bridge for AI coding agents
Connect messaging platforms (Telegram, Discord) to 28+ AI coding agents via ACP protocol.

\x1b[1mGetting Started:\x1b[0m
  openacp                              First run launches setup wizard
  openacp                              After setup, starts the server

\x1b[1mServer:\x1b[0m
  openacp                              Start (mode from config)
  openacp start                        Start as background daemon  \x1b[2m[--json]\x1b[0m
  openacp stop                         Stop background daemon       \x1b[2m[--json]\x1b[0m
  openacp restart                      Restart (same mode)          \x1b[2m[--json]\x1b[0m
  openacp restart --foreground         Restart in foreground mode
  openacp restart --daemon             Restart as background daemon
  openacp attach                       Attach to running daemon
  openacp status                       Show daemon status           \x1b[2m[--json]\x1b[0m
  openacp logs                         Tail daemon log file
  openacp --foreground                 Force foreground mode

\x1b[1mAgent Management:\x1b[0m
  openacp agents                       Browse all agents (installed + available)  \x1b[2m[--json]\x1b[0m
  openacp agents install <name>        Install an agent from the ACP Registry     \x1b[2m[--json]\x1b[0m
  openacp agents uninstall <name>      Remove an installed agent                  \x1b[2m[--json]\x1b[0m
  openacp agents info <name>           Show details, dependencies & setup guide   \x1b[2m[--json]\x1b[0m
  openacp agents run <name> [-- args]  Run agent CLI directly (login, config...)
  openacp agents refresh               Force-refresh agent list from registry

  \x1b[2mExamples:\x1b[0m
    openacp agents install gemini           Install Gemini CLI
    openacp agents run gemini               Login to Google (first run)
    openacp agents info cursor              See setup instructions

\x1b[1mConfiguration:\x1b[0m
  openacp config                       Interactive config editor
  openacp config set <key> <value>     Set a config value  \x1b[2m[--json]\x1b[0m
  openacp onboard                      Re-run onboarding setup wizard
  openacp reset                        Re-run setup wizard
  openacp update                       Update to latest version
  openacp doctor                       Run system diagnostics  \x1b[2m[--json]\x1b[0m
  openacp doctor --dry-run             Check only, don't fix

\x1b[1mPlugins:\x1b[0m
  openacp install <package>            Install adapter plugin    \x1b[2m[--json]\x1b[0m
  openacp uninstall <package>          Remove adapter            \x1b[2m[--json]\x1b[0m
  openacp plugins                      List installed plugins    \x1b[2m[--json]\x1b[0m
  openacp plugin create                Scaffold a new plugin project

\x1b[1mDevelopment:\x1b[0m
  openacp dev <plugin-path>            Run with local plugin (hot-reload)
  openacp dev <path> --no-watch        Run without file watching
  openacp dev <path> --verbose         Run with verbose logging

\x1b[1mSession Transfer:\x1b[0m
  openacp integrate <agent>            Install handoff integration
  openacp integrate <agent> --uninstall
  openacp adopt <agent> <id>           Adopt an external session  \x1b[2m[--json]\x1b[0m

\x1b[1mTunnels:\x1b[0m
  openacp tunnel add <port> [--label name]  Create tunnel to local port  \x1b[2m[--json]\x1b[0m
  openacp tunnel list                       List active tunnels           \x1b[2m[--json]\x1b[0m
  openacp tunnel stop <port>                Stop a tunnel                 \x1b[2m[--json]\x1b[0m
  openacp tunnel stop-all                   Stop all user tunnels         \x1b[2m[--json]\x1b[0m

\x1b[1mDaemon API:\x1b[0m \x1b[2m(requires running daemon)\x1b[0m
  openacp api status                   Active sessions     \x1b[2m[--json]\x1b[0m
  openacp api session <id>             Session details     \x1b[2m[--json]\x1b[0m
  openacp api new [agent] [workspace]  Create session      \x1b[2m[--json]\x1b[0m
  openacp api send <id> <prompt>       Send prompt         \x1b[2m[--json]\x1b[0m
  openacp api cancel <id>              Cancel session      \x1b[2m[--json]\x1b[0m
  openacp api bypass <id> on|off       Toggle bypass permissions  \x1b[2m[--json]\x1b[0m
  openacp api topics [--status ...]    List topics         \x1b[2m[--json]\x1b[0m
  openacp api cleanup [--status ...]   Cleanup old topics  \x1b[2m[--json]\x1b[0m
  openacp api health                   System health check \x1b[2m[--json]\x1b[0m
  openacp api restart                  Restart daemon      \x1b[2m[--json]\x1b[0m

\x1b[1mWorkspace Flags:\x1b[0m
  --local              Use workspace in current directory
  --global             Use global workspace (~/.openacp)
  --dir <path>         Use workspace at specified directory
  --from <path>        Copy settings from existing workspace (on create)
  --name <name>        Set workspace name (on create)

\x1b[1mOutput Flags:\x1b[0m
  --json               Output result as JSON (single-line, stdout)
                       Commands marked \x1b[2m[--json]\x1b[0m support machine-readable output.
                       Success: { "success": true, "data": { ... } }
                       Error:   { "success": false, "error": { "code": "...", "message": "..." } }

\x1b[2mMore info: https://github.com/Open-ACP/OpenACP\x1b[0m
`)
}
