# Logging

## Log Levels

OpenACP uses [Pino](https://github.com/pinojs/pino) for structured logging. The valid levels, in ascending severity order, are:

| Level | When to use |
|---|---|
| `silent` | Suppress all output |
| `debug` | Verbose internals — ACP events, session state transitions, config loads |
| `info` | Normal operational events — server start, session created/completed, channel connected |
| `warn` | Non-fatal issues — stale PID file, insecure file permissions, failed validation with fallback |
| `error` | Failures that affect functionality but do not crash the process |
| `fatal` | Unrecoverable errors before process exit |

The default level is `info`.

## Configuration

```json
"logging": {
  "level": "info",
  "logDir": "~/.openacp/logs",
  "maxFileSize": "10m",
  "maxFiles": 7,
  "sessionLogRetentionDays": 30
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `level` | string | `"info"` | Minimum level to emit |
| `logDir` | string | `"~/.openacp/logs"` | Directory for log files. `~` is expanded to the home directory. |
| `maxFileSize` | string \| number | `"10m"` | Maximum size per log file before rotation. Accepts bytes or suffixes: `k`, `m`, `g`. |
| `maxFiles` | number | `7` | Number of rotated log files to keep. |
| `sessionLogRetentionDays` | number | `30` | Per-session log files older than this are deleted at startup. |

Change these values via `openacp config` (Logging section) or by editing `~/.openacp/config.json` directly.

## Log Files

The main log file is:

```
~/.openacp/logs/openacp.log
```

This file receives all log output from the running process, including the daemon's stdout and stderr when in daemon mode. It is rotated using `pino-roll` when it reaches `maxFileSize`. Up to `maxFiles` rotated files are retained.

To tail the log in real time:

```bash
openacp logs
```

Or directly:

```bash
tail -f ~/.openacp/logs/openacp.log
```

## Per-Session Logs

Each session gets its own log file under:

```
~/.openacp/logs/sessions/<sessionId>.log
```

Session log entries are written simultaneously to the session file and to the main `openacp.log` (with the `sessionId` field present on every record). This lets you review a single session's history in isolation without filtering the combined log.

Session log files are cleaned up automatically at startup. Any file in `~/.openacp/logs/sessions/` whose last modification time is older than `sessionLogRetentionDays` days is deleted.

## Debug Mode

To enable debug logging without editing the config file, set `OPENACP_DEBUG=true`:

```bash
OPENACP_DEBUG=true openacp start
```

This sets the log level to `debug` at runtime, provided `OPENACP_LOG_LEVEL` is not also set. Debug output includes:

- Full ACP event payloads from agent subprocesses
- Session state machine transitions
- Config load and migration details
- API request routing

You can also override the level directly:

```bash
OPENACP_LOG_LEVEL=debug openacp start
```

## Structured JSON Format

Log entries are written to files as newline-delimited JSON (Pino's default format). Each line is a self-contained JSON object. Example:

```json
{"level":30,"time":1711234567890,"pid":12345,"hostname":"host","module":"core","msg":"Server started","port":21420}
```

The terminal transport uses `pino-pretty` for human-readable coloured output. The file transport writes raw JSON for easy ingestion by log aggregators (Loki, Datadog, etc.).

Common fields on every log record:

| Field | Description |
|---|---|
| `level` | Numeric Pino level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) |
| `time` | Unix timestamp in milliseconds |
| `module` | Source module (e.g., `"core"`, `"session"`, `"api-server"`) |
| `sessionId` | Present on session-scoped records |
| `msg` | Human-readable message |
