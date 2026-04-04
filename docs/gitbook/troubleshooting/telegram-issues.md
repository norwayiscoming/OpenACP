# Telegram Issues

Run `openacp doctor` first — it validates your bot token, chat ID, group type, and admin status automatically.

If you haven't finished initial setup, see the [Telegram Setup guide](../platform-setup/telegram.md) first.

---

### Bot doesn't respond to messages

**Symptoms:** You send a message in Telegram but the bot stays silent.

**Cause:** The most common cause is that the bot is not an administrator in the group, or the `chatId` in your config does not match the actual group.

**Solution:**
1. Open your Telegram group → **Edit → Administrators** → add your bot and enable at minimum "Manage Topics".
2. Confirm the chat ID in `~/.openacp/config.json` matches the group. The ID of a supergroup is negative (e.g., `-1001234567890`).
3. Restart OpenACP after making changes.

---

### "Not enough rights" error in logs

**Symptoms:** OpenACP logs show `Not enough rights` or `TOPIC_CLOSED` errors when trying to send messages.

**Cause:** The bot lacks administrator permissions in the group, or topics (forum mode) are not enabled.

**Solution:**
1. Promote the bot to administrator in the group settings.
2. Enable Topics: **Group Settings → Topics → Enable**.
3. The group must be a **supergroup** — regular groups do not support topics. Convert it via **Group Settings → Advanced → Convert to Supergroup**.

---

### Topics are not created on startup

**Symptoms:** OpenACP starts without error but no "Notifications" or "Assistant" topics appear in the group.

**Cause:** The group does not have forum/topics mode enabled, or the bot is not an admin with topic management rights.

**Solution:**
1. Enable forum mode: **Group Settings → Topics → Enable**.
2. Ensure the bot has "Manage Topics" permission under its administrator role.
3. Delete any stale `notificationTopicId` / `assistantTopicId` values from `~/.openacp/config.json` so OpenACP recreates them on next start.

---

### "Chat not found" error

**Symptoms:** Logs show `Chat not found` or `Bad Request: chat not found` immediately on startup.

**Cause:** The `chatId` in config is wrong, or the bot has never been added to the group (Telegram only returns chat info for groups the bot is a member of).

**Solution:**
1. Add the bot to your group if you haven't already.
2. Run `openacp doctor` — it calls `getChat` and reports the exact error from the Telegram API.
3. If the ID looks correct, check that it is a negative integer for supergroups.

---

### Rate limiting — messages are delayed or dropped

**Symptoms:** Responses appear sporadically, logs show `Rate limited by Telegram, retrying` with a `retryAfter` value.

**Cause:** Telegram enforces rate limits per bot per chat (roughly 20 messages per minute per group). OpenACP automatically retries up to 3 times with the delay Telegram specifies, but heavy usage can still cause visible delays.

**Solution:**
- This is normal behaviour under load. OpenACP's send queue handles it automatically.
- Avoid triggering many sessions simultaneously.
- If the problem is persistent, consider lowering `maxConcurrentSessions` in your config to reduce outbound message volume.

---

### Session doesn't start after sending a message

**Symptoms:** You send a message but no new topic appears and the agent doesn't respond.

**Cause:** Either the concurrent session limit has been reached, or your user ID is not in `allowedUserIds`.

**Solution:**
1. Check `security.maxConcurrentSessions` in `~/.openacp/config.json` — the default is low. Increase it if needed.
2. Check `security.allowedUserIds` — if the array is non-empty, only listed user IDs can create sessions. Find your Telegram user ID with `@userinfobot` and add it.

---

### Permission buttons are missing or unresponsive

**Symptoms:** The agent asks for permission but no buttons appear, or clicking buttons does nothing.

**Cause:** Callback queries (button clicks) are only delivered if `callback_query` is listed in `allowed_updates`. OpenACP sets this automatically on every polling cycle, but the bot must be running when buttons are clicked.

**Solution:**
1. Ensure the bot is running — buttons expire after the bot restarts if not answered.
2. If buttons appear but clicking does nothing, check logs for `Telegram bot error` entries that may indicate the bot token has been revoked.
3. Re-run setup (`openacp onboard`) to regenerate configuration if the token is suspect.

---

### Streaming responses flicker or show duplicate edits

**Symptoms:** Agent responses appear to flash or update repeatedly instead of streaming smoothly.

**Cause:** Telegram rate-limits `editMessageText` calls. OpenACP batches updates with a send queue (default 3-second window), but under heavy load edits can still appear jumpy.

**Solution:**
- This is a Telegram API constraint, not an OpenACP bug.
- Lower `outputMode` to `"low"` in your Telegram config to reduce the number of intermediate edits sent during streaming:

```json
"telegram": {
  "outputMode": "low"
}
```

  The legacy key `displayVerbosity` is also accepted for backward compatibility.
