# Configuration Schema

Config is stored at `~/.openacp/config.json`. The file is created with defaults on first run. All fields support backward-compatible migrations; old configs load without errors.

Edit interactively with `openacp config`, or set individual values with `openacp config set <path> <value>`.

---

## channels

Channel adapters. Each adapter key under `channels` is an object. The built-in Telegram and Discord adapters ship with OpenACP; Slack and others are plugin-based.

### channels.telegram.*

| Field | Type | Default | Description |
|---|---|---|---|
| `channels.telegram.enabled` | boolean | `false` | Enable the Telegram adapter |
| `channels.telegram.botToken` | string | `"YOUR_BOT_TOKEN_HERE"` | Telegram Bot API token (from @BotFather) |
| `channels.telegram.chatId` | number | `0` | Telegram group/supergroup chat ID |
| `channels.telegram.notificationTopicId` | number \| null | `null` | Forum topic ID for system notifications |
| `channels.telegram.assistantTopicId` | number \| null | `null` | Forum topic ID for the Assistant |
| `channels.telegram.displayVerbosity` | `"low"` \| `"medium"` \| `"high"` | `"medium"` | Controls how much detail is shown in messages |

### channels.discord.*

| Field | Type | Default | Description |
|---|---|---|---|
| `channels.discord.enabled` | boolean | `false` | Enable the Discord adapter |
| `channels.discord.botToken` | string | `"YOUR_DISCORD_BOT_TOKEN_HERE"` | Discord bot token |
| `channels.discord.guildId` | string | `""` | Discord server (guild) ID |
| `channels.discord.forumChannelId` | string \| null | `null` | Forum channel ID for session threads |
| `channels.discord.notificationChannelId` | string \| null | `null` | Channel ID for system notifications |
| `channels.discord.assistantThreadId` | string \| null | `null` | Thread ID for the Assistant |
| `channels.discord.displayVerbosity` | `"low"` \| `"medium"` \| `"high"` | `"medium"` | Controls message verbosity |

### channels.slack.*

Slack support is provided via a plugin adapter. Fields follow the schema below when the Slack plugin is installed.

| Field | Type | Default | Description |
|---|---|---|---|
| `channels.slack.enabled` | boolean | `false` | Enable the Slack adapter |
| `channels.slack.botToken` | string | — | Slack bot OAuth token (`xoxb-...`) |
| `channels.slack.appToken` | string | — | Slack app-level token for Socket Mode (`xapp-...`) |
| `channels.slack.signingSecret` | string | — | Slack signing secret for request verification |
| `channels.slack.notificationChannelId` | string | — | Channel ID for system notifications |
| `channels.slack.allowedUserIds` | string[] | `[]` | Slack user IDs permitted to interact |
| `channels.slack.channelPrefix` | string | `"openacp"` | Prefix for auto-created Slack channels |
| `channels.slack.autoCreateSession` | boolean | `true` | Auto-create a session on first message |
| `channels.slack.startupChannelId` | string | — | Channel to post startup notification to |

### Base channel fields (all adapters)

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Whether this channel is active |
| `adapter` | string | — | Package name for plugin-based adapters |
| `displayVerbosity` | `"low"` \| `"medium"` \| `"high"` | `"medium"` | Message detail level |

---

## agents

Map of named agent configurations. Each key is an agent name used in `defaultAgent` and session creation.

| Field | Type | Default | Description |
|---|---|---|---|
| `agents.<name>.command` | string | — | Executable to spawn (e.g. `claude-agent-acp`) |
| `agents.<name>.args` | string[] | `[]` | Arguments passed to the command |
| `agents.<name>.workingDirectory` | string | — | Default working directory for this agent |
| `agents.<name>.env` | object | `{}` | Additional environment variables for the subprocess |

**Example**
```json
"agents": {
  "claude": { "command": "claude-agent-acp", "args": [], "env": {} },
  "codex":  { "command": "codex", "args": ["--acp"], "env": {} }
}
```

---

## defaultAgent

| Field | Type | Default | Description |
|---|---|---|---|
| `defaultAgent` | string | `"claude"` | Agent name used when no agent is specified in a session |

---

## workspace

| Field | Type | Default | Description |
|---|---|---|---|
| `workspace.baseDir` | string | `"~/openacp-workspace"` | Base directory for agent working directories. `~` is expanded. Named workspaces are created as subdirectories. |

---

## security

| Field | Type | Default | Description |
|---|---|---|---|
| `security.allowedUserIds` | string[] | `[]` | Whitelist of channel user IDs permitted to start sessions. Empty list allows all users. |
| `security.maxConcurrentSessions` | number | `20` | Maximum number of simultaneously active sessions |
| `security.sessionTimeoutMinutes` | number | `60` | Minutes of inactivity before a session is automatically closed |

---

## logging

| Field | Type | Default | Description |
|---|---|---|---|
| `logging.level` | `"silent"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"` | `"info"` | Log verbosity level |
| `logging.logDir` | string | `"~/.openacp/logs"` | Directory for log files |
| `logging.maxFileSize` | string \| number | `"10m"` | Maximum size per log file before rotation |
| `logging.maxFiles` | number | `7` | Number of rotated log files to retain |
| `logging.sessionLogRetentionDays` | number | `30` | Days to retain per-session log files |

---

## api

| Field | Type | Default | Description |
|---|---|---|---|
| `api.port` | number | `21420` | Port for the local REST API server |
| `api.host` | string | `"127.0.0.1"` | Host/interface to bind. Change to `0.0.0.0` to expose externally (not recommended without firewall rules). |

---

## runMode

| Field | Type | Default | Description |
|---|---|---|---|
| `runMode` | `"foreground"` \| `"daemon"` | `"foreground"` | How `openacp` (no args) starts the server. `daemon` forks to a background process. |

---

## autoStart

| Field | Type | Default | Description |
|---|---|---|---|
| `autoStart` | boolean | `false` | Whether to register OpenACP as a system service that starts on login |

---

## sessionStore

| Field | Type | Default | Description |
|---|---|---|---|
| `sessionStore.ttlDays` | number | `30` | Days before session records are purged from the store |

---

## tunnel

| Field | Type | Default | Description |
|---|---|---|---|
| `tunnel.enabled` | boolean | `false` | Enable the built-in tunnel service |
| `tunnel.port` | number | `3100` | Default local port the tunnel service listens on |
| `tunnel.provider` | `"cloudflare"` \| `"ngrok"` \| `"bore"` \| `"tailscale"` | `"cloudflare"` | Tunnel provider |
| `tunnel.options` | object | `{}` | Provider-specific options (passed through to the tunnel process) |
| `tunnel.maxUserTunnels` | number | `5` | Maximum number of simultaneous user-created tunnels |
| `tunnel.storeTtlMinutes` | number | `60` | Minutes before expired tunnel entries are cleaned up |
| `tunnel.auth.enabled` | boolean | `false` | Require authentication to access tunnel endpoints |
| `tunnel.auth.token` | string | — | Auth token for tunnel access (when `tunnel.auth.enabled` is true) |

---

## usage

| Field | Type | Default | Description |
|---|---|---|---|
| `usage.enabled` | boolean | `true` | Track token/cost usage per session |
| `usage.monthlyBudget` | number | — | Monthly spending limit in `usage.currency` |
| `usage.warningThreshold` | number | `0.8` | Fraction of budget at which to send a warning (0–1) |
| `usage.currency` | string | `"USD"` | Currency for budget tracking |
| `usage.retentionDays` | number | `90` | Days to retain usage records |

---

## speech

### speech.stt.*

| Field | Type | Default | Description |
|---|---|---|---|
| `speech.stt.provider` | string \| null | `null` | Active STT provider name (e.g. `"groq"`) |
| `speech.stt.providers.<name>.apiKey` | string | — | API key for the named provider |
| `speech.stt.providers.<name>.model` | string | — | Model identifier for the named provider |

### speech.tts.*

| Field | Type | Default | Description |
|---|---|---|---|
| `speech.tts.provider` | string \| null | `null` | Active TTS provider name |
| `speech.tts.providers.<name>.apiKey` | string | — | API key for the named provider |
| `speech.tts.providers.<name>.model` | string | — | Model identifier for the named provider |

---

## integrations

Tracks installed agent integrations (managed automatically by `openacp agents install` / `openacp integrate`).

| Field | Type | Description |
|---|---|---|
| `integrations.<name>.installed` | boolean | Whether the integration is installed |
| `integrations.<name>.installedAt` | string | ISO 8601 timestamp of installation |
