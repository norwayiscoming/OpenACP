# Extract Discord Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Discord adapter from OpenACP's built-in plugins into a standalone npm package `@openacp/adapter-discord`.

**Architecture:** Copy all 29 files from `src/plugins/discord/` to the standalone repo at `../discord-plugin/`. Extend `@openacp/plugin-sdk` to re-export all symbols the Discord plugin needs. Replace all `../../core/` imports with `@openacp/plugin-sdk`. Remove Discord from OpenACP's built-in plugins.

**Tech Stack:** TypeScript, ESM, vitest, discord.js ^14.x, @openacp/plugin-sdk

**Spec:** `docs/superpowers/specs/2026-03-27-extract-discord-plugin-design.md`

---

## File Structure

### OpenACP repo changes:
- Modify: `packages/plugin-sdk/src/index.ts` — add ~20 re-exports
- Modify: `packages/plugin-sdk/src/testing.ts` — add `runAdapterConformanceTests` re-export
- Modify: `src/core/adapter-primitives/index.ts` — export format-utils and message-formatter
- Modify: `src/core/index.ts` — export CommandRegistry, DoctorEngine, PRODUCT_GUIDE, etc.
- Modify: `src/core/plugin/lifecycle-manager.ts` — add migration alias
- Modify: `src/plugins/core-plugins.ts` — remove Discord
- Delete: `src/plugins/discord/` — entire directory
- Modify: `package.json` — remove discord.js dependency

### New discord-plugin repo:
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.npmignore`
- Create: `src/index.ts` — refactored plugin entry
- Copy+refactor: all 26 source files from `src/plugins/discord/`
- Copy+refactor: all 3 test files from `src/plugins/discord/__tests__/`

---

### Task 1: Extend @openacp/cli exports

Add missing symbols to the CLI's public API so the Plugin SDK can re-export them.

**Files:**
- Modify: `src/core/adapter-primitives/index.ts`
- Modify: `src/core/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add format-utils and message-formatter exports to adapter-primitives/index.ts**

```typescript
// Add to end of src/core/adapter-primitives/index.ts:
export { progressBar, formatTokens, truncateContent, stripCodeFences, splitMessage } from './format-utils.js'
export { extractContentText, formatToolSummary, formatToolTitle, resolveToolIcon } from './message-formatter.js'
export { STATUS_ICONS, KIND_ICONS } from './format-types.js'
```

- [ ] **Step 2: Add CommandRegistry, Doctor, PRODUCT_GUIDE exports to core/index.ts**

```typescript
// Add to src/core/index.ts:
export { CommandRegistry } from './command-registry.js'
export { DoctorEngine } from './doctor/index.js'
export type { DoctorReport, PendingFix } from './doctor/types.js'
export { PRODUCT_GUIDE } from '../data/product-guide.js'
```

- [ ] **Step 3: Verify build passes**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/core/adapter-primitives/index.ts src/core/index.ts
git commit -m "feat(core): export format-utils, message-formatter, CommandRegistry, Doctor, PRODUCT_GUIDE for plugin SDK"
```

---

### Task 2: Extend @openacp/plugin-sdk exports

Re-export all symbols the Discord plugin needs from the SDK.

**Files:**
- Modify: `packages/plugin-sdk/src/index.ts`
- Modify: `packages/plugin-sdk/src/testing.ts`

- [ ] **Step 1: Add type re-exports to plugin-sdk/src/index.ts**

Replace the entire file with:

```typescript
// Plugin interfaces
export type {
  OpenACPPlugin, PluginContext, PluginPermission, PluginStorage,
  InstallContext, MigrateContext, TerminalIO, SettingsAPI,
} from '@openacp/cli'

// Command types
export type {
  CommandDef, CommandArgs, CommandResponse, MenuOption, ListItem,
} from '@openacp/cli'

// Service interfaces
export type {
  SecurityService, FileServiceInterface, NotificationService,
  UsageService, SpeechServiceInterface, TunnelServiceInterface, ContextService,
} from '@openacp/cli'

// Adapter types
export type {
  IChannelAdapter, AdapterCapabilities, OutgoingMessage, PermissionRequest,
  PermissionOption, NotificationMessage, AgentCommand,
} from '@openacp/cli'

// Adapter base classes
export { MessagingAdapter, StreamAdapter, BaseRenderer } from '@openacp/cli'
export type { MessagingAdapterConfig, IRenderer, RenderedMessage } from '@openacp/cli'

// Adapter primitives
export { SendQueue, DraftManager, ToolCallTracker, ActivityTracker } from '@openacp/cli'

// Format types & constants
export type { DisplayVerbosity, ToolCallMeta, ToolUpdateMeta, ViewerLinks } from '@openacp/cli'
export { STATUS_ICONS, KIND_ICONS } from '@openacp/cli'

// Format utilities
export { progressBar, formatTokens, truncateContent, stripCodeFences, splitMessage } from '@openacp/cli'
export { extractContentText, formatToolSummary, formatToolTitle, resolveToolIcon } from '@openacp/cli'

// Core classes
export { OpenACPCore } from '@openacp/cli'
export { Session } from '@openacp/cli'
export type { SessionEvents } from '@openacp/cli'
export { SessionManager } from '@openacp/cli'
export { CommandRegistry } from '@openacp/cli'

// Doctor system
export { DoctorEngine } from '@openacp/cli'
export type { DoctorReport, PendingFix } from '@openacp/cli'

// Config utilities
export type { ConfigFieldDef } from '@openacp/cli'
export { getSafeFields, resolveOptions, getConfigValue, isHotReloadable } from '@openacp/cli'

// Logging
export { log, createChildLogger } from '@openacp/cli'

// Data
export { PRODUCT_GUIDE } from '@openacp/cli'

// Core types
export type {
  Attachment, PlanEntry, StopReason, SessionStatus, ConfigOption,
  UsageRecord, UsageSummary, InstallProgress,
  DiscordPlatformData, TelegramPlatformData,
} from '@openacp/cli'
```

- [ ] **Step 2: Add runAdapterConformanceTests to testing.ts**

Add to `packages/plugin-sdk/src/testing.ts`:

```typescript
export { runAdapterConformanceTests } from '@openacp/cli'
```

Note: `runAdapterConformanceTests` must first be exported from `src/core/adapter-primitives/index.ts`. Add this line to the adapter-primitives index (back in OpenACP repo):

```typescript
export { runAdapterConformanceTests } from './__tests__/adapter-conformance.js'
```

- [ ] **Step 3: Verify SDK builds**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-sdk/src/index.ts packages/plugin-sdk/src/testing.ts src/core/adapter-primitives/index.ts
git commit -m "feat(plugin-sdk): export all symbols needed by adapter plugins"
```

---

### Task 3: Update legacy migration map

**Files:**
- Modify: `src/core/plugin/lifecycle-manager.ts`

- [ ] **Step 1: Add migration alias for new plugin name**

In `src/core/plugin/lifecycle-manager.ts`, find the `legacyMap` object (around line 32-42) and add:

```typescript
const legacyMap: Record<string, string> = {
  '@openacp/security': 'security',
  '@openacp/speech': 'speech',
  '@openacp/tunnel': 'tunnel',
  '@openacp/usage': 'usage',
  '@openacp/file-service': 'files',
  '@openacp/api-server': 'api',
  '@openacp/telegram': 'channels.telegram',
  '@openacp/discord': 'channels.discord',
  '@openacp/adapter-discord': 'channels.discord',  // alias for extracted plugin
  '@openacp/slack': 'channels.slack',
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/plugin/lifecycle-manager.ts
git commit -m "fix(plugin): add @openacp/adapter-discord migration alias for backward compat"
```

---

### Task 4: Set up standalone discord-plugin project

**Files:**
- Create: `../discord-plugin/package.json`
- Create: `../discord-plugin/tsconfig.json`
- Create: `../discord-plugin/.gitignore`
- Create: `../discord-plugin/.npmignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@openacp/adapter-discord",
  "version": "0.1.0",
  "description": "Discord adapter plugin for OpenACP — forum threads, slash commands, streaming messages",
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
    "discord.js": "^14.25.1"
  },
  "devDependencies": {
    "@openacp/plugin-sdk": ">=2026.0326.0",
    "@openacp/cli": ">=2026.0326.0",
    "typescript": "^5.4.0",
    "vitest": "^3.0.0"
  },
  "files": ["dist"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/Open-ACP/discord-plugin.git"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

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

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 4: Create .npmignore**

```
src/
tsconfig.json
.gitignore
*.test.ts
__tests__/
```

- [ ] **Step 5: Commit**

```bash
cd ../discord-plugin
git add package.json tsconfig.json .gitignore .npmignore
git commit -m "chore: add project scaffolding (package.json, tsconfig, gitignore)"
```

---

### Task 5: Copy and refactor Discord plugin source files

Copy all source files from `src/plugins/discord/` to the standalone repo and replace all `../../core/` imports with `@openacp/plugin-sdk`.

**Files:**
- Copy all from: `OpenACP/src/plugins/discord/` → `discord-plugin/src/`

- [ ] **Step 1: Copy all source files**

```bash
# From OpenACP repo
cp -r src/plugins/discord/* ../discord-plugin/src/
```

This copies: `index.ts`, `adapter.ts`, `renderer.ts`, `formatting.ts`, `streaming.ts`, `draft-manager.ts`, `tool-call-tracker.ts`, `skill-command-manager.ts`, `activity.ts`, `permissions.ts`, `forums.ts`, `assistant.ts`, `action-detect.ts`, `media.ts`, `types.ts`, `validators.ts`, `commands/` (10 files), `__tests__/` (3 files).

- [ ] **Step 2: Refactor index.ts imports**

Replace in `discord-plugin/src/index.ts`:
```typescript
// OLD:
import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import type { OpenACPCore } from '../../core/core.js'

// NEW:
import type { OpenACPPlugin, InstallContext, OpenACPCore } from '@openacp/plugin-sdk'
```

Also change:
- `name: '@openacp/discord'` → `name: '@openacp/adapter-discord'`
- `essential: true` → `essential: false`

- [ ] **Step 3: Refactor adapter.ts imports**

Replace in `discord-plugin/src/adapter.ts`:
```typescript
// OLD (lines 10-48):
import type { OutgoingMessage, PermissionRequest, NotificationMessage, AgentCommand, PlanEntry } from "../../core/types.js";
import type { OpenACPCore } from "../../core/core.js";
import type { Session } from "../../core/sessions/session.js";
import { log } from "../../core/utils/log.js";
import type { DisplayVerbosity } from "../../core/adapter-primitives/format-types.js";
import { MessagingAdapter, type MessagingAdapterConfig } from "../../core/adapter-primitives/messaging-adapter.js";
import type { IRenderer } from "../../core/adapter-primitives/rendering/renderer.js";
import type { AdapterCapabilities } from "../../core/channel.js";
import { SendQueue } from "../../core/adapter-primitives/primitives/send-queue.js";
import type { Attachment } from "../../core/types.js";
import type { FileServiceInterface, CommandResponse } from "../../core/plugin/types.js";
import type { CommandRegistry } from "../../core/command-registry.js";

// NEW:
import type {
  OutgoingMessage, PermissionRequest, NotificationMessage, AgentCommand, PlanEntry,
  Attachment, DisplayVerbosity, AdapterCapabilities, IRenderer,
  MessagingAdapterConfig, FileServiceInterface, CommandResponse,
} from '@openacp/plugin-sdk'
import { log, MessagingAdapter, SendQueue, OpenACPCore, Session, CommandRegistry } from '@openacp/plugin-sdk'
```

- [ ] **Step 4: Refactor renderer.ts imports**

Replace in `discord-plugin/src/renderer.ts`:
```typescript
// OLD:
import { BaseRenderer } from "../../core/adapter-primitives/rendering/renderer.js";
import type { RenderedMessage } from "../../core/adapter-primitives/rendering/renderer.js";
import type { OutgoingMessage, NotificationMessage } from "../../core/types.js";
import type { DisplayVerbosity, ToolCallMeta, ToolUpdateMeta } from "../../core/adapter-primitives/format-types.js";
import type { PlanEntry } from "../../core/types.js";

// NEW:
import { BaseRenderer } from '@openacp/plugin-sdk'
import type { RenderedMessage, OutgoingMessage, NotificationMessage, DisplayVerbosity, ToolCallMeta, ToolUpdateMeta, PlanEntry } from '@openacp/plugin-sdk'
```

- [ ] **Step 5: Refactor formatting.ts imports**

Replace in `discord-plugin/src/formatting.ts`:
```typescript
// OLD:
import type { PlanEntry } from "../../core/types.js";
import type { ToolCallMeta, ToolUpdateMeta, ViewerLinks } from "../../core/adapter-primitives/format-types.js";
import { STATUS_ICONS, KIND_ICONS } from "../../core/adapter-primitives/format-types.js";
import { progressBar, formatTokens, truncateContent, stripCodeFences, splitMessage as sharedSplitMessage } from "../../core/adapter-primitives/format-utils.js";
import { extractContentText, formatToolSummary, formatToolTitle, resolveToolIcon } from "../../core/adapter-primitives/message-formatter.js";
import type { DisplayVerbosity } from "../../core/adapter-primitives/format-types.js";

// NEW:
import type { PlanEntry, ToolCallMeta, ToolUpdateMeta, ViewerLinks, DisplayVerbosity } from '@openacp/plugin-sdk'
import { STATUS_ICONS, KIND_ICONS, progressBar, formatTokens, truncateContent, stripCodeFences, splitMessage as sharedSplitMessage, extractContentText, formatToolSummary, formatToolTitle, resolveToolIcon } from '@openacp/plugin-sdk'
```

- [ ] **Step 6: Refactor remaining source files**

Apply the same pattern to all remaining files. The import replacement rule is simple:

| Old import path | New import |
|---|---|
| `../../core/types.js` | `@openacp/plugin-sdk` |
| `../../core/core.js` | `@openacp/plugin-sdk` |
| `../../core/sessions/session.js` | `@openacp/plugin-sdk` |
| `../../core/sessions/session-manager.js` | `@openacp/plugin-sdk` |
| `../../core/utils/log.js` | `@openacp/plugin-sdk` |
| `../../core/adapter-primitives/*.js` | `@openacp/plugin-sdk` |
| `../../core/channel.js` | `@openacp/plugin-sdk` |
| `../../core/plugin/types.js` | `@openacp/plugin-sdk` |
| `../../core/command-registry.js` | `@openacp/plugin-sdk` |
| `../../core/config/config-registry.js` | `@openacp/plugin-sdk` |
| `../../core/doctor/index.js` | `@openacp/plugin-sdk` |
| `../../core/doctor/types.js` | `@openacp/plugin-sdk` |
| `../../data/product-guide.js` | `@openacp/plugin-sdk` |
| `../../../core/*` (commands/) | `@openacp/plugin-sdk` |

Files to refactor (besides index.ts, adapter.ts, renderer.ts, formatting.ts already done above):
- `types.ts`: `Session` → `@openacp/plugin-sdk`
- `assistant.ts`: `OpenACPCore`, `Session`, `log`, `PRODUCT_GUIDE` → `@openacp/plugin-sdk`
- `draft-manager.ts`: `SendQueue` → `@openacp/plugin-sdk`
- `streaming.ts`: `SendQueue` → `@openacp/plugin-sdk`
- `tool-call-tracker.ts`: `createChildLogger`, `ToolCallTracker`, `SendQueue` → `@openacp/plugin-sdk`
- `activity.ts`: `log`, `PlanEntry`, `DisplayVerbosity`, `SendQueue` → `@openacp/plugin-sdk`
- `media.ts`: `Attachment`, `log` → `@openacp/plugin-sdk`
- `permissions.ts`: `PermissionRequest`, `NotificationMessage`, `Session`, `log` → `@openacp/plugin-sdk`
- `forums.ts`: `log` → `@openacp/plugin-sdk`
- `skill-command-manager.ts`: `log`, `AgentCommand`, `SessionManager`, `DiscordPlatformData`, `SendQueue` → `@openacp/plugin-sdk`
- `commands/session.ts`: `Session`, `log` → `@openacp/plugin-sdk`
- `commands/admin.ts`: `log` → `@openacp/plugin-sdk`
- `commands/router.ts`: `log` → `@openacp/plugin-sdk`
- `commands/new-session.ts`: `log` → `@openacp/plugin-sdk`
- `commands/integrate.ts`: `log` → `@openacp/plugin-sdk`
- `commands/agents.ts`: `log`, `InstallProgress` → `@openacp/plugin-sdk`
- `commands/menu.ts`: `log` → `@openacp/plugin-sdk`
- `commands/doctor.ts`: `DoctorEngine`, `DoctorReport`, `PendingFix`, `log` → `@openacp/plugin-sdk`
- `commands/settings.ts`: `log`, `getSafeFields`, `resolveOptions`, `getConfigValue`, `isHotReloadable`, `ConfigFieldDef` → `@openacp/plugin-sdk`

- [ ] **Step 7: Refactor test files**

Replace in `__tests__/conformance.test.ts`:
```typescript
// OLD:
import { runAdapterConformanceTests } from '../../../core/adapter-primitives/__tests__/adapter-conformance.js'
import { MessagingAdapter } from '../../../core/adapter-primitives/messaging-adapter.js'
import { BaseRenderer } from '../../../core/adapter-primitives/rendering/renderer.js'
import type { AdapterCapabilities } from '../../../core/channel.js'

// NEW:
import { runAdapterConformanceTests } from '@openacp/plugin-sdk/testing'
import { MessagingAdapter, BaseRenderer } from '@openacp/plugin-sdk'
import type { AdapterCapabilities } from '@openacp/plugin-sdk'
```

Replace in `__tests__/formatting.test.ts`:
```typescript
// OLD:
import type { PlanEntry } from '../../../core/types.js'

// NEW:
import type { PlanEntry } from '@openacp/plugin-sdk'
```

- [ ] **Step 8: Commit**

```bash
cd ../discord-plugin
git add src/
git commit -m "feat: copy Discord plugin source and refactor imports to @openacp/plugin-sdk"
```

---

### Task 6: Install dependencies and verify build

**Files:**
- Working in: `../discord-plugin/`

- [ ] **Step 1: Install dependencies**

```bash
cd ../discord-plugin
npm install
```

Note: `@openacp/plugin-sdk` and `@openacp/cli` will need to be linked locally since they're not published yet with the new exports. Use:

```bash
cd ./packages/plugin-sdk && npm link
cd . && npm link
cd ../discord-plugin && npm link @openacp/plugin-sdk @openacp/cli
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: No TypeScript errors. `dist/` directory created with compiled JS + declaration files.

- [ ] **Step 3: Fix any compilation errors**

If there are missing exports or type mismatches, go back to Task 1/2 and add the missing exports.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All 3 test files pass (conformance, formatting, media).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build and test issues"
```

---

### Task 7: Remove Discord plugin from OpenACP

**Files:**
- Modify: `src/plugins/core-plugins.ts`
- Delete: `src/plugins/discord/`
- Modify: `package.json`

- [ ] **Step 1: Remove Discord import and registration from core-plugins.ts**

In `src/plugins/core-plugins.ts`, remove:
```typescript
// Remove line 15:
import discordPlugin from './discord/index.js'

// Remove from corePlugins array (line 31):
  discordPlugin,
```

- [ ] **Step 2: Delete Discord plugin directory**

```bash
rm -rf src/plugins/discord/
```

- [ ] **Step 3: Remove discord.js from package.json dependencies**

Remove `"discord.js": "^14.25.1"` from the `dependencies` section of the root `package.json`.

- [ ] **Step 4: Reinstall and verify build**

```bash
pnpm install
pnpm build
```

Expected: Build succeeds without Discord plugin.

- [ ] **Step 5: Run OpenACP tests**

```bash
pnpm test
```

Expected: All tests pass. Discord-specific tests are gone (deleted with the directory). No other tests should break.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove built-in Discord plugin (now available as @openacp/adapter-discord)"
```

---

### Task 8: Update README in discord-plugin repo

**Files:**
- Modify: `../discord-plugin/README.md`

- [ ] **Step 1: Write README**

```markdown
# @openacp/adapter-discord

Discord adapter plugin for [OpenACP](https://github.com/Open-ACP/OpenACP). Creates forum threads for each AI session, supports slash commands, streaming messages, and permission requests.

## Installation

```bash
openacp plugin add @openacp/adapter-discord
```

## Development

```bash
git clone https://github.com/Open-ACP/discord-plugin.git
cd discord-plugin
npm install
npm run build
npm test

# Hot-reload development
openacp dev .
```

## Configuration

After installing the plugin, run `openacp plugin configure @openacp/adapter-discord` to set up:

- Discord bot token
- Guild ID
- Forum channel ID
```

- [ ] **Step 2: Commit**

```bash
cd ../discord-plugin
git add README.md
git commit -m "docs: add README with installation and development instructions"
```

---

### Task 9: Push both repos

- [ ] **Step 1: Push discord-plugin**

```bash
cd ../discord-plugin
git push origin main
```

- [ ] **Step 2: Push OpenACP changes**

```bash
cd .
git push origin redesign/microkernel-plugin-architecture
```
