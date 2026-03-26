# Session Persistence

## Sessions survive restarts

By default, stopping and restarting the OpenACP daemon would lose track of all active sessions — their IDs, which agent was running, which Telegram topic or Discord thread they were attached to. Session persistence solves this by writing session records to disk as they are created and updated.

When the daemon restarts, it reloads all stored records. Sessions that were active before the restart are shown in their previous state. You can resume sending prompts to an agent session that survived a restart as long as the underlying agent process is still alive or can be reconnected.

---

## Storage location

Session records are stored in `~/.openacp/sessions.json`. The file format is:

```json
{
  "version": 1,
  "sessions": {
    "<sessionId>": { ... }
  }
}
```

Writes are debounced (2-second delay) to avoid excessive disk I/O during rapid session updates. The file is flushed synchronously on `SIGTERM`, `SIGINT`, and process exit.

If the file is unreadable on startup (corrupt JSON, wrong version), OpenACP logs the error and starts with an empty session map rather than crashing.

---

## What is persisted

Each session record stores:

| Field | Description |
|-------|-------------|
| `sessionId` | Unique OpenACP session ID |
| `agentSessionId` | ID assigned by the agent subprocess (ACP session ID) |
| `originalAgentSessionId` | Agent session ID before the most recent handoff or restore |
| `channelId` | Which adapter owns this session (`telegram`, `discord`, etc.) |
| `agentName` | Name of the agent (e.g. `claude`, `gemini`) |
| `workingDirectory` | Filesystem path the agent is working in |
| `status` | `initializing`, `active`, `idle`, `finished`, `error` |
| `name` | Display name auto-assigned after the first prompt |
| `threadId` | Platform thread or topic ID (e.g. Telegram forum topic ID) |
| `platform` | Adapter-specific metadata (e.g. Telegram chat ID) |
| `createdAt` | ISO timestamp when the session was created |
| `lastActiveAt` | ISO timestamp of the most recent activity |

---

## TTL cleanup

Old session records are pruned automatically. By default, records that have not been active for **30 days** are removed. Active and initializing sessions are never pruned regardless of age.

Configure the TTL in `~/.openacp/config.json`:

```json
{
  "sessions": {
    "ttlDays": 30
  }
}
```

Cleanup runs on startup and then every 24 hours for long-running instances.

---

## Resuming after a restart

After restarting the daemon:

1. OpenACP reloads `sessions.json` and restores all session records.
2. Adapter-specific state (e.g. Telegram topic IDs) is re-associated from the `platform` metadata.
3. Sessions that were `active` or `initializing` before the restart are visible again in your messaging app.
4. Sending a new message to an existing session topic reconnects to the agent process or creates a new agent session linked to the same record.

If the agent process did not survive the restart, the session transitions to `error` state and you will see an error notification in the topic. Create a new session or use `/resume` to continue work in a fresh session with history attached.
