# Telegram /clear for Session Topics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `/clear` command to work in session topics (not just Assistant). When used in a session topic, it recreates the forum topic — deleting all messages — while keeping the agent subprocess alive.

**Architecture:** The current `/clear` in `commands/menu.ts` only works in the Assistant topic (calls `respawn()`). This plan adds a second code path: when `/clear` is used in a session topic, the adapter deletes the old topic, creates a new one, and rewires the session to it. A confirmation prompt with inline buttons prevents accidental clears.

**Tech Stack:** TypeScript, grammY (Telegram Bot API), vitest

**Spec:** `docs/superpowers/specs/2026-03-23-telegram-clear-session-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/adapters/telegram/commands/menu.ts` | Expand `handleClear()` to support session topics with confirmation |
| Modify | `src/adapters/telegram/commands/index.ts` | Register `cl:` callback handler, pass `core` + `chatId` to `handleClear` |
| Modify | `src/adapters/telegram/adapter.ts` | Add `clearSessionTopic()` method for topic recreation + session rewiring |
| Modify | `src/adapters/telegram/topics.ts` | Add `deleteSessionTopic()` helper |
| Modify | `src/core/session-store.ts` | Add `updatePlatformData()` method to `SessionStore` interface and `JsonFileSessionStore` |
| Create | `src/__tests__/clear-session.test.ts` | Tests for confirmation flow, session rewiring, error handling |

---

### Task 1: Add `updatePlatformData` to SessionStore

**Files:**
- Modify: `src/core/session-store.ts`
- Create: `src/__tests__/clear-session.test.ts` (partial — store tests only)

- [ ] **Step 1: Write failing tests for updatePlatformData**

Create `src/__tests__/clear-session.test.ts` with session store tests:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { JsonFileSessionStore } from "../core/session-store.js";
import type { SessionRecord } from "../core/types.js";

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: "sess-1",
    agentSessionId: "agent-1",
    agentName: "claude",
    workingDir: "/tmp",
    channelId: "telegram",
    status: "active",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    name: "Test Session",
    platform: { topicId: 100 },
    ...overrides,
  };
}

describe("SessionStore.updatePlatformData", () => {
  let tmpDir: string;
  let store: JsonFileSessionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openacp-store-test-"));
    store = new JsonFileSessionStore(path.join(tmpDir, "sessions.json"), 30);
  });

  afterEach(() => {
    store.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates platform data for existing session", async () => {
    const record = makeRecord();
    await store.save(record);
    await store.updatePlatformData("sess-1", { topicId: 200 });
    const updated = store.get("sess-1");
    expect(updated?.platform).toEqual({ topicId: 200 });
  });

  it("does nothing for non-existent session", async () => {
    await store.updatePlatformData("non-existent", { topicId: 200 });
    expect(store.get("non-existent")).toBeUndefined();
  });

  it("merges with existing platform data", async () => {
    const record = makeRecord({ platform: { topicId: 100, skillMsgId: 42 } });
    await store.save(record);
    await store.updatePlatformData("sess-1", { topicId: 200 });
    const updated = store.get("sess-1");
    expect(updated?.platform).toEqual({ topicId: 200, skillMsgId: 42 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/clear-session.test.ts`
Expected: FAIL — `updatePlatformData` does not exist

- [ ] **Step 3: Add `updatePlatformData` to SessionStore interface and implementation**

In `src/core/session-store.ts`, add to the `SessionStore` interface (after `remove` method):

```typescript
  updatePlatformData(sessionId: string, platform: Record<string, unknown>): Promise<void>;
```

Add implementation to `JsonFileSessionStore` (after the `remove` method):

```typescript
  async updatePlatformData(sessionId: string, platform: Record<string, unknown>): Promise<void> {
    const record = this.records.get(sessionId);
    if (!record) return;
    record.platform = { ...record.platform, ...platform };
    this.scheduleDiskWrite();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/clear-session.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/session-store.ts src/__tests__/clear-session.test.ts
git commit -m "feat(core): add updatePlatformData to SessionStore for topic migration"
```

---

### Task 2: Add `deleteSessionTopic` helper

**Files:**
- Modify: `src/adapters/telegram/topics.ts`

- [ ] **Step 1: Add deleteSessionTopic function**

In `src/adapters/telegram/topics.ts`, add after `renameSessionTopic`:

```typescript
// Delete a forum topic and all its messages
export async function deleteSessionTopic(
  bot: Bot,
  chatId: number,
  threadId: number,
): Promise<void> {
  await bot.api.deleteForumTopic(chatId, threadId);
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/adapters/telegram/topics.ts
git commit -m "feat(telegram): add deleteSessionTopic helper"
```

---

### Task 3: Add `clearSessionTopic` to TelegramAdapter

**Files:**
- Modify: `src/adapters/telegram/adapter.ts`

- [ ] **Step 1: Add import for deleteSessionTopic**

In `src/adapters/telegram/adapter.ts`, update the topics import to include `deleteSessionTopic`:

```typescript
import {
  ensureTopics,
  createSessionTopic,
  renameSessionTopic,
  deleteSessionTopic,
} from "./topics.js";
```

- [ ] **Step 2: Add clearSessionTopic method**

Add to the `TelegramAdapter` class (after the `cleanupSkillCommands` method):

```typescript
  async clearSessionTopic(session: import("../../core/session.js").Session): Promise<{ newTopicId: number }> {
    const chatId = this.telegramConfig.chatId;
    const oldTopicId = Number(session.threadId);
    const sessionName = session.name || `Session ${session.id.slice(0, 6)}`;

    // 1. Finalize any pending draft
    await this.draftManager.finalize(session.id, this.assistantSession?.id);

    // 2. Cleanup all trackers for old topic
    this.draftManager.cleanup(session.id);
    this.toolTracker.cleanup(session.id);
    await this.skillManager.cleanup(session.id);
    const tracker = this.sessionTrackers.get(session.id);
    if (tracker) tracker.dispose();
    this.sessionTrackers.delete(session.id);

    // 3. Delete old topic
    await deleteSessionTopic(this.bot, chatId, oldTopicId);

    // 4. Create new topic with same name
    const newTopicId = await createSessionTopic(this.bot, chatId, `🔄 ${sessionName}`);

    // 5. Rewire session to new topic
    session.threadId = String(newTopicId);

    // 6. Update session store
    if (this.core.sessionManager.store) {
      await this.core.sessionManager.store.updatePlatformData(session.id, { topicId: newTopicId, skillMsgId: undefined });
    }

    // 7. Update session record in store
    this.core.sessionManager.updateSessionRecord(session.id, {
      platform: { topicId: newTopicId },
    });

    return { newTopicId };
  }
```

- [ ] **Step 3: Verify build**

Run: `pnpm exec tsc --noEmit`

> **Note:** This step may reveal that `sessionManager.store` is private or that `updateSessionRecord` doesn't exist. If so, check the current `SessionManager` API:
> - If `store` is private, use `sessionManager.updatePlatformData(sessionId, platform)` instead (add a pass-through method to SessionManager if needed)
> - If `updateSessionRecord` doesn't exist, use the existing `save` method on the store directly

Fix any type errors before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/telegram/adapter.ts
git commit -m "feat(telegram): add clearSessionTopic for topic recreation and session rewiring"
```

---

### Task 4: Expand `/clear` to support session topics

**Files:**
- Modify: `src/adapters/telegram/commands/menu.ts`
- Modify: `src/adapters/telegram/commands/index.ts`

- [ ] **Step 1: Update handleClear to support session topics**

In `src/adapters/telegram/commands/menu.ts`, replace the existing `handleClear` function:

```typescript
import { InlineKeyboard } from "grammy";
import type { OpenACPCore } from "../../../core/index.js";
```

Add `OpenACPCore` to the function signature and add session topic support:

```typescript
export async function handleClear(
  ctx: Context,
  core: OpenACPCore,
  chatId: number,
  assistant?: CommandsAssistantContext,
): Promise<void> {
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return;

  // Assistant topic: use existing respawn behavior
  if (assistant && threadId === assistant.topicId) {
    await ctx.reply("🔄 Clearing assistant history...", { parse_mode: "HTML" });
    try {
      await assistant.respawn();
      await ctx.reply("✅ Assistant history cleared.", { parse_mode: "HTML" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ Failed to clear: <code>${message}</code>`, { parse_mode: "HTML" });
    }
    return;
  }

  // Session topic: find the session
  const session = core.sessionManager.getSessionByThread("telegram", String(threadId));
  if (!session) {
    await ctx.reply("⚠️ No active session in this topic.", { parse_mode: "HTML" });
    return;
  }

  if (session.status === "initializing") {
    await ctx.reply("⏳ Please wait for session to be ready.", { parse_mode: "HTML" });
    return;
  }

  // Show confirmation with inline buttons
  await ctx.reply(
    "⚠️ <b>Clear session chat?</b>\n\n" +
    "This will permanently delete all messages in this topic and create a fresh one.\n" +
    "Your agent session will continue — only the chat view is reset.\n\n" +
    "<i>Note: links to messages in this topic will stop working.</i>",
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🗑 Yes, clear", `cl:yes:${session.id}`)
        .text("❌ Cancel", `cl:no:${session.id}`),
    },
  );
}
```

- [ ] **Step 2: Add `cl:` callback handler in index.ts**

In `src/adapters/telegram/commands/index.ts`, add import for the clear confirmation handler. First, add a new export from `menu.ts`:

In `menu.ts`, add after `handleClear`:

```typescript
export async function handleClearConfirm(
  ctx: Context,
  core: OpenACPCore,
  adapter: import("../adapter.js").TelegramAdapter,
): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  try {
    await ctx.answerCallbackQuery();
  } catch { /* expired */ }

  const [, action, sessionId] = data.split(":");

  if (action === "no") {
    await ctx.editMessageText("Clear cancelled.", { parse_mode: "HTML" });
    return;
  }

  // action === "yes"
  const session = core.sessionManager.getSession(sessionId);
  if (!session) {
    await ctx.editMessageText("⚠️ Session no longer exists.", { parse_mode: "HTML" });
    return;
  }

  await ctx.editMessageText("🔄 Clearing topic...", { parse_mode: "HTML" });

  try {
    const { newTopicId } = await adapter.clearSessionTopic(session);
    // Old topic is deleted, so send confirmation to the NEW topic
    await ctx.api.sendMessage(adapter.chatId, "✅ Chat cleared. Session continues.", {
      message_thread_id: newTopicId,
      parse_mode: "HTML",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Old topic may still exist if createForumTopic failed after deleteForumTopic
    try {
      await ctx.editMessageText(`❌ Failed to clear: <code>${message}</code>`, { parse_mode: "HTML" });
    } catch {
      // Topic already deleted — notify in Notifications topic
      core.notificationManager.notifyAll({
        sessionId,
        sessionName: session.name,
        type: "error",
        summary: `Failed to recreate topic for session "${session.name || sessionId}": ${message}`,
      });
    }
  }
}
```

Then in `src/adapters/telegram/commands/index.ts`:

1. Update the import from `menu.ts` to include `handleClearConfirm`:

```typescript
import { handleMenu, handleHelp, handleClear, handleClearConfirm, buildMenuKeyboard } from "./menu.js";
```

2. Update the `setupCommands` call to pass `core` and `chatId` to `handleClear`:

```typescript
  bot.command("clear", (ctx) => handleClear(ctx, core, chatId, assistant));
```

3. In `setupAllCallbacks`, register the `cl:` prefix handler **before** the broad `m:` handler. You'll need to pass the adapter instance. Add `adapter` param to `setupAllCallbacks`:

```typescript
export function setupAllCallbacks(
  bot: Bot,
  core: OpenACPCore,
  chatId: number,
  adapter: import("../adapter.js").TelegramAdapter,
  systemTopicIds?: { notificationTopicId: number; assistantTopicId: number },
  getAssistantSession?: () => { topicId: number; enqueuePrompt: (p: string) => Promise<void> } | undefined,
): void {
```

Then add before the broad `m:` handler:

```typescript
  // Clear confirmation callbacks
  bot.callbackQuery(/^cl:/, (ctx) => handleClearConfirm(ctx, core, adapter));
```

> **Note:** Adding `adapter` as a parameter to `setupAllCallbacks` requires updating the caller in `adapter.ts`. Check how `setupAllCallbacks` is called and add `this` as the adapter argument.

- [ ] **Step 3: Update STATIC_COMMANDS description**

In `STATIC_COMMANDS`, update the clear command description:

```typescript
  { command: "clear", description: "Clear chat history (assistant or session topic)" },
```

- [ ] **Step 4: Update help text**

In `handleHelp` in `menu.ts`, update the `/clear` description:

```typescript
      `/clear — Clear chat history\n` +
```

- [ ] **Step 5: Verify build**

Run: `pnpm exec tsc --noEmit`
Fix any type errors. Common issues:
- `sessionManager.getSession()` may need a different method name — check the actual API
- `adapter.chatId` may be private — use a getter or access via config
- `setupAllCallbacks` signature change needs the caller in `adapter.ts` updated

- [ ] **Step 6: Commit**

```bash
git add src/adapters/telegram/commands/menu.ts src/adapters/telegram/commands/index.ts src/adapters/telegram/adapter.ts
git commit -m "feat(telegram): extend /clear to support session topics with confirmation"
```

---

### Task 5: Tests for /clear in session topics

**Files:**
- Modify: `src/__tests__/clear-session.test.ts`

- [ ] **Step 1: Add tests for handleClear and handleClearConfirm**

Append to `src/__tests__/clear-session.test.ts`:

```typescript
import { handleClear } from "../adapters/telegram/commands/menu.js";

// Mock context factory
function mockCtx(threadId?: number, callbackData?: string) {
  const replies: any[] = [];
  return {
    ctx: {
      message: threadId ? { message_thread_id: threadId } : undefined,
      callbackQuery: callbackData ? { data: callbackData } : undefined,
      reply: vi.fn((...args: any[]) => { replies.push(args); return Promise.resolve(); }),
      editMessageText: vi.fn(() => Promise.resolve()),
      answerCallbackQuery: vi.fn(() => Promise.resolve()),
      api: { sendMessage: vi.fn(() => Promise.resolve()) },
    } as any,
    replies,
  };
}

describe("/clear in session topic", () => {
  it("shows 'no active session' if no session found", async () => {
    const { ctx } = mockCtx(999);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => undefined),
      },
    } as any;

    await handleClear(ctx, core, 123);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("No active session"),
      expect.any(Object),
    );
  });

  it("shows confirmation prompt when session exists", async () => {
    const { ctx } = mockCtx(456);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => ({
          id: "sess-1",
          status: "active",
        })),
      },
    } as any;

    await handleClear(ctx, core, 123);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Clear session chat"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it("rejects if session is initializing", async () => {
    const { ctx } = mockCtx(456);
    const core = {
      sessionManager: {
        getSessionByThread: vi.fn(() => ({
          id: "sess-1",
          status: "initializing",
        })),
      },
    } as any;

    await handleClear(ctx, core, 123);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("wait for session"),
      expect.any(Object),
    );
  });

  it("falls through to assistant clear in assistant topic", async () => {
    const respawn = vi.fn(() => Promise.resolve());
    const { ctx } = mockCtx(100);
    const assistant = { topicId: 100, respawn, getSession: () => null };

    await handleClear(ctx, {} as any, 123, assistant);
    expect(respawn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test src/__tests__/clear-session.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/clear-session.test.ts
git commit -m "test: add tests for /clear command in session topics"
```

---

### Task 6: Smoke Test & Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Full type check**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass (existing + new)

- [ ] **Step 3: Verify command registration**

Grep to confirm:
- `/clear` is registered in `setupCommands`
- `cl:` callback is registered in `setupAllCallbacks`
- `STATIC_COMMANDS` includes updated description
- `deleteSessionTopic` is exported from `topics.ts`
- `updatePlatformData` is in `SessionStore` interface

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: final cleanup for /clear session feature"
```
