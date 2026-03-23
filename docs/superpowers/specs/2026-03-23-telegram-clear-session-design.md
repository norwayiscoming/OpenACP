# Telegram /clear Command for Session Topics

## Summary

Add a `/clear` command that clears all messages in the current session's Telegram topic by recreating the forum topic. The agent subprocess stays alive — only the visual chat history is wiped. This gives users a clean slate when a topic gets cluttered with long tool outputs, streaming artifacts, or old conversation history.

## Requirements

- **Target**: Users working in session topics who want a clean chat view without losing their agent session
- **Scope**: Session topics only — `/clear` in Assistant topic already exists (respawn behavior)
- **Agent continuity**: The ACP subprocess must NOT be restarted — only the Telegram topic is recreated
- **Speed**: Should complete in under 3 seconds (topic delete + create + rewire)
- **Confirmation**: Ask for confirmation before clearing (destructive, messages are permanently deleted)

## Non-Goals

- Clearing agent conversation memory/context (out of scope — that's agent-side)
- Selective message deletion (too slow with Telegram rate limits — 3s per message)
- Chat export before clearing (could be a future feature)

## Design

### Approach: Topic Recreation

Telegram has no bulk-delete or topic-purge API. Deleting messages one-by-one is impractical (100 messages = 5+ minutes at 3s rate limit). Instead:

1. **Close old topic** via `deleteForumTopic(chatId, oldTopicId)` — permanently removes topic and all messages
2. **Create new topic** via `createForumTopic(chatId, name)` — fresh empty topic
3. **Rewire session** — update `session.platform.topicId` and session store record
4. **Cleanup trackers** — reset MessageDraft, ToolCallTracker, ActivityTracker for this session
5. **Send confirmation** — post a "cleared" message in the new topic

### Command Flow

```
User sends /clear in session topic
  → Bot replies: "⚠️ This will permanently delete all messages in this topic. Continue?"
  → [Yes, clear] [Cancel] inline buttons
  → User taps "Yes, clear"
  → Bot deletes old topic
  → Bot creates new topic with same name + icon
  → Bot updates session routing to new topic
  → Bot sends "✅ Chat cleared. Session continues." in new topic
```

### Key Constraints

| Constraint | Solution |
|-----------|----------|
| `deleteForumTopic` is permanent | Confirmation prompt before executing |
| New topic gets a different `topicId` | Update session record's `platform.topicId` in session store |
| Deep links to old topic break | Accepted trade-off — noted in confirmation message |
| Active streaming/draft in progress | Finalize draft before clearing, abort pending edits |
| Adapter routing uses `topicId` for message delivery | Must update all in-memory routing maps |

### Error Handling

| Error | Behavior |
|-------|----------|
| `deleteForumTopic` fails (403 — no permission) | Reply "Cannot clear: bot needs admin rights to manage topics" |
| `createForumTopic` fails after delete | Critical — reply in Notifications topic: "Topic recreation failed for session X. Session is orphaned." |
| Session not found in topic | Reply "No active session in this topic" |
| Session is in `initializing` state | Reply "Please wait for session to be ready" |
| `/clear` used in non-session topic | Reply "This command only works in session topics" |

### Callback Prefix

Use `cl:` prefix for clear confirmation callbacks to avoid conflicts with existing `p:` (permission) and `m:` (menu) prefixes.

- `cl:yes:<sessionId>` — confirm clear
- `cl:no:<sessionId>` — cancel clear

### Affected Components

**Adapter layer** (Telegram-specific):
- `commands.ts` — register `/clear` command handler
- `adapter.ts` — add `clearSessionTopic()` method that handles topic recreation + rewiring
- `topics.ts` — reuse `createSessionTopic()`, add `deleteSessionTopic()`

**Core layer** (minimal changes):
- `session-store.ts` — `updatePlatformData(sessionId, platform)` to persist new topicId

**No changes needed**:
- `session.ts` — agent subprocess is untouched
- `core.ts` — routing goes through adapter, not core
- `agent-instance.ts` — completely unaware of Telegram topics
