# Extract Discord Plugin to Standalone Package

## Problem

The Discord adapter is bundled as a built-in plugin in OpenACP, meaning `discord.js` and its dependencies are installed for all users even if they don't use Discord. This adds unnecessary weight. The plugin should be a separate package that users install only when needed.

## Solution

Extract `src/plugins/discord/` from the OpenACP monorepo into a standalone package `@openacp/plugin-discord` in a separate repository. Extend `@openacp/plugin-sdk` to export all types/classes the Discord plugin needs. Remove the Discord plugin from the OpenACP repo.

## Target Repository

`/Users/lab3/Documents/lab3/discord-plugin/` → published as `@openacp/plugin-discord` on npm.

**Note on naming:** The current built-in plugin is named `@openacp/discord`. The extracted plugin will be renamed to `@openacp/plugin-discord`. The legacy migration map in `lifecycle-manager.ts` (`'@openacp/discord': 'channels.discord'`) must be updated to also match the new name to preserve backward compatibility for config migration.

## Standalone Plugin Structure

```
discord-plugin/
  src/
    index.ts                    # Plugin entry (OpenACPPlugin interface)
    adapter.ts                  # DiscordAdapter (extends MessagingAdapter)
    renderer.ts                 # Discord-specific message rendering
    formatting.ts               # Markdown formatting for Discord
    streaming.ts                # Message streaming/chunking
    draft-manager.ts            # Draft message management
    tool-call-tracker.ts        # Tool call display
    skill-command-manager.ts    # Skill command UI
    activity.ts                 # Activity indicators
    permissions.ts              # Permission request buttons
    forums.ts                   # Forum channel management
    assistant.ts                # Assistant topic handler
    action-detect.ts            # Action detection
    media.ts                    # Media/file handling
    types.ts                    # Discord-specific types
    validators.ts               # Config validation
    commands/
      index.ts
      admin.ts
      agents.ts
      doctor.ts
      integrate.ts
      menu.ts
      new-session.ts
      router.ts
      session.ts
      settings.ts
    __tests__/
      conformance.test.ts
      formatting.test.ts
      media.test.ts
  package.json
  tsconfig.json
  .gitignore
  .npmignore
  README.md
```

### `package.json`

```json
{
  "name": "@openacp/plugin-discord",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "@openacp/plugin-sdk": ">=2026.0326.0"
  },
  "dependencies": {
    "discord.js": "^14.x"
  },
  "devDependencies": {
    "@openacp/plugin-sdk": ">=2026.0326.0",
    "typescript": "^5.4.0",
    "vitest": "^3.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

## Import Migration

All `../../core/` imports in the Discord plugin will be replaced with imports from `@openacp/plugin-sdk`.

### Already exported by Plugin SDK (no SDK changes needed)

- Plugin interfaces: `OpenACPPlugin`, `PluginContext`, `InstallContext`, `CommandDef`, `CommandResponse`, `MenuOption`, `ListItem`
- Service interfaces: `SecurityService`, `FileServiceInterface`, `NotificationService`, `UsageService`, `SpeechServiceInterface`, `TunnelServiceInterface`, `ContextService`
- Adapter base classes: `MessagingAdapter`, `StreamAdapter`, `BaseRenderer`
- Adapter primitives: `SendQueue`, `DraftManager`, `ToolCallTracker`, `ActivityTracker`

### Need to add to Plugin SDK

These are currently internal to `@openacp/cli` and need to be re-exported from `@openacp/plugin-sdk`:

**Adapter types (currently not re-exported despite being used by adapters):**
- `IChannelAdapter`, `AdapterCapabilities`
- `OutgoingMessage`, `PermissionRequest`, `NotificationMessage`, `AgentCommand`
- `IRenderer`, `RenderedMessage`

**Format types:**
- `DisplayVerbosity`, `ToolCallMeta`, `ToolUpdateMeta`, `ViewerLinks`, `STATUS_ICONS`, `KIND_ICONS`

**Format utilities:**
- `progressBar`, `formatTokens`, `truncateContent`, `stripCodeFences`, `splitMessage`

**Message formatter:**
- `extractContentText`, `formatToolSummary`, `formatToolTitle`, `resolveToolIcon`

**Core classes:**
- `OpenACPCore` — needed by adapter to access core methods
- `Session` — needed for session interaction
- `SessionManager` — needed for session lookup
- `CommandRegistry` — needed for command routing
- `AgentCatalog` — accessed via `core.agentCatalog`

**Doctor system:**
- `DoctorEngine`, `DoctorReport`, `PendingFix` — needed for `/doctor` command

**Config utilities:**
- `ConfigFieldDef`, `getSafeFields`, `resolveOptions`, `getConfigValue`, `isHotReloadable` — needed for `/settings` command
- `ConfigManager` (or its `save()` parameter type) — accessed via `core.configManager`

**Core methods accessed on OpenACPCore:**
- `requestRestart` — accessed by admin commands

**Types:**
- `SessionStatus`, `ConfigOption`, `UsageRecord`, `UsageSummary`, `PlanEntry`, `Attachment`, `StopReason`, `DiscordPlatformData`, `InstallProgress`

**Data:**
- `PRODUCT_GUIDE` — product guide text used in assistant topic. Must first be exported from `@openacp/cli`'s public API surface (`src/core/index.ts`), then re-exported from SDK.

## Plugin Metadata

The extracted plugin should set:
- `name: '@openacp/plugin-discord'`
- `essential: false` — since it's an optional plugin users choose to install
- `pluginDependencies`: references `@openacp/security` and `@openacp/notifications` by their built-in names. The lifecycle manager resolves these by matching against loaded plugin names. Built-in plugins load before external plugins, so these dependencies will always be available when the Discord plugin loads.

## Changes to OpenACP Repo

### Remove from OpenACP

1. Delete `src/plugins/discord/` entirely
2. Remove Discord registration from `src/plugins/core-plugins.ts`
3. Remove `discord.js` from `package.json` dependencies

### Extend Plugin SDK

Add all missing re-exports listed above to `packages/plugin-sdk/src/index.ts`. All re-exports come from `@openacp/cli` — the SDK is a thin re-export layer, no new code.

### Update legacy migration map

In `src/core/plugin/lifecycle-manager.ts`, add `'@openacp/plugin-discord'` as an alias mapping to `'channels.discord'` alongside the existing `'@openacp/discord'` entry. This ensures config migration works for both the old built-in name and the new package name.

### No changes needed

- Core plugin loader works as-is for external plugins
- Config schema, session management, adapter interface unchanged
- `openacp plugin add` command handles npm install of plugin + its dependencies

## User Installation Flow

```bash
# Install from npm (after publishing)
openacp plugin add @openacp/plugin-discord

# Install from local path (development)
openacp plugin add /path/to/discord-plugin

# Development with hot-reload
openacp dev /path/to/discord-plugin

# Uninstall
openacp plugin remove @openacp/plugin-discord
```

When installed, `discord.js` is npm-installed as a dependency of the plugin. When not installed, OpenACP has zero Discord-related dependencies.

## Testing

### Standalone repo tests

- **Conformance test**: `runAdapterConformanceTests` must be added to `@openacp/plugin-sdk/testing` exports (currently only in `src/core/adapter-primitives/__tests__/adapter-conformance.ts`). Add it as a re-export from the SDK testing entry point.
- **Unit tests**: Copy existing formatting.test.ts, media.test.ts from OpenACP
- **Dev mode**: `openacp dev .` in the plugin directory for hot-reload testing

### Edge cases

- Plugin installed but Discord bot token not configured: plugin's `install()` should prompt for token
- Plugin removed while Discord sessions active: graceful shutdown of Discord adapter
- SDK version mismatch: peerDependency warning from npm
- Boot order: built-in service plugins (@openacp/security, @openacp/notifications) must load before external plugins to satisfy `pluginDependencies`

## Files Modified (Summary)

### OpenACP repo
- `packages/plugin-sdk/src/index.ts` — Add ~40 re-exports
- `packages/plugin-sdk/src/testing.ts` — Add `runAdapterConformanceTests` re-export
- `src/core/plugin/lifecycle-manager.ts` — Add `@openacp/plugin-discord` to migration map
- `src/plugins/core-plugins.ts` — Remove Discord registration
- `src/plugins/discord/` — Delete entirely
- `package.json` — Remove `discord.js` dependency

### New discord-plugin repo
- All 29 files from `src/plugins/discord/` copied and refactored
- New `package.json`, `tsconfig.json`, `.gitignore`, `.npmignore`, `README.md`
- All `../../core/` imports replaced with `@openacp/plugin-sdk`
