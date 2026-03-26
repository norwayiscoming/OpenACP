# Telegram Setup

This guide walks you through connecting OpenACP to Telegram. OpenACP uses a Telegram Supergroup with Topics enabled — each coding session gets its own topic thread for an organized, isolated workspace.

## Prerequisites

- A Telegram account
- OpenACP installed: `npm install -g @openacp/cli`
- At least one ACP agent installed (e.g., `claude-agent-acp`)

---

## Step 1: Create a Bot via BotFather

1. Open Telegram and search for [@BotFather](https://t.me/BotFather), or click that link.
2. Send the command `/newbot`.
3. BotFather will ask for a name — enter a display name (e.g., `My OpenACP Bot`).
4. BotFather will then ask for a username — enter a unique username ending in `bot` (e.g., `myopenacp_bot`).
5. BotFather replies with your **bot token**. It looks like:
   ```
   123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
6. Copy and save this token somewhere safe. You will need it in Step 6.

> **Important:** Your bot token is a secret. Anyone with this token can control your bot. Never share it publicly or commit it to version control.

---

## Step 2: Create a Supergroup with Topics Enabled

OpenACP requires a Telegram **Supergroup** with the **Topics** feature enabled. Topics create forum-like threads — one per coding session.

1. In Telegram, tap the compose icon and select **New Group**.
2. Add your bot as a member (search for its username).
3. Give the group a name (e.g., `OpenACP`) and create it.
4. Open the group → tap the group name at the top → **Edit** (pencil icon).
5. Scroll down and enable **Topics**.
6. Save the changes. Telegram converts the group to a Supergroup automatically.

---

## Step 3: Add the Bot as Admin

The bot must be an administrator with the following permissions to manage topics and send messages:

1. Open the group → tap the group name → **Administrators**.
2. Tap **Add Administrator**.
3. Search for your bot by username and select it.
4. Make sure these permissions are enabled:
   - **Manage Topics** — required to create and rename session topics
   - **Send Messages** — required to send responses
   - **Delete Messages** — recommended for cleanup
5. Tap **Save**.

> OpenACP validates that the bot is an administrator during setup. If it is not, setup will fail with an error and prompt you to fix it.

---

## Step 4: Get the Chat ID

The Chat ID is the unique numeric identifier for your Supergroup. You need it for the config.

**Option A: Use the OpenACP setup wizard (recommended)**

The interactive wizard auto-detects your Chat ID. Run:

```bash
openacp
```

When prompted for the Chat ID, send any message in your group. The wizard polls the Telegram API for updates and reports the group it sees:

```
Group detected: My OpenACP Bot (-1001234567890)
```

**Option B: Use @RawDataBot**

Forward any message from your group to [@RawDataBot](https://t.me/raw_data_bot). It replies with the raw update JSON, which includes `"chat": {"id": -1001234567890, ...}`. The Chat ID is the negative number starting with `-100`.

**Option C: Use the Telegram API directly**

```
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```

Replace `<YOUR_TOKEN>` with your bot token. Send a message in the group first, then open this URL. Look for `"chat": {"id": ...}` in the response.

---

## Step 5: Configure OpenACP

Edit `~/.openacp/config.json` and fill in the Telegram section (see the [full configuration reference](../self-hosting/configuration.md) for all available options):

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "chatId": -1001234567890,
      "notificationTopicId": null,
      "assistantTopicId": null
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `enabled` | Set to `true` to activate the Telegram adapter |
| `botToken` | The token from BotFather (Step 1) |
| `chatId` | The Supergroup's Chat ID — negative number starting with `-100` (Step 4) |
| `notificationTopicId` | Leave `null` — OpenACP creates this topic on first start |
| `assistantTopicId` | Leave `null` — OpenACP creates this topic on first start |

> **Tip:** You can also run `openacp` (the interactive setup wizard) instead of editing the file manually. The wizard validates your token and auto-detects the Chat ID.

---

## Step 6: Start OpenACP and Test

Start OpenACP:

```bash
openacp start
```

Expected output:

```
[info] Telegram adapter started
[info] Notification topic created (id: 2)
[info] Assistant topic created (id: 3)
[info] OpenACP ready
```

Open your Telegram group. You should see two new topics appear automatically.

To create your first coding session, use the `/new` command in the group's **General** topic or the **Assistant** topic:

```
/new claude my-project
```

OpenACP creates a new topic thread for this session.

---

## Step 7: System Topics (Auto-Created on First Start)

On first start, OpenACP automatically creates two system topics in your group:

| Topic | Purpose |
|-------|---------|
| **Notifications** (`📋 Notifications`) | Receives completion summaries, error alerts, and permission request notifications with deep links back to the relevant session topic |
| **Assistant** (`🤖 Assistant`) | An always-on AI helper session. Send questions here to get guidance on using OpenACP, creating sessions, or troubleshooting |

The topic IDs are saved to your config automatically:

```json
{
  "channels": {
    "telegram": {
      "notificationTopicId": 2,
      "assistantTopicId": 3
    }
  }
}
```

On subsequent restarts, OpenACP reuses these existing topics rather than creating new ones.

---

## Step 8: Session Topics

Each `/new` command creates a dedicated forum topic for that coding session:

- **Real-time streaming** — agent responses appear as the model generates them, with message edits batched at ~1-second intervals to avoid Telegram rate limits.
- **Auto-naming** — after the first prompt, the topic is renamed to a short 5-word summary of the task (e.g., `Add login form to app`).
- **Prompt queue** — send multiple messages while the agent is processing; they are queued and processed in order.
- **Permission buttons** — when the agent needs approval to run a command or modify a file, inline **Allow / Always Allow / Reject** buttons appear in the topic.
- **Skill commands** — the agent publishes available skills as inline buttons, pinned at the top of the topic.
- **Viewer links** — if the tunnel feature is enabled, tool calls include clickable links to an in-browser file or diff viewer.

When the session ends, the topic stays open for reference. Use `/cancel` to cancel a running session.

---

## Environment Variables

You can pass credentials via environment variables instead of editing the config file. This is useful in scripts or CI environments:

```bash
export OPENACP_TELEGRAM_BOT_TOKEN="123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export OPENACP_TELEGRAM_CHAT_ID="-1001234567890"
openacp start
```

| Variable | Config path |
|----------|-------------|
| `OPENACP_TELEGRAM_BOT_TOKEN` | `channels.telegram.botToken` |
| `OPENACP_TELEGRAM_CHAT_ID` | `channels.telegram.chatId` |

Environment variables take precedence over values in `config.json`.

---

## Troubleshooting

**Bot is not responding**
- Confirm the bot is added to the group and is an administrator.
- Verify `enabled: true` in the config.
- Check `~/.openacp/logs/` for error messages.

**"Chat is not a supergroup" error**
- The group must be a Supergroup. Go to Group Settings and convert it if needed.
- If the group was just created, wait a moment and try again.

**Topics not appearing**
- Topics must be enabled in the group settings before OpenACP starts.
- The bot needs **Manage Topics** admin permission.

**Chat ID is not detected**
- Make sure you sent a message in the group after adding the bot.
- Press `m` in the setup wizard to enter the Chat ID manually.

For more detailed troubleshooting, see [Telegram Issues](../troubleshooting/telegram-issues.md).
