# Slack Adapter Setup Guide

This guide walks you through setting up the OpenACP Slack adapter to run AI coding sessions directly in Slack.

## Prerequisites

Before starting, make sure you have:

- **Slack workspace admin access** — required to create and configure the app
- **Node.js >= 20** installed
- At least one ACP agent installed (e.g., `claude-agent-acp`)
- An existing OpenACP installation with `~/.openacp/config.json`

## Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Choose **From scratch**
4. Enter your app name (e.g., `OpenACP`)
5. Select your Slack workspace
6. Click **Create App**

## Enable Socket Mode

Socket Mode lets your app connect via WebSocket instead of webhooks — essential for interactive features like permission buttons.

1. In your app settings, go to **Socket Mode** (left sidebar)
2. Toggle **Enable Socket Mode**
3. You'll be prompted to create an **App-Level Token**
4. Click **Generate Token and Events**
5. Name the token (e.g., `openacp-token`)
6. Select scopes: check **`connections:write`**
7. Click **Generate**
8. **Copy and save the token** — it starts with `xapp-1-...` — you'll need it as `appToken` in config

Keep this token in a secure location.

## Configure Bot Token Scopes

1. Go to **OAuth & Permissions** (left sidebar)
2. Scroll to **Bot Token Scopes**
3. Click **Add an OAuth Scope** and add these scopes:
   - `channels:manage` — create and archive public channels
   - `chat:write` — post messages to channels
   - `chat:write.public` — post in channels without joining first
   - `channels:join` — join channels when needed
   - `channels:read` — list and inspect channels
   - `groups:write` — manage private channels (optional, for private channel support)

## Enable Interactivity

Permission buttons require interactivity to be enabled.

1. Go to **Interactivity & Shortcuts** (left sidebar)
2. Toggle **Interactivity** to On
3. Set **Request URL** to your OpenACP server (e.g., `https://your-server.com/slack/interactions`)
   - If running locally, you'll need to expose it via ngrok or similar tunnel
   - Format: `https://your-domain/slack/interactions`
4. Save changes

Note: If you don't have a public URL yet, you can enable this after setting up Socket Mode and running OpenACP locally.

## Install App to Workspace

1. Go to **Install App** (left sidebar under "Settings")
2. Click **Install to Workspace**
3. Review the requested permissions
4. Click **Allow**
5. You'll be redirected to a page showing your **Bot User OAuth Token**
6. **Copy and save the Bot User OAuth Token** — it starts with `xoxb-...` — you'll need it as `botToken` in config

## Get Signing Secret

1. Go back to **Basic Information** (left sidebar)
2. Scroll down to **App Credentials**
3. Copy the **Signing Secret** — you'll need it as `signingSecret` in config

## Configure OpenACP

Edit `~/.openacp/config.json` and add the Slack adapter configuration:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "adapter": "slack",
      "botToken": "xoxb-...",
      "appToken": "xapp-1-...",
      "signingSecret": "...",
      "notificationChannelId": "C...",
      "allowedUserIds": ["U..."],
      "channelPrefix": "openacp"
    }
  }
}
```

### Configuration Fields

| Field | Description |
|-------|-------------|
| `enabled` | Set to `true` to enable the Slack adapter |
| `adapter` | Must be `"slack"` |
| `botToken` | Bot User OAuth Token from OAuth & Permissions page (starts with `xoxb-`) |
| `appToken` | App-Level Token from Socket Mode (starts with `xapp-1-`) |
| `signingSecret` | Signing Secret from Basic Information page |
| `notificationChannelId` | *Optional* — Slack channel ID for system notifications. Get it by right-clicking a channel → View Details → copy ID from URL |
| `allowedUserIds` | *Optional* — Array of allowed Slack user IDs. If empty, all users can create sessions. Get IDs by opening user profile → click the vertical dots → copy user ID |
| `channelPrefix` | Prefix for auto-created session channels. Default: `openacp`. Session channels will be named `{prefix}-{slug}-{sessionId}` |

Example with all fields:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "adapter": "slack",
      "botToken": "YOUR_BOT_TOKEN",
      "appToken": "YOUR_APP_TOKEN",
      "signingSecret": "abcd1234efgh5678ijkl9012",
      "notificationChannelId": "C1234567890",
      "allowedUserIds": ["U1234567890", "U0987654321"],
      "channelPrefix": "openacp"
    }
  }
}
```

## Getting Slack User IDs

To restrict access to specific users, you need their Slack user IDs:

1. Open the user's profile in Slack (click their name)
2. Click the vertical `•••` menu
3. Click **Copy user ID**
4. Paste it into the `allowedUserIds` array

## Start OpenACP

```bash
openacp start
```

If everything is configured correctly, OpenACP will:
1. Connect to Slack via Socket Mode
2. Listen for messages and interactions
3. Create session channels as needed

Check the logs for any connection errors. If Socket Mode fails, verify your `appToken` and `signingSecret` are correct.

## How It Works

### Session Model

Each OpenACP session in Slack gets its own dedicated channel, enabling isolated conversations and maintaining context:

1. User sends `/new [agent] [workspace]` in any Slack channel where the bot is present
2. OpenACP creates a new private channel named `openacp-{slug}-{sessionId}` (e.g., `openacp-my-app-abc123`)
3. User can send coding requests in the session channel
4. Agent responds with streaming text, tool calls, and code
5. When the agent needs permission (e.g., to run a command or edit a file), inline buttons appear
6. User clicks **Allow** or **Deny** to approve/reject
7. When the session ends or is cancelled, OpenACP archives the channel for record-keeping

### Commands

| Command | Description |
|---------|-------------|
| `/new [agent] [workspace]` | Create a new session with specified agent and workspace |
| `/newchat` | Create a new session with the same agent and workspace as the current one |
| `/cancel` | Cancel the current session |
| `/status` | Show current session status or system status |
| `/agents` | List available agents |
| `/help` | Show help message |

### Examples

```
/new claude my-app          → Claude session in ~/openacp-workspace/my-app/
/new codex api-server       → Codex session in ~/openacp-workspace/api-server/
/new claude ~/code/project  → Claude session with absolute path
/new                        → Default agent and workspace
/newchat                    → New session with current agent/workspace
/cancel                     → Cancel current session
```

### Session Flow

1. Send `/new claude my-project` to create a session
2. OpenACP creates channel `openacp-my-project-{id}`
3. Send your coding request (e.g., "Add a login form to my app")
4. Agent responds with analysis, code, and tool calls
5. If the agent needs to run a command or edit a file:
   - An interactive button appears: **[Allow]** **[Deny]**
   - Click **Allow** to proceed, **Deny** to skip
6. When done, use `/cancel` or let the session timeout (default 60 minutes)
7. The channel is archived automatically for later reference

## Troubleshooting

### "Bot is not a member of the channel"

The bot needs to join session channels to post messages. If you see this error:

1. Verify the bot is a member of the workspace
2. Check that `channels:join` scope is enabled in your app's OAuth scopes
3. Try manually adding the bot to a test channel to verify permissions

### "Socket Mode connection failed"

If OpenACP can't connect to Slack:

1. Verify `appToken` starts with `xapp-1-`
2. Double-check that Socket Mode is enabled in your app settings
3. Check that the token hasn't expired (regenerate if needed)
4. Look at OpenACP logs for detailed error messages

### "Invalid signing secret"

Interactivity requests are failing:

1. Go to **Basic Information** and copy the **Signing Secret** again
2. Make sure there are no extra spaces or characters
3. Update `~/.openacp/config.json` and restart OpenACP

### "Interactivity request timeout"

If permission buttons aren't responding:

1. Verify the **Request URL** in Interactivity & Shortcuts is correct and publicly accessible
2. If running locally, use ngrok to expose: `ngrok http 3000` (adjust port as needed)
3. Set the Request URL to `https://your-ngrok-url/slack/interactions`
4. Make sure OpenACP is running and listening on the correct port

### "Rate limited by Slack"

If the bot suddenly stops responding:

1. Slack enforces rate limits on API calls — concurrent sessions may hit limits
2. The bot will automatically retry, but you may see delays
3. Reduce the number of concurrent sessions or add delays between commands
4. Check the OpenACP logs for rate limit warnings

### "Permission denied" when running commands

If the agent can't execute commands or edit files:

1. Check that the session workspace directory exists and is writable
2. Verify the user clicked **Allow** on the permission button
3. Check OpenACP logs for detailed permission errors
4. Ensure the agent has the required scopes (usually `chat:write`, `channels:manage`)

## Environment Variables

Override config values using environment variables (useful for CI/CD or secrets):

| Variable | Overrides |
|----------|-----------|
| `OPENACP_CONFIG_PATH` | Config file location |
| `OPENACP_SLACK_BOT_TOKEN` | `channels.slack.botToken` |
| `OPENACP_SLACK_APP_TOKEN` | `channels.slack.appToken` |
| `OPENACP_SLACK_SIGNING_SECRET` | `channels.slack.signingSecret` |
| `OPENACP_DEFAULT_AGENT` | `defaultAgent` |
| `OPENACP_DEBUG` | Enable debug logging (`1`) |

Example:

```bash
export OPENACP_SLACK_BOT_TOKEN="xoxb-..."
export OPENACP_SLACK_APP_TOKEN="xapp-1-..."
openacp start
```

## Next Steps

- Read [setup-guide.md](setup-guide.md) for general OpenACP configuration and agent setup
- Check [acp-guide.md](acp-guide.md) for details on the Agent Client Protocol
- Run `/help` in Slack to see all available commands
