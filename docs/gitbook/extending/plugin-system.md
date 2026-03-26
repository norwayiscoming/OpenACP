# Plugin System

## What Are Plugins?

Plugins are standard npm packages that add channel adapters to OpenACP. A plugin exports an `AdapterFactory` object, which OpenACP uses to instantiate and register your adapter at startup. Installing a plugin does not require modifying the OpenACP source code or rebuilding anything — the CLI handles discovery, installation, and loading automatically.

Examples of what a plugin might add:
- A Discord adapter (`@openacp/adapter-discord`)
- A Slack adapter (`@openacp/adapter-slack`)
- An internal chat platform connector

---

## Plugin Directory

All plugins are installed into a dedicated local directory:

```
~/.openacp/plugins/
```

This directory contains its own `package.json` so npm can manage plugin dependencies independently of your global Node environment. OpenACP creates this directory automatically the first time you install a plugin.

---

## Installing a Plugin

```bash
openacp install <package-name>
```

Example:

```bash
openacp install @openacp/adapter-discord
```

Under the hood, this runs `npm install <package-name> --prefix ~/.openacp/plugins/`. The plugin is immediately available on the next startup.

---

## Listing Installed Plugins

```bash
openacp plugins
```

This reads the `dependencies` field from `~/.openacp/plugins/package.json` and prints each installed package name and version.

---

## Uninstalling a Plugin

```bash
openacp uninstall <package-name>
```

Example:

```bash
openacp uninstall @openacp/adapter-discord
```

This runs `npm uninstall <package-name> --prefix ~/.openacp/plugins/` and removes the entry from the plugins `package.json`.

---

## How Plugins Are Loaded

At startup, OpenACP reads the `dependencies` map from `~/.openacp/plugins/package.json`. For each listed package, it calls `loadAdapterFactory(packageName)`:

1. Resolves the package path using a `require` rooted in the plugins directory.
2. Dynamically `import()`s the resolved module.
3. Looks for an `adapterFactory` named export, falling back to the `default` export.
4. Validates that the export has a `createAdapter` function.
5. If valid, registers the factory so the adapter can be used by `OpenACPCore`.

If a plugin fails to load (missing file, invalid export), OpenACP logs an error and continues — a broken plugin does not prevent other adapters from starting.

---

## Package Requirements

A valid plugin package must:

1. Export a named `adapterFactory` (or a `default` export) that conforms to the `AdapterFactory` interface:

```typescript
import type { AdapterFactory } from '@openacp/cli'

export const adapterFactory: AdapterFactory = {
  name: 'my-platform',
  createAdapter(core, config) {
    return new MyPlatformAdapter(core, config)
  },
}
```

2. The `createAdapter` function receives:
   - `core: OpenACPCore` — the running core instance
   - `config: ChannelConfig` — the adapter's config block from `~/.openacp/config.json`

3. It must return a `ChannelAdapter` instance (see [Building Adapters](building-adapters.md)).

---

## Minimal Plugin `package.json`

```json
{
  "name": "@openacp/adapter-myplatform",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "exports": {
    ".": "./dist/index.js"
  },
  "peerDependencies": {
    "openacp": ">=0.6.0"
  }
}
```

---

## Example Plugin Structure

```
@openacp/adapter-myplatform/
  src/
    index.ts          ← exports adapterFactory
    adapter.ts        ← MyPlatformAdapter class
    formatting.ts     ← message formatting helpers
  dist/               ← compiled output
  package.json
  tsconfig.json
```

`src/index.ts`:

```typescript
import type { AdapterFactory } from 'openacp'
import { MyPlatformAdapter } from './adapter.js'

export const adapterFactory: AdapterFactory = {
  name: 'myplatform',
  createAdapter(core, config) {
    return new MyPlatformAdapter(core, config)
  },
}
```
