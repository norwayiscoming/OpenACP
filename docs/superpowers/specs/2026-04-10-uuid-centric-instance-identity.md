# UUID-Centric Instance Identity — Design Spec

**Date:** 2026-04-10
**Status:** Draft
**Scope:** Core CLI — instance identity stored in config.json, propagated through all creation paths

## Problem

Instances currently do not know their own UUID. The UUID lives only in `~/.openacp/instances.json`,
keyed by ID. Any code that needs the UUID for a given instance root must look it up from the registry:

- `resolveInstanceId` reads `instances.json`, falls back to sanitized directory name
- `cmdSetup` registers a UUID in `instances.json` but never writes it to `config.json`
- `initInstanceFiles` has no `id` parameter — UUID is invisible to the instance files

This creates two concrete bugs:

1. The App setup wizard cannot get the UUID from `openacp setup --json` output (it returns only
   `{ configPath }`, not `{ id, name, directory }`), forcing a fragile `instances list + path
   comparison` fallback that breaks on tilde paths and produces a hardcoded `'main'` fallback.

2. When the App needs to identify an existing workspace from a directory path, it has no reliable
   method — path comparison is used, which is wrong for identity.

## Solution

Store `id` in `config.json` so every instance carries its own UUID. All instance creation paths
write the UUID into config.json. The CLI surfaces the UUID in `cmdSetup` JSON output.
`resolveInstanceId` reads from config.json first instead of the registry.

### Core Principle

> An instance's UUID is written once at creation time into its own `config.json`.
> The registry (`instances.json`) is an index for discovery, not the source of truth for identity.

---

## Design

### 1. `InitInstanceOptions` — add `id` field

**File:** `src/core/instance/instance-init.ts`

```typescript
export interface InitInstanceOptions {
  id?: string            // UUID for this instance, written to config.json
  agents?: string[]
  instanceName?: string
  mergeExisting?: boolean
  runMode?: 'daemon' | 'foreground'
}
```

`writeConfig` behavior:
- If `opts.id` is provided → write `id` to config object
- If `mergeExisting` is true and existing config already has `id` → preserve existing value
  (never overwrite an established UUID)

```typescript
// In writeConfig():
const id = opts.id ?? (existing['id'] as string | undefined)
if (id) config['id'] = id
```

### 2. `ConfigSchema` — add `id` field

**File:** `src/core/config/config.ts`

```typescript
export const ConfigSchema = z.object({
  id: z.string().optional(),       // ← add: instance UUID, optional for backward compat
  instanceName: z.string().optional(),
  // ... rest unchanged
})
```

### 3. Config migration — `add-instance-id`

**File:** `src/core/config/config-migrations.ts`

`MigrationContext` already has `configDir` (the directory containing `config.json`, which is
`instanceRoot`). The migration reads `instances.json` with plain `fs` to stay synchronous
(no dynamic imports, ESM-compatible):

```typescript
{
  name: 'add-instance-id',
  apply(raw, ctx) {
    if (raw.id) return false           // already has id, skip
    if (!ctx?.configDir) return false  // no context, can't look up

    // instanceRoot = configDir (config.json lives at instanceRoot/config.json)
    const instanceRoot = ctx.configDir

    // Look up UUID from instances.json using plain fs (synchronous, no imports)
    try {
      const registryPath = path.join(os.homedir(), '.openacp', 'instances.json')
      const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
      const instances = data?.instances ?? {}
      const entry = Object.values(instances).find(
        (e: any) => e.root === instanceRoot
      ) as { id: string } | undefined
      if (entry?.id) {
        raw.id = entry.id
        log.info({ instanceRoot }, 'Migrated: added id to config from registry')
        return true
      }
    } catch { /* best-effort — registry may not exist on fresh installs */ }

    return false
  }
}
```

The migration file needs `import fs from 'node:fs'`, `import path from 'node:path'`, and
`import os from 'node:os'` added at the top (project is ESM-only — no `require`).

### 4. `cmdSetup` — pass UUID into `initInstanceFiles`, return in JSON

**File:** `src/cli/commands/setup.ts`

```typescript
// Get or create UUID (idempotent — existing registration is preserved)
const registryPath = path.join(getGlobalRoot(), 'instances.json')
const registry = new InstanceRegistry(registryPath)
registry.load()

let id: string
const existing = registry.getByRoot(instanceRoot)
if (existing) {
  id = existing.id
} else {
  id = randomUUID()
  registry.register(id, instanceRoot)
  registry.save()
}

// Write files with id so config.json carries the UUID
initInstanceFiles(instanceRoot, { agents, runMode, mergeExisting: true, id })

// Read instance name from config (may have been set by user previously)
const name = readConfigField(instanceRoot, 'instanceName') ?? null

const configPath = path.join(instanceRoot, 'config.json')
if (json) {
  jsonSuccess({ id, name, directory: path.dirname(instanceRoot), configPath })
} else {
  console.log(`\n  \x1b[32m✓ Setup complete.\x1b[0m Config written to ${configPath}\n`)
}
```

Helper `readConfigField(instanceRoot, field)`:
```typescript
function readConfigField(instanceRoot: string, field: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(instanceRoot, 'config.json'), 'utf-8'))
    return (raw[field] as string) ?? null
  } catch { return null }
}
```

### 5. `cmdInstancesCreate` — idempotent, pass UUID into `initInstanceFiles`

**File:** `src/cli/commands/instances.ts`

**Change 1: "already registered" case** — return existing entry instead of erroring when `--json`:

```typescript
// Before:
if (existing) {
  if (json) jsonError(ErrorCodes.UNKNOWN_ERROR, `Instance already exists at ${resolvedDir} (id: ${existing.id})`)
  console.error(`Error: Instance already exists...`)
  process.exit(1)
}

// After:
if (existing) {
  // Idempotent in JSON mode — return the existing registration
  if (!json) console.warn(`Warning: Instance already registered at ${resolvedDir} (id: ${existing.id})`)
  await outputInstance(json, { id: existing.id, root: instanceRoot })
  return
}
```

**Change 2: ".openacp exists but not registered" case** — pass UUID to `initInstanceFiles` so
config.json gets the `id` written:

```typescript
// .openacp exists but not registered — register it
const id = randomUUID()
initInstanceFiles(instanceRoot, { mergeExisting: true, id })  // ← write id to config
registry.register(id, instanceRoot)
registry.save()
await outputInstance(json, { id, root: instanceRoot })
```

**Change 3: "create new" case** — same, pass `id`:

```typescript
const id = randomUUID()
initInstanceFiles(instanceRoot, { agents, instanceName: name, id })  // ← write id to config
registry.register(id, instanceRoot)
registry.save()
await outputInstance(json, { id, root: instanceRoot })
```

### 6. `resolveInstanceId` — read config.json first

**File:** `src/cli/resolve-instance-id.ts`

```typescript
export function resolveInstanceId(instanceRoot: string): string {
  // 1. Read id from config.json (preferred — instance knows its own UUID)
  try {
    const configPath = path.join(instanceRoot, 'config.json')
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    if (raw.id && typeof raw.id === 'string') return raw.id
  } catch { /* fall through */ }

  // 2. Fall back to registry (backward compat for instances that haven't migrated yet)
  try {
    const reg = new InstanceRegistry(path.join(getGlobalRoot(), 'instances.json'))
    reg.load()
    const entry = reg.getByRoot(instanceRoot)
    if (entry?.id) return entry.id
  } catch { /* fall through */ }

  // 3. Last resort: sanitized parent dir name
  return path.basename(path.dirname(instanceRoot)).replace(/[^a-zA-Z0-9-]/g, '-') || 'default'
}
```

---

## Files Changed

| File | Change |
|---|---|
| `src/core/instance/instance-init.ts` | Add `id` to `InitInstanceOptions`; write `id` into config.json |
| `src/core/config/config.ts` | Add `id: z.string().optional()` to `ConfigSchema` |
| `src/core/config/config-migrations.ts` | Add `add-instance-id` migration |
| `src/cli/resolve-instance-id.ts` | Read from config.json first, registry as fallback |
| `src/cli/commands/setup.ts` | Pass `id` to `initInstanceFiles`; return `{ id, name, directory, configPath }` in JSON |
| `src/cli/commands/instances.ts` | Idempotent on "already registered" in JSON mode; pass `id` to `initInstanceFiles` in all create paths |

## No Changes Required

- `InstanceRegistry` — still the discovery index, no structural change
- `createInstanceContext` — already receives `id` as parameter, no change
- `main.ts` — already reads UUID from registry when creating context, will benefit from migration
- Wizard setup flow in `src/core/setup/` — `initInstanceFiles` is called without `id` currently;
  the wizard flow goes through `startServer()` which reads from registry. After migration, config
  will have `id`. No immediate change needed (migration handles it).

## Testing

- `initInstanceFiles` with `id` option writes `id` to config.json
- `initInstanceFiles` with `mergeExisting: true` and existing `id` preserves the existing value
- `cmdSetup --json` output includes `{ id, name, directory, configPath }`
- `cmdInstancesCreate --json` on already-registered instance returns `jsonSuccess` with existing UUID (not error)
- `resolveInstanceId` reads from config.json when `id` is present
- Migration `add-instance-id` writes `id` from registry into old configs that lack it
