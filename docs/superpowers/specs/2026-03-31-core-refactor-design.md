# Core Module Refactor Design

**Date**: 2026-03-31
**Scope**: `src/core/` — 3-phase incremental refactor
**Goal**: Break up god objects (`core.ts`, `session.ts`), decouple plugin service dependencies from core, improve testability and maintainability.

## Problem Statement

Three structural issues in the core module:

1. **`core.ts` (929 lines)** — God object. Handles message routing, session creation (5 variants), agent switching (200 lines with rollback), lazy resume, bridge management, adapter lifecycle, and config hot-reload.
2. **`session.ts` (569 lines)** — Session class owns TTS/STT logic (~100 lines) that belongs in the speech plugin, not core.
3. **Tight coupling to plugin services** — `OpenACPCore` directly accesses `speechService`, `securityGuard`, `tunnelService` via lazy getters. `MessageTransformer` has direct dependency on `TunnelService` for viewer link generation.

## Approach

**Incremental — 3 phases**, each independently testable and deployable. Each phase is a separate commit/PR scope.

---

## Phase 1: Split `core.ts` (~929 → ~350 lines)

### 1a. Extract `AgentSwitchHandler`

**New file**: `src/core/agent-switch-handler.ts` (~200 lines)

Extract from `core.ts`:
- `switchSessionAgent()` (lock guard)
- `_doSwitchSessionAgent()` (full switch flow with rollback)
- `switchingLocks` set

**Dependencies injected via constructor**:
```typescript
interface AgentSwitchDeps {
  sessionManager: SessionManager;
  agentManager: AgentManager;
  configManager: ConfigManager;
  middlewareChain: MiddlewareChain;
  eventBus: EventBus;
  adapters: Map<string, IChannelAdapter>;
  bridges: Map<string, SessionBridge>;
  createBridge: (session: Session, adapter: IChannelAdapter) => SessionBridge;
  getService: <T>(name: string) => T | undefined;
}
```

**`OpenACPCore` becomes**:
```typescript
async switchSessionAgent(sessionId: string, toAgent: string) {
  return this.agentSwitchHandler.switch(sessionId, toAgent);
}
```

### 1b. Move lazy resume into `SessionManager`

Move from `core.ts` into `SessionManager`:
- `lazyResume()` method
- `getOrResumeSession()` method
- `resumeLocks` map

**Rationale**: SessionManager already manages session lookup by thread. Lazy resume is a "find or restore" operation — natural extension of SessionManager's responsibility.

**SessionManager gains**:
```typescript
async getOrResume(channelId: string, threadId: string): Promise<Session | null>
private async lazyResume(channelId: string, threadId: string): Promise<Session | null>
```

**Requires**: SessionManager needs access to `createSession()` callback (injected, not circular dep).

### 1c. Move session creation variants into `SessionFactory`

Move from `core.ts` into `SessionFactory`:
- `adoptSession()` (~130 lines)
- `handleNewChat()` (~30 lines)
- `createSessionWithContext()` (~30 lines)
- `handleNewSession()` (~20 lines)

**`SessionFactory` gains**: Full session creation API. `OpenACPCore.createSession()` remains as the primary entry point, delegating to `SessionFactory`.

### Phase 1 Result

`core.ts` retains only:
- Constructor + service getters (~80 lines)
- `registerAdapter()`, `start()`, `stop()` (~50 lines)
- `handleMessage()` — delegates to SessionManager for lookup/resume (~30 lines)
- `createSession()` — thin orchestration: factory.create() + thread + bridge + persist (~70 lines)
- `archiveSession()` (~30 lines)
- `createBridge()` (~15 lines)

**Estimated: ~350 lines**

---

## Phase 2: Clean up `session.ts` (569 → ~400 lines)

### 2a. Extract TTS/Voice logic into speech middleware

**Remove from `session.ts`**:
- `TTS_PROMPT_INSTRUCTION` constant
- `TTS_BLOCK_REGEX`, `TTS_MAX_LENGTH`, `TTS_TIMEOUT_MS`
- `maybeTranscribeAudio()` method (~55 lines)
- `processTTSResponse()` method (~40 lines)
- TTS accumulator logic in `processPrompt()` (~20 lines)

**Move into speech plugin** as middleware:
- Register `agent:beforePrompt` middleware — handles STT transcription of audio attachments
- Register `turn:afterResponse` middleware (new hook) — handles TTS synthesis from response text
- Speech plugin injects `TTS_PROMPT_INSTRUCTION` via `agent:beforePrompt` when voice mode is active

**Session changes**:
- `voiceMode` property stays on Session (it's session state)
- `speechService` property removed from Session constructor
- `processPrompt()` becomes simpler — no TTS/STT branching

### 2b. Keep auto-name in Session

Auto-name uses `agentInstance.prompt()` + `pause()/resume()` emitter. Tightly coupled to Session internals. Not worth extracting.

### Phase 2 Result

`session.ts` retains:
- State machine (~40 lines)
- PromptQueue + processPrompt (simplified, ~60 lines)
- PermissionGate integration (~10 lines)
- Context injection (~15 lines)
- ACP state management (modes/config/model, ~60 lines)
- Agent switch (in-place, ~50 lines)
- Auto-name (~35 lines)
- destroy/warmup (~40 lines)

**Estimated: ~400 lines**

---

## Phase 3: Decouple plugin services

### 3a. Remove tunnel awareness from `MessageTransformer`

**Current**: `MessageTransformer` has `tunnelService` property and `enrichWithViewerLinks()` (110 lines) that directly calls tunnel service APIs.

**Change**: Extract viewer link enrichment into a post-transform middleware hook.

**New middleware hook**: `message:afterTransform`
```typescript
// Hook payload
{
  event: AgentEvent;
  message: OutgoingMessage;
  sessionContext: { id: string; workingDirectory: string };
}
```

**Tunnel plugin** registers middleware on `message:afterTransform` that:
1. Calls `extractFileInfo()` on the event
2. Stores diffs/files via tunnel store
3. Enriches `message.metadata` with `viewerLinks` and `diffStats`

**`MessageTransformer` becomes**: Pure `AgentEvent → OutgoingMessage` mapper. No service dependencies. ~200 lines.

**Note**: `computeLineDiff()` and diff stats computation for rawInput stay in `MessageTransformer` — they're pure transform logic, not tunnel-dependent.

### 3b. Graceful service access in Core

**Current**:
```typescript
private getService<T>(name: string): T {
  const svc = this.lifecycleManager.serviceRegistry.get<T>(name);
  if (!svc) throw new Error(`Service '${name}' not registered`);
  return svc;
}
```

**Change**: Return `undefined` instead of throwing. Core handles missing services gracefully:
```typescript
private getService<T>(name: string): T | undefined {
  return this.lifecycleManager.serviceRegistry.get<T>(name);
}
```

**Impact on callers**:
- `securityGuard` — if undefined, skip security check (allow all). Log warning on first access.
- `notificationManager` — if undefined, skip notifications silently.
- `fileService` — if undefined, skip file operations.
- `speechService` — if undefined, voice features disabled (already handled).
- `contextManager` — if undefined, skip context injection.

### 3c. Remove `tunnelService` property from Core

**Current**: `OpenACPCore` has `tunnelService` getter/setter that propagates to `MessageTransformer`.

**Change**: Remove entirely. Tunnel plugin registers itself via ServiceRegistry. Tunnel middleware (from 3a) accesses tunnel service via ServiceRegistry directly.

### Phase 3 Result

- `MessageTransformer`: pure transform, no service deps (~200 lines)
- `OpenACPCore`: no direct tunnel coupling, graceful service degradation
- Plugin services fully decoupled — core never throws on missing optional service

---

## New Middleware Hooks

| Hook | Phase | Type | Purpose |
|------|-------|------|---------|
| `message:afterTransform` | 3 | Modifiable | Enrich outgoing messages post-transform (viewer links, etc.) |
| `turn:afterResponse` | 2 | Fire-and-forget | Post-response processing (TTS synthesis) |

---

## Migration & Backward Compatibility

- **No public API changes**: `OpenACPCore` method signatures stay the same. Only internal delegation changes.
- **No config changes**: No new config fields.
- **Plugin API**: New middleware hooks are additive. Existing hooks unchanged.
- **Import paths**: New files are internal to core. No external consumers affected.

## Testing Strategy

Each phase includes:
1. **Move existing tests** — tests that cover extracted logic follow to new file's test suite
2. **Add integration test** — verify the delegation chain (Core → Handler → result) works
3. **Run full test suite** — `pnpm test` must pass after each phase

## File Changes Summary

| Phase | New Files | Modified Files |
|-------|-----------|---------------|
| 1 | `core/agent-switch-handler.ts` | `core/core.ts`, `core/sessions/session-manager.ts`, `core/sessions/session-factory.ts` |
| 2 | None | `core/sessions/session.ts`, `plugins/speech/` (middleware registration) |
| 3 | None | `core/message-transformer.ts`, `core/core.ts`, `plugins/tunnel/` (middleware registration) |
