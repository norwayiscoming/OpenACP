# Unified Instance Model — Design Spec

**Date:** 2026-04-09  
**Status:** Draft  
**Scope:** CLI instance management, config system, setup wizard, migration

## Problem

The current multi-instance architecture splits state between a "global instance" (`~/.openacp/`) and "local instances" (`<project>/.openacp/`). This creates several issues:

1. **`~/.openacp/` does double duty** — It is both the global instance (config, plugins, logs, sessions) AND the shared registry (`instances.json`). These are fundamentally different roles.
2. **Workspace path decoupled from instance** — `config.workspace.baseDir` can point anywhere, creating disconnect between where `.openacp/` lives and where agents work.
3. **Silent fallback to global** — Commands like `start`, `stop`, `default` silently fall back to `~/.openacp` when no instance is resolved. Users don't know which instance they're operating on.
4. **Auto-select with single instance** — When only one instance exists, operational commands auto-select it without prompting.
5. **Confusing walk-up behavior** — `resolveRunningInstance()` walks up the directory tree with no boundary, potentially matching unexpected `.openacp/` directories.
6. **Too many flags** — `--global`, `--local`, `--dir`, `--workspace` overlap in confusing ways.

## Solution

Remove the "global instance" concept entirely. Every instance is local — it lives inside its workspace directory as `<workspace>/.openacp/`. The `~/.openacp/` directory becomes a lightweight shared store only.

### Core Principles

1. **One concept: directory = instance = workspace** — The directory containing `.openacp/` IS the workspace.
2. **No silent fallbacks** — If the CLI can't resolve an instance, it prompts the user.
3. **Shared data stays shared** — Agent binaries, CLI tools, and registry cache are stored globally to avoid duplication.

## Design

### 1. Directory Structure

#### `~/.openacp/` — Shared Store (NOT an instance)

```
~/.openacp/
  instances.json              # Registry: maps instance ID -> root path
  bin/                        # Shared CLI tools (jq, etc.)
  agents/                     # Shared agent binaries (latest, single version)
    claude/
    codex/
  cache/
    registry-cache.json       # ACP Registry cache (24h TTL)
```

#### `<workspace>/.openacp/` — Instance (every instance follows this structure)

```
<workspace>/.openacp/
  config.json                 # Instance configuration
  sessions.json               # Session records
  agents.json                 # Agent metadata (which agents enabled, config)
  plugins.json                # Plugin registry
  plugins/                    # Installed plugin packages
    data/                     # Per-plugin settings (API keys, tokens)
  logs/                       # System + session logs
  history/                    # Conversation history per session
  files/                      # User-uploaded files
  cache/                      # Instance-specific cache (context, etc.)
  tunnels.json                # Tunnel configuration
  openacp.pid                 # Runtime: daemon PID
  api.port                    # Runtime: API port
  api-secret                  # Runtime: API auth secret
```

### 2. Instance Resolution Algorithm

```
User runs: openacp <command> [flags]

1. --dir <path> flag?        -> return <path>/.openacp
2. --local flag?             -> return cwd/.openacp
3. CWD has .openacp/config.json?  -> return it
4. Walk-up parent dirs (stop at $HOME, inclusive):
   - Skip ~/.openacp (shared store, not an instance)
   - Find first .openacp/config.json -> return it
5. Check OPENACP_INSTANCE_ROOT env (daemon-child respawn only)
6. Nothing found -> return null
```

#### When null — behavior by command type:

| Command Type | Behavior |
|---|---|
| **Operational** (`start`, `stop`, `restart`, `status`, `logs`, etc.) | Prompt user to select from registry. If registry empty -> error: "No instances found. Run `openacp` in your workspace directory to set up." |
| **Default** (bare `openacp`) | Prompt: select from registry + "Setup new instance here" option |
| **No-instance** (`--help`, `--version`, `instances`, `update`) | Run without instance |

#### Key behavioral changes:

- **Always print instance hint** after resolution: `Using: my-workspace (~/openacp-workspace/.openacp)`
- **Never auto-select** — if instance wasn't resolved via CWD/walk-up/flags, always prompt even with 1 registered instance
- **Walk-up stops at $HOME** — never walks above home directory

### 3. CLI Flags

#### Kept:
- `--dir <path>` — Point to directory containing `.openacp/`
- `--local` — Use `.openacp/` in current working directory

#### Removed:
- `--global` — Deprecated with warning: "Warning: --global is deprecated. OpenACP no longer has a global instance. Use --dir <path> instead."

#### Changed:
- `--workspace` (setup command) — Deprecated alias for `--dir` with warning: "Warning: --workspace is deprecated. Use --dir instead."

### 4. Config Schema Changes

#### Remove `workspace.baseDir`

Before:
```typescript
workspace: z.object({
  baseDir: z.string().default("~/openacp-workspace"),
  allowExternalWorkspaces: z.boolean().default(true),
  security: z.object({
    allowedPaths: z.array(z.string()).default([]),
    envWhitelist: z.array(z.string()).default([]),
  }).default({}),
}).default({}),
```

After:
```typescript
workspace: z.object({
  // baseDir: REMOVED — derived from instance root parent
  allowExternalWorkspaces: z.boolean().default(true),
  security: z.object({
    allowedPaths: z.array(z.string()).default([]),
    envWhitelist: z.array(z.string()).default([]),
  }).default({}),
}).default({}),
```

Old configs with `baseDir` will be parsed without error (Zod strips unknown fields or ignores with `.passthrough()`). No config migration needed.

#### `resolveWorkspace()` changes

Before: uses `config.workspace.baseDir` as the base directory.

After: derives base from instance root parent.

```typescript
resolveWorkspace(input?: string): string {
  // Derive workspace base from config path
  // configPath = /x/y/.openacp/config.json -> workspace = /x/y/
  const workspaceBase = path.dirname(path.dirname(this.configPath));

  if (!input) {
    fs.mkdirSync(workspaceBase, { recursive: true });
    return workspaceBase;
  }

  // Rest of logic stays the same — absolute paths, tilde paths, named workspaces
  // all resolved relative to workspaceBase instead of config.workspace.baseDir
}
```

### 5. InstanceContext.paths Changes

Three paths move from instance-local to global shared:

| Path | Before | After |
|---|---|---|
| `paths.agentsDir` | `<instance>/.openacp/agents/` | `~/.openacp/agents/` |
| `paths.bin` | `<instance>/.openacp/bin/` | `~/.openacp/bin/` |
| `paths.registryCache` | `<instance>/.openacp/registry-cache.json` | `~/.openacp/cache/registry-cache.json` |

All other paths remain instance-local.

### 6. Setup Flow Changes

#### `openacp setup --dir ~/openacp-workspace --agent claude`

1. Create `~/openacp-workspace/.openacp/`
2. Write config.json (no `baseDir` field)
3. Register in `~/.openacp/instances.json`
4. Add `.openacp/` to `.gitignore`

#### Interactive wizard (`openacp` bare command)

Steps:
1. Instance name
2. Copy from existing? (if other instances exist)
3. Channels (SSE, Telegram, Discord...)
4. Default agent
5. Integrations (Claude CLI, etc.)
6. Run mode (daemon/foreground)

**Removed step:** Workspace directory prompt (no longer needed — workspace = CWD).

### 7. Auto-Migration from Global Instance

#### Trigger

On any CLI invocation, before command execution:
- Check if `~/.openacp/config.json` exists
- If yes -> this is an old global instance that needs migration

#### Flow

```
1. Read ~/.openacp/config.json
2. Extract workspace.baseDir (default: "~/openacp-workspace")
3. Target = <expanded baseDir>/.openacp/
4. Create target directory
5. Move instance files to target (overwrite if exists):
   - config.json, sessions.json, agents.json, plugins.json
   - plugins/, logs/, history/, files/, cache/ (instance-specific only)
   - tunnels.json, api-secret
   - NOT: instances.json, bin/, agents/ (binary), cache/registry-cache.json
6. Strip workspace.baseDir from migrated config.json
7. Update instances.json: replace old root with new root
8. Delete instance files from ~/.openacp/ (keep shared files)
9. Print: "Migrated global instance -> ~/openacp-workspace/.openacp"
```

#### Edge cases

- **`baseDir` missing in old config** -> use `~/openacp-workspace` as default target
- **Target already has `.openacp/`** -> overwrite all files
- **Old local instances** -> no migration needed, already correct format. Only strip `workspace.baseDir` from config on next load.
- **Runtime files** (`openacp.pid`, `api.port`, `running`) -> not moved, regenerated on next start

### 8. Deprecated Flag Handling

```typescript
// --global flag
if (flags.global) {
  console.warn("Warning: --global is deprecated. OpenACP no longer has a global instance.")
  console.warn("Use --dir <path> to specify a workspace directory.")
  // Ignore the flag — proceed with normal resolution
}

// --workspace in setup command
if (workspaceFlag) {
  console.warn("Warning: --workspace is deprecated. Use --dir instead.")
  // Treat as --dir
  flags.dir = workspaceFlag
}
```

### 9. Remove `isGlobal` from InstanceContext

The `isGlobal` field on `InstanceContext` is removed entirely. No instance is "global" anymore.

**Before:**
```typescript
interface InstanceContext {
  id: string
  root: string
  isGlobal: boolean  // REMOVED
  paths: { ... }
}
```

**After:**
```typescript
interface InstanceContext {
  id: string
  root: string
  paths: { ... }
}
```

All code checking `isGlobal` (wizard, CLI commands, instances display, daemon-child) must be updated to remove those checks. Instance display labels change from "global"/"local" to just name + path.

### 10. AgentCatalog — Remove Global Fallback Store

PR #219 added a global-to-instance agent fallback chain: if an agent isn't found in the instance `agents.json`, it falls back to `~/.openacp/agents.json`. After this refactor, `~/.openacp/agents.json` no longer exists.

**Changes:**
- Remove `globalStore` field and all global fallback logic from `AgentCatalog`
- Remove the "installed globally" error message from `uninstall()` method
- Ensure every instance creation path writes `agents.json` with required agents:
  - `cmdSetup --dir ... --agent claude` must write `agents.json` entry
  - Interactive wizard `setupAgents()` already handles this
  - `copyInstance()` already copies `agents.json`

### 11. `startServer()` — Remove Global Fallback, Use CWD Detection

When `startServer()` is called without `instanceContext` (dev direct execution), instead of falling back to `~/.openacp`:

```typescript
if (!opts?.instanceContext) {
  const root = process.env.OPENACP_INSTANCE_ROOT
    ?? resolveInstanceRoot({ cwd: process.cwd() })

  if (!root) {
    console.error(`
  ✗ No OpenACP instance found.

  startServer() requires an instance context. Options:

    1. cd into a workspace directory:
       cd ~/openacp-workspace && node dist/main.js

    2. Set OPENACP_INSTANCE_ROOT:
       OPENACP_INSTANCE_ROOT=~/openacp-workspace/.openacp node dist/main.js

    3. Use the CLI (recommended):
       openacp start --dir ~/openacp-workspace
`)
    process.exit(1)
  }

  // Create context from resolved root
}
```

### 12. Hardcoded `~/.openacp` Fallbacks — Full Inventory

These files have hardcoded `?? path.join(os.homedir(), '.openacp')` or similar fallbacks that must be removed or updated:

| File | Line(s) | Current Fallback | Fix |
|---|---|---|---|
| `src/main.ts` | 34-38 | Creates global context | CWD detection + error (see section 11) |
| `src/core/core.ts` | 105 | `sessions.json` path | Remove fallback, require ctx |
| `src/core/core.ts` | 134 | `pluginsData` path | Remove fallback, require ctx |
| `src/core/agents/agent-catalog.ts` | 38 | `registry-cache.json` path | Remove fallback, require cachePath |
| `src/core/agents/agent-catalog.ts` | 42-45 | Global agent store | Remove entirely (section 10) |
| `src/core/agents/agent-store.ts` | 35 | `agents.json` path | Remove fallback, require filePath |
| `src/cli/post-upgrade.ts` | 16 | SettingsManager path via `baseDir` | Pass ctx.paths.pluginsData |
| `src/plugins/file-service/index.ts` | 16, 28 | Instance root fallback | Remove `?? ~/.openacp` (ctx always provided) |
| `src/plugins/api-server/routes/plugins.ts` | 99-102 | Instance root fallback | Remove fallback |
| `src/cli/commands/start.ts` | 13 | `?? ~/.openacp` | Remove fallback |
| `src/cli/commands/default.ts` | 17 | `?? ~/.openacp` | Remove fallback |
| `src/cli/commands/stop.ts` | 10 | `?? ~/.openacp` | Remove fallback |
| `src/cli/commands/restart.ts` | similar | `?? ~/.openacp` | Remove fallback |
| `src/cli/commands/attach.ts` | similar | `?? ~/.openacp` | Remove fallback |
| `src/cli/commands/install.ts` | 12 | `?? ~/.openacp` | Remove fallback |
| `src/cli/commands/uninstall.ts` | 12 | `?? ~/.openacp` | Remove fallback |
| `src/cli/commands/plugins.ts` | multiple | `?? ~/.openacp` | Remove fallback |
| `src/cli/commands/reset.ts` | similar | `?? ~/.openacp` | Remove fallback |
| `src/cli/daemon.ts` | 7 | `DEFAULT_ROOT` constant | Remove constant, require root param |

**Files that correctly use `~/.openacp` (no change needed):**
- `src/core/utils/install-binary.ts` — `~/.openacp/bin/` is correct (shared global binaries)
- `src/cli/integrate.ts` — `~/.openacp/bin/jq` is correct (shared global)
- Instance registry always reads from `~/.openacp/instances.json` — correct

## Files to Change

### Production Code (~28 files)

| File | Change |
|---|---|
| **Core Instance** | |
| `src/core/instance/instance-context.ts` | Remove `isGlobal` from interface. Remove `--global` from ResolveOpts. Walk-up stops at $HOME. Shared paths (`agentsDir`, `bin`, `registryCache`) point to `~/.openacp/` |
| `src/core/instance/instance-copy.ts` | Stop copying `workspace.baseDir` field |
| **Config** | |
| `src/core/config/config.ts` | Remove `workspace.baseDir` from schema. `resolveWorkspace()` derives from configPath |
| `src/core/config/config-registry.ts` | Remove `workspace.baseDir` entry |
| `src/core/config/config-editor.ts` | Remove workspace directory edit option |
| **CLI Entry** | |
| `src/cli.ts` | Remove `--global` flag. `--workspace` -> alias for `--dir` + warning |
| `src/cli/instance-prompt.ts` | Remove auto-select for single instance. Remove global fallback. Always prompt when null |
| `src/cli/daemon.ts` | Remove `DEFAULT_ROOT` constant. Require root param everywhere |
| `src/cli/post-upgrade.ts` | Accept instanceContext or pluginsData path instead of deriving from config.workspace |
| **CLI Commands** | |
| `src/cli/commands/start.ts` | Remove `?? ~/.openacp` fallback |
| `src/cli/commands/default.ts` | Remove `?? ~/.openacp` fallback. Remove `isGlobal` usage |
| `src/cli/commands/stop.ts` | Remove `?? ~/.openacp` fallback |
| `src/cli/commands/restart.ts` | Remove `?? ~/.openacp` fallback |
| `src/cli/commands/attach.ts` | Remove `?? ~/.openacp` fallback |
| `src/cli/commands/install.ts` | Remove `?? ~/.openacp` fallback |
| `src/cli/commands/uninstall.ts` | Remove `?? ~/.openacp` fallback |
| `src/cli/commands/plugins.ts` | Remove `?? ~/.openacp` fallback |
| `src/cli/commands/reset.ts` | Remove `?? ~/.openacp` fallback |
| `src/cli/commands/setup.ts` | `--workspace` deprecated -> `--dir`. Remove `baseDir` from config write. Write `agents.json` |
| `src/cli/commands/instances.ts` | Remove `workspace.baseDir` references. Remove "global"/"local" labels |
| **Core** | |
| `src/main.ts` | Remove global fallback in startServer(). Use CWD detection + error |
| `src/core/core.ts` | Remove hardcoded `~/.openacp` fallbacks for sessions and pluginsData |
| `src/core/agents/agent-catalog.ts` | Remove `globalStore` and global fallback chain. Remove hardcoded cachePath fallback |
| `src/core/agents/agent-store.ts` | Remove hardcoded filePath fallback |
| **Setup** | |
| `src/core/setup/wizard.ts` | Remove `setupWorkspace()` step. Remove `isGlobal` logic |
| `src/core/setup/setup-workspace.ts` | Delete file |
| `src/core/setup/helpers.ts` | Remove workspace display line |
| **Doctor** | |
| `src/core/doctor/checks/workspace.ts` | Derive workspace from instance root |
| **Assistant** | |
| `src/core/assistant/prompt-constants.ts` | Remove `config set workspace.baseDir` example |
| `src/core/assistant/sections/config.ts` | Remove workspace base display |
| **Plugins** | |
| `src/plugins/telegram/commands/new-session.ts` | Replace `config.workspace.baseDir` with `configManager.resolveWorkspace()` |
| `src/plugins/telegram/commands/resume.ts` | Replace `config.workspace.baseDir` with `configManager.resolveWorkspace()` |
| `src/plugins/telegram/commands/index.ts` | Replace `config.workspace.baseDir` reference |
| `src/plugins/file-service/index.ts` | Remove `?? ~/.openacp` fallback in install/configure |
| `src/plugins/api-server/routes/plugins.ts` | Remove `?? ~/.openacp` fallback |
| **Docs** | |
| `src/data/product-guide.ts` | Update workspace.baseDir documentation |

### New Files (1 file)

| File | Purpose |
|---|---|
| `src/core/instance/migration.ts` | Auto-migrate global instance to workspace directory |

### Test Files (~17 files)

#### Critical — Rewrite

| File | Change |
|---|---|
| `src/core/instance/__tests__/instance-context.test.ts` | Remove `isGlobal` assertions |
| `src/core/instance/__tests__/multi-instance-flows.test.ts` | Remove `isGlobal` checks and global instance tests |
| `src/__tests__/config-workspace.test.ts` | Rewrite: workspace derived from instance root, not baseDir |
| `src/core/config/__tests__/resolve-workspace.test.ts` | Rewrite: base derived from configPath |

#### Major — Significant Updates

| File | Change |
|---|---|
| `src/__tests__/setup-integration.test.ts` | Remove workspace setup step and baseDir assertions |
| `src/cli/commands/__tests__/setup.test.ts` | Update for --dir flag, remove --workspace and baseDir |
| `src/core/config/__tests__/config-registry.test.ts` | Remove workspace.baseDir assertion |
| `src/core/config/__tests__/config-registry-extended.test.ts` | Remove workspace.baseDir test line |
| `src/__tests__/config-editor.test.ts` | Remove/rewrite workspace edit test |

#### Medium — Mock Config Updates

| File | Change |
|---|---|
| `src/core/setup/__tests__/helpers.test.ts` | Remove baseDir from mock config |
| `src/core/setup/__tests__/setup-channels.test.ts` | Remove baseDir from mock config |
| `src/core/__tests__/instance-copy.test.ts` | Update workspace assertions |
| `src/core/instance/__tests__/instance-copy.test.ts` | Update workspace assertions |
| `src/__tests__/config-new-methods.test.ts` | Remove baseDir from mock configs |

#### Minor — Simple Mock Updates

| File | Change |
|---|---|
| `src/core/__tests__/core-orchestrator.test.ts` | Remove baseDir from mock config |
| `src/__tests__/api-server.test.ts` | Remove baseDir from mock config |
| `src/core/assistant/sections/__tests__/config-section.test.ts` | Remove workspace mock |
| `src/core/__tests__/multi-instance-plumbing.test.ts` | Remove isGlobal references |

### No Changes Required

- Plugin system infrastructure (lifecycle, registry, middleware, ServiceRegistry)
- Session management (session.ts, session-factory.ts, session-manager.ts)
- Agent spawning (agent-instance.ts)
- `copyInstance()` — works as-is, just won't copy `baseDir` anymore
- `allowExternalWorkspaces` — still functional
- `resolveWorkspace()` public API — same signature, different internal source
- Shared binary paths (`install-binary.ts`, `integrate.ts`) — correctly use `~/.openacp/bin/`
- Context plugin, speech plugin, tunnel plugin, security plugin, notifications plugin — all use `ctx.instanceRoot` correctly
