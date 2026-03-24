# Discord Setup

Step-by-step guide to create a Discord bot and configure it for OpenACP.

## 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"** (top right)
3. Enter a name (e.g., `OpenACP Bot`) → click **Create**

## 2. Create the Bot

1. In your application, go to **Bot** (left sidebar)
2. Click **"Reset Token"** → confirm → **copy the token** (you'll need it later)
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** — required for reading messages in threads

> **Important:** Save your bot token somewhere safe. You can only see it once — if you lose it, you'll need to reset it.

## 3. Invite the Bot to Your Server

1. Go to **OAuth2** → **URL Generator** (left sidebar)
2. Under **Scopes**, check:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, check:
   - **Manage Channels** — create forum/notification channels
   - **Send Messages** — send messages in threads
   - **Send Messages in Threads** — respond in session threads
   - **Create Public Threads** — create session threads in forum
   - **Manage Threads** — archive/unarchive/rename threads
   - **Manage Messages** — edit/delete bot messages
   - **Embed Links** — send rich embeds
   - **Attach Files** — send files, images, audio
   - **Read Message History** — read thread history
   - **Use Slash Commands** — register `/new`, `/cancel`, etc.
   - **Add Reactions** — add status reactions
4. Copy the **Generated URL** at the bottom
5. Open it in your browser → select your server → **Authorize**

### Quick Permission Integer

If you prefer using the permission integer directly, use **`328565073936`** which includes all the permissions listed above. Your invite URL will look like:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=328565073936
```

Replace `YOUR_APP_ID` with your application ID (found in **General Information**).

## 4. Get Your Server (Guild) ID

1. In Discord, go to **User Settings** → **Advanced** → enable **Developer Mode**
2. Right-click your server name in the sidebar → **Copy Server ID**

This is the Guild ID you'll enter during OpenACP setup.

## 5. Run OpenACP Setup

```bash
openacp
```

When prompted:
- **Bot token**: paste the token from step 2
- **Guild ID**: paste the server ID from step 4

OpenACP will validate your token and automatically create the necessary channels:
- **`openacp-sessions`** — forum channel where each session gets its own thread
- **`openacp-notifications`** — text channel for system notifications

## 6. Verify It Works

After setup, you should see:
1. Two new channels in your server (`openacp-sessions` and `openacp-notifications`)
2. Slash commands available (type `/` in any channel to see them)
3. Try `/new` to create your first session

## Slash Commands

| Command | Description |
|---------|-------------|
| `/new [agent] [workspace]` | Create a new coding session |
| `/newchat` | New session with same agent & workspace |
| `/cancel` | Cancel current session |
| `/status` | Show session or system status |
| `/sessions` | List all sessions |
| `/menu` | Open the control panel |
| `/handoff` | Get terminal resume command |
| `/agents` | Browse available agents |
| `/install <name>` | Install an agent |
| `/help` | Show help |

## Session Threads

Each `/new` command creates a **forum thread** in the sessions channel:
- **Real-time streaming** — agent responses stream as they're generated
- **Auto-naming** — thread is renamed after first prompt
- **File & image support** — send files, images, or audio directly in the thread
- **Permission buttons** — Allow / Reject buttons when agent needs approval
- **Skill commands** — available agent skills shown as buttons

## Troubleshooting

### Bot doesn't respond to slash commands
- Make sure you checked `applications.commands` in the OAuth2 scopes
- Slash commands are guild-scoped — they should appear within seconds
- Try `/help` first to verify the bot is online

### "Missing Permissions" errors
- The bot needs **Manage Channels** to create the forum and notification channels
- Check that the bot's role is high enough in the role hierarchy
- In the specific channels, make sure the bot isn't denied permissions by channel overrides

### "Message Content Intent" errors
- Go to Developer Portal → Bot → enable **Message Content Intent**
- This is required for the bot to read messages in threads

### Channels not created
- The bot needs **Manage Channels** permission on the server
- If your server has **Community** enabled, OpenACP creates a Forum channel
- If not, it creates a text channel and uses threads instead

### Files not sending/receiving
- The bot needs **Attach Files** permission
- Discord has a 25MB file size limit
- Supported: images, text files, code files, audio, PDFs, etc.

## Environment Variables

You can also configure Discord via environment variables:

```bash
OPENACP_DISCORD_BOT_TOKEN=your_token openacp
OPENACP_DISCORD_GUILD_ID=123456789012345678 openacp
```
