# Context & Resume

## What it is

When you start a new coding session, the agent has no memory of what happened in previous sessions. The context resume feature solves this by injecting a structured summary of past conversations — what you asked, what the agent did, which files it touched — directly into the new session's context window.

This lets you continue work naturally. The agent knows the history without you having to re-explain the project, the decisions already made, or the state of in-progress tasks.

---

## How it works

The `ContextManager` maintains a list of registered context providers. When a session resumes, OpenACP queries the appropriate provider for the relevant history, receives a formatted markdown document, and prepends it to the first prompt.

Providers are pluggable. The current built-in provider is `EntireProvider`, which reads conversation history stored by the [Entire.io](https://entire.io) git checkpoint system.

Results are cached on disk at `~/.openacp/cache/entire/` so that repeated requests for the same query (same branch, same commit range) do not re-read and re-parse transcript files.

---

## Entire.io provider

Entire.io saves git checkpoints during agent sessions. Each checkpoint stores:

- The agent name and git branch
- A JSONL transcript of the conversation (user messages and assistant responses, including file edits and writes)
- The list of files touched

The `EntireProvider` is available when the repository contains an `entire` git branch. It supports several query types for resolving which sessions to include:

| Query type | Example | Description |
|------------|---------|-------------|
| `branch` | `main` | All sessions on a specific branch |
| `commit` | `abc12345` | Sessions associated with a specific commit |
| `pr` | `https://github.com/.../pull/42` | Sessions for a pull request |
| `checkpoint` | `chk_abc123` | A single specific checkpoint |
| `session` | `sess_abc123` | A single session by ID |
| `latest` | `5` | The N most recent sessions (default 5) |

---

## Adaptive rendering modes

Conversation history can be long. To avoid consuming the entire context window, the provider automatically selects a rendering mode based on total turn count:

| Mode | Turns | What is included |
|------|-------|-----------------|
| `full` | up to 10 | Full text of all user messages and assistant responses; full diffs and file writes |
| `balanced` | 11 to 25 | User messages in full; diffs truncated to 12 lines; file writes truncated to 15 lines |
| `compact` | more than 25 | User messages in full; edits shown as a one-line summary with line counts; writes shown as filename and line count only |

If the resulting markdown still exceeds the configured `maxTokens` limit, the provider automatically downgrades to `compact` mode. If it is still too large, the oldest sessions are dropped until it fits.

A disclaimer is always appended to the context document reminding the agent that the history may be outdated and should not be taken as ground truth for current file contents.

---

## /resume command

Send `/resume` in any session topic to attach context from recent sessions to your next prompt. The command accepts the same query types as the provider:

```
/resume                          # Latest 5 sessions (default)
/resume branch main              # All sessions on branch main
/resume pr 42                    # Sessions for PR #42
/resume latest 10                # Latest 10 sessions
/resume session sess_abc123      # A specific session
```

The injected context appears as a collapsible block above your message so you can verify what was included before the agent processes it.

---

## Token estimation

Token counts are estimated as `floor(characters / 4)`, which approximates GPT-style tokenization. This estimate is used both to select the rendering mode and to decide whether to truncate. The estimate is intentionally conservative — actual token counts vary by model and content type.

To see how many tokens a context block would consume before sending, use:

```
/resume --dry-run branch main
```

This reports the session count, turn count, rendering mode, and estimated token count without attaching the context.
