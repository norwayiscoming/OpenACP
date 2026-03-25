# Resume with Conversation History

Resume lets you start a new agent session with full conversation history from previous coding sessions. It reads checkpoint data from [Entire.io](https://entire.io) — a git-native session tracking tool — and injects it as context into the new session.

## How It Works

```
You (or another dev) code in IDE with Entire enabled
    → Entire captures transcripts, files edited, decisions
    → Stored on git branch: entire/checkpoints/v1

Later, on Telegram:
    /resume pr 19
    → OpenACP reads checkpoints from git
    → Rebuilds conversation history
    → Injects into new agent session
    → Agent continues with full context
```

The agent receives the previous conversation as context in its first prompt, so it knows what was discussed, what files were changed, and what decisions were made.

## Prerequisites

Your project repo must have [Entire CLI](https://github.com/entireio/cli) enabled:

```bash
cd /path/to/your/project
npx entire enable
```

If Entire is not enabled, OpenACP will show a message with setup instructions.

## Usage

### Basic commands

```
/resume                 — latest 5 sessions from the repo
/resume pr 19           — all sessions from PR #19
/resume branch main     — all sessions on branch main
/resume commit e0dd2fa4 — session linked to a specific commit
```

### Entire IDs

```
/resume f634acf05138                              — checkpoint ID (12 hex chars)
/resume 1d9503b8-0134-419a-a3a7-019b312dd12c      — session ID (UUID)
```

### GitHub URLs

```
/resume https://github.com/org/repo/pull/42
/resume https://github.com/org/repo/commit/e0dd2fa4...
/resume https://github.com/org/repo/tree/feat/my-feature
/resume https://github.com/org/repo/compare/main...feat/x
```

### Entire.io URLs

```
/resume https://entire.io/gh/org/repo/checkpoints/main/2e884e2c402a
/resume https://entire.io/gh/org/repo/commit/e0dd2fa4...
```

## Workspace Selection

After running `/resume`, you'll be asked to select the project directory. This is required because OpenACP needs to know which local git repo to read checkpoints from.

You can:
- Pick from the listed subdirectories of your workspace base directory
- Type a full path like `/Users/you/code/my-project`
- Type just the folder name (resolved against your workspace baseDir)

## Adaptive Mode

The conversation history is automatically adjusted based on size to stay within token limits:

| Total turns | Mode | Behavior |
|---|---|---|
| 1-10 | **Full** | Complete diffs, full file contents |
| 11-25 | **Balanced** | Truncated diffs (max 12 lines), file previews |
| 26+ | **Compact** | One-liner summaries for edits, focus on dialogue |

- User and assistant messages are always kept in full regardless of mode
- Only file edits/writes are compressed
- Default token budget: 30,000 tokens
- If context exceeds 30K tokens, you'll be asked to choose how many sessions to include

## Context Format

The agent receives the history in this format:

```
[CONVERSATION HISTORY - previous sessions, not current conversation]

# Conversation History from PR #19 (branch: refactor/auth)
3 sessions | 25 turns | 2026-03-15 18:53 → 2026-03-16 04:35 | mode: balanced

## Session Conversation History 1 — 2026-03-15 18:53 → 20:14 (Claude Code, 11 turns, branch: refactor/auth)

**User [1]:**
implement OAuth login...

**Assistant:**
I'll add the OAuth flow...

> edited `src/auth.ts`
> ```diff
> - // old code
> + // new code
> ```

...

---
⚠️ The conversation history above is from previous sessions and may be outdated.
Files, code, and decisions referenced may have changed since then.
Always verify the current state of the codebase before making changes.
---

[END CONVERSATION HISTORY]
```

Sessions are ordered chronologically — oldest first, newest last. Each session shows its branch, time range, agent type, and turn count.

## Cross-Tool Continuity

Because Entire captures sessions from any supported tool (Claude Code, Cursor, Gemini CLI, etc.), you can:

1. Code in Cursor on your laptop
2. Entire captures the session
3. Open Telegram on your phone
4. `/resume branch feat/my-feature`
5. Agent has full context from your Cursor session

This works across devices and across different AI agents.

## Architecture

The feature is built on an abstract `ContextProvider` interface:

```
ContextManager
  └── EntireProvider (reads entire/checkpoints/v1)
  └── (future providers)
```

This means other history sources can be added without changing the resume command or session logic.

## Troubleshooting

**"Entire not enabled in /path/to/repo"**
Run `npx entire enable` in your project directory, then make some commits with an AI agent so checkpoints get created.

**"No sessions found"**
- The checkpoint branch may not be fetched yet. Run `git fetch origin entire/checkpoints/v1`
- The PR/branch/commit may not have any Entire checkpoints linked to it
- Check `git log --format=%B -1 <commit>` to see if there's an `Entire-Checkpoint:` trailer

**Context seems outdated**
The disclaimer at the end of injected context warns the agent about this. The agent should verify current file state before making changes based on history.
