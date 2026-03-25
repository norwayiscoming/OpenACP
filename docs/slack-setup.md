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
   - `channels:history` — **required** to receive message events from public channels
   - `channels:join` — join channels when needed
   - `channels:read` — list and inspect channels
   - `chat:write` — post messages to channels
   - `chat:write.public` — post in channels without joining first
   - `groups:write` — manage private channels
   - `groups:history` — **required** to receive message events from private channels
   - `groups:read` — list private channels
   - `files:read` — read file content (required for voice message transcription)
   - `files:write` — upload audio files (required for TTS voice replies)

> **Important:** Without `channels:history` and `groups:history`, the bot will join channels and receive events via Socket Mode but will silently drop all incoming messages — no errors, no logs. These scopes are required for the bot to receive `message` events.

## Subscribe to Bot Events

After configuring scopes, subscribe to the message events the bot needs to receive:

1. Go to **Event Subscriptions** (left sidebar)
2. Toggle **Enable Events** to On
3. Scroll to **Subscribe to bot events**
4. Click **Add Bot User Event** and add:
   - `message.channels` — receive messages from public channels the bot is in
   - `message.groups` — receive messages from private channels the bot is in
5. Click **Save Changes**
6. Re-install the app to your workspace (**Install App** → **Reinstall to Workspace**) so the new scopes and events take effect

> **Note:** In Socket Mode, event subscriptions work over the WebSocket connection — no public URL needed. But you still must add the events here for Slack to deliver them to your app.

## Enable Interactivity

Permission buttons (Allow / Deny) require interactivity to be enabled.

1. Go to **Interactivity & Shortcuts** (left sidebar)
2. Toggle **Interactivity** to On
3. In Socket Mode, Slack routes interactive payloads over the same WebSocket — **no Request URL is needed**. You can leave the Request URL field blank or set a placeholder.
4. Save changes

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

## Voice Messages (Speech-to-Text & Text-to-Speech)

OpenACP supports voice interactions in Slack — record audio clips and receive spoken replies.

### How It Works

- **Speech-to-Text (STT):** Record an audio clip using Slack's built-in microphone button. OpenACP transcribes it automatically and sends the text to the agent.
- **Text-to-Speech (TTS):** When enabled, the agent's response is synthesized into audio and uploaded as a playable file in the session channel.

### Setting Up STT (Speech-to-Text)

STT uses [Groq](https://console.groq.com/) with Whisper for fast, free transcription (~8 hours/day on free tier).

1. **Get a Groq API key** at [console.groq.com](https://console.groq.com/) (free account)
2. **Add speech config** to `~/.openacp/config.json`:

```json
{
  "speech": {
    "stt": {
      "provider": "groq",
      "providers": {
        "groq": {
          "apiKey": "gsk_..."
        }
      }
    }
  }
}
```

Or use environment variables:

```bash
export OPENACP_SPEECH_STT_PROVIDER=groq
export OPENACP_SPEECH_GROQ_API_KEY=gsk_...
```

3. **Verify Slack app scopes** — your bot must have `files:read` scope (see [Configure Bot Token Scopes](#configure-bot-token-scopes)). If you added this scope after initial install, **reinstall the app** to your workspace.

4. **Restart OpenACP** and send an audio clip in a session channel. You should see a `🎤 You said: ...` transcription message.

### Setting Up TTS (Text-to-Speech)

TTS uses Microsoft Edge TTS (free, no API key needed).

1. **Add TTS config** to `~/.openacp/config.json`:

```json
{
  "speech": {
    "tts": {
      "provider": "edge-tts"
    }
  }
}
```

2. **Verify Slack app scopes** — your bot must have `files:write` scope (see [Configure Bot Token Scopes](#configure-bot-token-scopes)). Reinstall the app if you added this scope after initial install.

3. **Restart OpenACP**. The agent will include a spoken version in its replies, uploaded as an audio file in the channel.

### Available TTS Voices

You can select a voice in the config:

```json
{
  "speech": {
    "tts": {
      "provider": "edge-tts",
      "providers": {
        "edge-tts": {
          "voice": "en-US-AriaNeural"
        }
      }
    }
  }
}
```

Some popular voices:

| Voice | Language |
|-------|----------|
| `en-US-AriaNeural` | English (US, female) — default |
| `en-US-GuyNeural` | English (US, male) |
| `en-GB-SoniaNeural` | English (UK, female) |
| `vi-VN-HoaiMyNeural` | Vietnamese (female) |
| `vi-VN-NamMinhNeural` | Vietnamese (male) |
| `ja-JP-NanamiNeural` | Japanese (female) |
| `ko-KR-SunHiNeural` | Korean (female) |
| `zh-CN-XiaoxiaoNeural` | Chinese (female) |

## Troubleshooting

### Voice transcription returns "could not process file"

The bot downloaded an HTML page instead of the actual audio file. This happens when the `files:read` scope is missing.

1. Go to **OAuth & Permissions → Bot Token Scopes** and verify `files:read` is listed
2. **Reinstall the app** to your workspace (required after adding new scopes)
3. Restart OpenACP

### Voice transcription not happening (agent says "I can't process audio")

STT is not configured. See [Setting Up STT](#setting-up-stt-speech-to-text) above.

### Messages sent by users are completely ignored (no response, no logs)

1. **Missing `channels:history` or `groups:history` scope** — Without these, Slack does not deliver `message` events to the bot even in Socket Mode. Go to **OAuth & Permissions → Bot Token Scopes** and add both. Then reinstall the app.

2. **Missing event subscriptions** — Go to **Event Subscriptions → Subscribe to bot events** and confirm `message.channels` and `message.groups` are listed. Add them if missing, then reinstall.

3. **App not reinstalled after changes** — Slack requires a workspace reinstall for new scopes and events to take effect. Go to **Install App → Reinstall to Workspace**.

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
