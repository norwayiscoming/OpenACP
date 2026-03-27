# Getting Started: Your First Plugin

This tutorial walks you through creating, developing, testing, and publishing an OpenACP plugin from scratch. No prior knowledge of OpenACP internals is required.

---

## Prerequisites

- **Node.js** 18+ installed
- **npm** or **pnpm** installed
- **OpenACP** installed globally (`npm install -g @openacp/cli`)
- A working OpenACP setup (run `openacp onboard` if you haven't yet)

---

## Step 1: Scaffold a New Plugin

Run the scaffold command:

```bash
openacp plugin create
```

You will be prompted for:

```
◆  Create a new OpenACP plugin
│
◇  Plugin name (e.g., @myorg/adapter-matrix)
│  @myorg/hello-world
│
◇  Description
│  A greeting plugin for OpenACP
│
◇  Author
│  Your Name <you@example.com>
│
◇  License
│  MIT
│
◆  Plugin scaffolded!
│
│  Next steps
│
│  cd hello-world
│  npm install
│  npm run build
│  npm test
│
│  # Start development with hot-reload:
│  openacp dev .
│
└  Plugin @myorg/hello-world created in ./hello-world
```

The scaffold creates a directory named after your plugin (without the scope prefix):

```
hello-world/
  src/
    index.ts                  # Plugin entry point
    __tests__/
      index.test.ts           # Test file
  package.json
  tsconfig.json
  .gitignore
  .npmignore
  .editorconfig
  README.md
  CLAUDE.md                   # AI agent context (for Claude, Cursor, etc.)
  PLUGIN_GUIDE.md             # Human-readable developer guide
```

---

## Step 2: Explore the Template

The scaffold generates two documentation files to help you (and your tools) work with the plugin:

- **CLAUDE.md** — A comprehensive technical reference for AI coding agents. Contains the full plugin API, all 18 middleware hooks, permissions, testing utilities, and code patterns. An agent with zero prior context can read this file and write a complete plugin.
- **PLUGIN_GUIDE.md** — A shorter, practical guide for human developers. Covers the development workflow, code examples for common tasks (commands, services, middleware, settings), testing, and publishing.

### package.json

Key fields in the generated `package.json`:

```json
{
  "name": "@myorg/hello-world",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "prepublishOnly": "npm run build"
  },
  "engines": {
    "openacp": ">=2026.0327.1"
  },
  "peerDependencies": {
    "@openacp/cli": ">=2026.0327.1"
  },
  "devDependencies": {
    "@openacp/plugin-sdk": "^1.0.0",
    "typescript": "^5.4.0",
    "vitest": "^3.0.0"
  }
}
```

The `engines.openacp` field declares the minimum OpenACP CLI version required by your plugin. When users install your plugin, OpenACP checks this field and warns if their CLI version is too old. The `peerDependencies` on `@openacp/cli` serves the same purpose for npm's dependency resolver.

The `@openacp/plugin-sdk` package provides all types, base classes, and testing utilities you need.

### src/index.ts

The generated entry point contains every lifecycle hook with inline documentation:

```typescript
import type { OpenACPPlugin, PluginContext, InstallContext, MigrateContext } from '@openacp/plugin-sdk'

const plugin: OpenACPPlugin = {
  name: '@myorg/hello-world',
  version: '0.1.0',
  description: 'A greeting plugin for OpenACP',

  permissions: ['events:read', 'services:register'],

  async setup(ctx: PluginContext): Promise<void> {
    // Called during server startup. Register services, commands, middleware here.
  },

  async teardown(): Promise<void> {
    // Called during server shutdown. Clean up resources.
  },

  async install(ctx: InstallContext): Promise<void> {
    // Called on `openacp plugin add`. Gather configuration interactively.
  },

  async configure(ctx: InstallContext): Promise<void> {
    // Called on `openacp plugin configure`. Update settings.
  },

  async migrate(ctx: MigrateContext, oldSettings: unknown, oldVersion: string): Promise<unknown> {
    // Called on boot when version changes. Migrate settings.
    return oldSettings
  },

  async uninstall(ctx: InstallContext, opts: { purge: boolean }): Promise<void> {
    // Called on `openacp plugin remove`. Clean up external resources.
  },
}

export default plugin
```

**Lifecycle hooks summary:**

| Hook | When it runs | Purpose |
|---|---|---|
| `setup(ctx)` | Server startup (dependency order) | Register services, commands, middleware, event listeners |
| `teardown()` | Server shutdown (reverse order) | Clean up timers, connections, resources |
| `install(ctx)` | `openacp plugin add` | Interactive first-time configuration |
| `configure(ctx)` | `openacp plugin configure` | Re-configure settings |
| `migrate(ctx, old, ver)` | Boot, when version changed | Migrate settings between versions |
| `uninstall(ctx, opts)` | `openacp plugin remove` | Clean up external resources |

---

## Step 3: Development Workflow

Install dependencies and build:

```bash
cd hello-world
npm install
npm run build
```

### Hot-reload development

Start OpenACP in dev mode, pointing to your plugin directory:

```bash
openacp dev .
```

This will:
1. Compile your TypeScript
2. Start `tsc --watch` in the background
3. Boot OpenACP with your plugin loaded
4. Reload your plugin automatically when files change

See [Dev Mode](dev-mode.md) for the full guide.

### Run tests

```bash
npm test
```

Tests use Vitest and the `@openacp/plugin-sdk/testing` utilities.

---

## Step 4: Implement Your Plugin

Let's turn the template into a greeting plugin that responds to a `/hello` command and logs session events.

Replace the contents of `src/index.ts`:

```typescript
import type { OpenACPPlugin, PluginContext, InstallContext } from '@openacp/plugin-sdk'

const plugin: OpenACPPlugin = {
  name: '@myorg/hello-world',
  version: '0.1.0',
  description: 'A greeting plugin for OpenACP',

  permissions: ['events:read', 'commands:register'],

  async setup(ctx: PluginContext): Promise<void> {
    // Register a /hello command
    ctx.registerCommand({
      name: 'hello',
      description: 'Send a greeting',
      usage: '[name]',
      category: 'plugin',

      async handler(args) {
        const name = args.raw.trim() || 'World'
        return { type: 'text', text: `Hello, ${name}! 👋` }
      },
    })

    // Listen to session events
    ctx.on('session:created', (event) => {
      ctx.log.info(`New session started: ${event.sessionId}`)
    })

    ctx.on('session:afterDestroy', (event) => {
      ctx.log.info(`Session ended: ${event.sessionId} (${event.durationMs}ms)`)
    })

    ctx.log.info('Hello World plugin ready')
  },

  async teardown(): Promise<void> {
    // Nothing to clean up
  },

  async install(ctx: InstallContext): Promise<void> {
    ctx.terminal.log.success('Hello World plugin installed!')
  },
}

export default plugin
```

Build and test:

```bash
npm run build
openacp dev .
```

Now in your messaging platform, type `/hello` or `/hello Alice` to see the plugin respond.

---

## Step 5: Test Your Plugin

The scaffold includes a basic test. Let's expand it using the SDK testing utilities.

Replace `src/__tests__/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createTestContext, createTestInstallContext } from '@openacp/plugin-sdk/testing'
import plugin from '../index.js'

describe('@myorg/hello-world', () => {
  it('has correct metadata', () => {
    expect(plugin.name).toBe('@myorg/hello-world')
    expect(plugin.version).toBe('0.1.0')
    expect(plugin.permissions).toContain('commands:register')
  })

  it('registers the /hello command on setup', async () => {
    const ctx = createTestContext({ pluginName: '@myorg/hello-world' })
    await plugin.setup(ctx)

    expect(ctx.registeredCommands.has('hello')).toBe(true)
    expect(ctx.registeredCommands.get('hello')!.description).toBe('Send a greeting')
  })

  it('/hello with no args returns default greeting', async () => {
    const ctx = createTestContext({ pluginName: '@myorg/hello-world' })
    await plugin.setup(ctx)

    const response = await ctx.executeCommand('hello', { raw: '' })
    expect(response).toEqual({ type: 'text', text: 'Hello, World! 👋' })
  })

  it('/hello with a name returns personalized greeting', async () => {
    const ctx = createTestContext({ pluginName: '@myorg/hello-world' })
    await plugin.setup(ctx)

    const response = await ctx.executeCommand('hello', { raw: 'Alice' })
    expect(response).toEqual({ type: 'text', text: 'Hello, Alice! 👋' })
  })

  it('emits log on session events', async () => {
    const ctx = createTestContext({ pluginName: '@myorg/hello-world' })
    await plugin.setup(ctx)

    // Simulate a session:created event
    ctx.emit('session:created', { sessionId: 'test-123' })
    // No error thrown = event handler works
  })

  it('installs without errors', async () => {
    const ctx = createTestInstallContext({
      pluginName: '@myorg/hello-world',
    })
    await plugin.install!(ctx)

    // Verify the install function ran
    expect(ctx.terminalCalls).toHaveLength(0) // no prompts needed
  })

  it('tears down without errors', async () => {
    await expect(plugin.teardown!()).resolves.not.toThrow()
  })
})
```

Run:

```bash
npm test
```

See [Plugin SDK Reference](plugin-sdk-reference.md) for the full testing API including `createTestContext`, `createTestInstallContext`, and `mockServices`.

---

## Step 6: Configure and Install

### Install your plugin locally

For testing with a real OpenACP instance (not dev mode):

```bash
# From the plugin directory, build first
npm run build

# Install from local path
openacp plugin add ./hello-world
```

### Plugin settings

If your plugin needs configuration (API keys, preferences), define a `settingsSchema` with Zod and use the `install()` hook:

```typescript
import { z } from 'zod'

const settingsSchema = z.object({
  defaultName: z.string().default('World'),
})

const plugin: OpenACPPlugin = {
  // ...
  settingsSchema,

  async install(ctx: InstallContext) {
    const name = await ctx.terminal.text({
      message: 'Default greeting name:',
      placeholder: 'World',
    })
    await ctx.settings.set('defaultName', name || 'World')
    ctx.terminal.log.success('Configured!')
  },

  async setup(ctx: PluginContext) {
    const defaultName = ctx.pluginConfig.defaultName ?? 'World'
    // Use defaultName in your command handler...
  },
}
```

### Enable / disable

```bash
openacp plugin enable @myorg/hello-world
openacp plugin disable @myorg/hello-world
```

### Reconfigure

```bash
openacp plugin configure @myorg/hello-world
```

---

## Step 7: Publish

### Prepare for publishing

1. Update `version` in both `package.json` and `src/index.ts`
2. Make sure `main` points to `dist/index.js`
3. Ensure `keywords` includes `openacp` and `openacp-plugin`

### Build and publish

```bash
npm run build
npm test
npm publish --access public
```

### How users install your plugin

```bash
openacp plugin install @myorg/hello-world
```

This downloads from npm into `~/.openacp/plugins/`, validates the plugin interface, and runs `install()` if defined.

### List your plugin in the registry

After publishing to npm, add your plugin to the [OpenACP Plugin Registry](https://github.com/Open-ACP/plugin-registry) so users can discover it via `openacp plugin search`:

1. Fork [Open-ACP/plugin-registry](https://github.com/Open-ACP/plugin-registry)
2. Create `plugins/myorg--hello-world.json` with your plugin metadata
3. Submit a PR — CI auto-validates and auto-merges

See [Contributing > Publishing a Plugin to the Registry](contributing.md#publishing-a-plugin-to-the-registry) for the full guide.

---

## Next Steps

- [Writing Plugins](../architecture/writing-plugins.md) -- full reference for all plugin APIs (services, middleware, events, storage)
- [Plugin SDK Reference](plugin-sdk-reference.md) -- complete API reference for types, base classes, and testing utilities
- [Dev Mode](dev-mode.md) -- detailed guide for the development workflow
- [Plugin System](plugin-system.md) -- how the plugin infrastructure works under the hood
