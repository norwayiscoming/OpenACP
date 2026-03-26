# Session Cleanup Design

## Problem

After extended use, OpenACP creates many forum topics (one per session) in the Telegram/Discord group. Users need to bulk-clean old sessions and their associated chat threads, but doing it manually is tedious and there's no easy way to know which sessions are inactive.

## Solution

Extend the existing `TopicManager.cleanup()` and `openacp api cleanup` into a full interactive cleanup flow, accessible from both CLI and chat platforms. The new code builds on top of existing `TopicManager` and `OpenACPCore.archiveSession()` rather than reimplementing cleanup logic.

## User Flows

### CLI Flow

```
openacp api cleanup                              # List cleanable sessions, prompt to delete
openacp api cleanup --list                       # List only, no delete (CLI-only presentation flag)
openacp api cleanup --status finished,cancelled  # Filter by status
openacp api cleanup --older-than 7d              # Filter by age (parsed by parseDuration utility)
openacp api cleanup --all                        # All non-active sessions
openacp api cleanup --yes                        # Skip confirmation prompt
```

Note: `--list` is a CLI-only flag that calls `listCleanableSessions()` and prints the table without calling `cleanupSessions()`. It has no HTTP API equivalent.

**Output format:**

```
Sessions to clean up:
  #  Name                Agent    Status      Created       Last Active
  1  Fix login bug       claude   finished    2d ago        1d ago
  2  Add dark mode       claude   cancelled   5d ago        5d ago
  3  Refactor tests      claude   error       1w ago        1w ago

Delete 3 sessions and their forum topics? [y/N]
```

### Chat Flow (`/cleanup` command)

1. User sends `/cleanup` in any topic (or system topic like Assistant/Notifications).
2. Bot replies with a list of non-active sessions, each showing: name, agent, status, relative time since last active.
3. All sessions are selected by default. Each session has a toggle button (select/deselect). "Select All" and "Cancel" buttons at the bottom.
4. After selection, a "Delete Selected (N)" button appears.
5. Bot confirms: "Deleted N sessions and forum topics." or reports partial failures.
6. Pagination with Prev/Next buttons if > 10 sessions.

## Architecture

### Core Layer (Adapter-Agnostic)

Two new methods on `OpenACPCore`, built on existing `TopicManager` and `archiveSession()`:

```typescript
// List sessions eligible for cleanup
// By default (no filter), excludes sessions with status 'active' or 'initializing'.
// Callers may explicitly include those statuses via the filter.
listCleanableSessions(filter?: CleanupFilter): SessionRecord[]

interface CleanupFilter {
  status?: SessionStatus[]        // e.g. ['finished', 'cancelled', 'error']
  olderThan?: number              // milliseconds since lastActiveAt
  channelId?: string              // filter by channel
}

// Delete sessions and their platform threads
// Implemented as a loop calling archiveSession() per session ID,
// collecting successes and failures into CleanupResult.
cleanupSessions(sessionIds: string[]): Promise<CleanupResult>

// Reuse existing CleanupResult type from TopicManager
interface CleanupResult {
  deleted: string[]               // successfully deleted session IDs
  failed: Array<{ sessionId: string; error: string }>
}
```

**`cleanupSessions` logic:**
Delegates to the existing `archiveSession(sessionId)` method for each ID. `archiveSession` already handles:
1. If session is active in memory: sets `session.archiving = true` to suppress in-flight messages, calls `archiveSessionTopic()` (which cleans up in-memory trackers), then cancels and removes the record.
2. If session is NOT in memory (already finished): calls `adapter.deleteSessionThread()` directly, then removes the record.

The new `cleanupSessions` wraps this in a loop with error collection.

### Duration Parsing

A `parseDuration(str: string): number` utility converts human-friendly duration strings (e.g., `7d`, `24h`, `30m`) to milliseconds. Used by both the CLI (`--older-than` flag) and HTTP API (`olderThan` query param). Lives in a shared utils file.

### HTTP API Endpoints

```
GET  /api/cleanup/list?status=finished,cancelled&olderThan=7d
     → Returns array of SessionRecord matching the filter

POST /api/cleanup
     Body: { sessionIds: string[] }
     → Executes cleanup, returns CleanupResult
```

Note: Routes use `/api/cleanup/` prefix instead of `/api/sessions/cleanable` to avoid collision with the existing `/api/sessions/:sessionId` parameterized route.

### Chat Command Handler

- Registered per adapter (Telegram: `bot.command('cleanup')`, Discord: slash command)
- Calls `core.listCleanableSessions()` to get the list
- Renders platform-appropriate UI (Telegram: inline keyboard with toggle buttons)
- On user confirmation, calls `core.cleanupSessions(selectedIds)`
- Reports results back to user

**Selection state storage (Telegram):** A `Map<string, CleanupFlowState>` keyed by the cleanup message ID, stored in memory on the adapter. Each entry holds the set of selected session IDs and the current page number. Entries have a 5-minute TTL and are cleaned up on server restart. This is consistent with the codebase's existing in-memory state pattern.

```typescript
interface CleanupFlowState {
  selectedIds: Set<string>
  sessions: SessionRecord[]
  page: number
  createdAt: number  // for TTL
}
```

### Callback Routing (Telegram)

New callback prefix: `cl:` (cleanup) to avoid conflicts with existing `p:` (permission) and `m:` (menu) prefixes.

Button data format:
- `cl:toggle:<sessionId>` — toggle selection for a session
- `cl:all` — select all
- `cl:none` — deselect all
- `cl:delete` — confirm and delete selected
- `cl:cancel` — cancel cleanup
- `cl:page:<n>` — navigate to page N

## Error Handling

- **Topic already deleted on platform**: Log warning, still remove session record. Don't fail the whole operation.
- **API rate limiting**: If Telegram/Discord rate-limits during bulk delete, retry with backoff.
- **Concurrent cleanup calls**: Idempotent — if a session is already deleted, skip it gracefully.
- **No cleanable sessions**: Display "No sessions to clean up."
- **Active session selected**: `archiveSession()` handles this correctly — sets `session.archiving = true` to suppress in-flight messages before deleting the topic.

## Testing Strategy

### Unit Tests

- `listCleanableSessions()`: filter by status, by age, exclude active/initializing by default, empty store
- `cleanupSessions()`: happy path (all deleted), partial failure (some topics fail), already-deleted sessions
- `parseDuration()`: valid inputs (`7d`, `24h`, `30m`), invalid inputs, edge cases
- Cleanup callback routing (Telegram button handlers)

### Integration Tests

- CLI: `openacp api cleanup --list` returns formatted table
- Full flow: list → select → cleanup → verify records removed
- Chat command: `/cleanup` → inline buttons → delete → confirmation message

### Edge Cases

- Session active in memory and mid-stream: verify `archiving` flag is set before topic deletion and cleared on completion or error
- Topic already manually deleted on Telegram: graceful skip
- Concurrent cleanup from CLI and chat simultaneously: idempotent
- Empty session list
- Session with no platform data (no topicId): skip platform delete, remove record only
- Cleanup flow state TTL expiry: handle gracefully when user clicks button after 5 minutes

## Files to Modify

### Core
- `src/core/core.ts` — Add `listCleanableSessions()` and `cleanupSessions()` methods (thin wrappers around `TopicManager` and `archiveSession()`)
- `src/core/sessions/session-store.ts` — May need query helpers for filtering

### HTTP API
- `src/core/api/routes/` — Add `/api/cleanup/list` and `/api/cleanup` endpoints

### CLI
- `src/cli/commands/api.ts` — Enhance `openacp api cleanup` with new flags (`--list`, `--older-than`, `--all`, `--yes`) and interactive output

### Shared Utils
- `src/core/utils/` or similar — `parseDuration()` utility

### Telegram Adapter
- `src/adapters/telegram/adapter.ts` — Register `/cleanup` command, handle `cl:` callbacks
- `src/adapters/telegram/cleanup.ts` — New file for cleanup UI rendering (inline keyboard builder, message formatter, `CleanupFlowState` management)

### Channel Adapter Interface
- `src/core/channel.ts` — No changes needed. `deleteSessionThread` already exists as optional method.

### Tests
- `src/core/__tests__/cleanup.test.ts` — Core cleanup logic tests
- `src/adapters/telegram/__tests__/cleanup.test.ts` — Telegram-specific UI tests
