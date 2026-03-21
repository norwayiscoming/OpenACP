# Phase 1 — Project Structure

## Monorepo Layout

```
openacp/
  package.json                → pnpm workspace root
  pnpm-workspace.yaml         → workspace config
  tsconfig.base.json          → shared TypeScript config
  packages/
    core/
      package.json            → @openacp/core
      tsconfig.json
      src/
        index.ts              → Export all public APIs
        main.ts               → CLI entry point (foreground process)
        core.ts               → OpenACPCore orchestrator
        config.ts             → ConfigManager + Zod schemas
        session.ts            → SessionManager + Session class
        agent.ts              → AgentManager + AgentInstance
        notification.ts       → NotificationManager
        channel.ts            → ChannelAdapter abstract class
        types.ts              → All shared types/interfaces
        formatting.ts         → Markdown utilities
        workspace.ts          → Workspace resolution logic
    adapters/
      telegram/
        package.json          → @openacp/adapter-telegram
        tsconfig.json
        src/
          index.ts            → TelegramAdapter export
          adapter.ts          → TelegramAdapter extends ChannelAdapter
          bot.ts              → grammy bot setup, message routing
          commands.ts         → /new, /newchat, /cancel, /status, /agents, /help
          formatting.ts       → Markdown → Telegram HTML
          topics.ts           → Topic create/rename/notification management
          streaming.ts        → MessageDraft + Throttle for real-time streaming
          assistant.ts        → Assistant topic handler
          types.ts            → Telegram-specific types
```

## Data Directory

```
~/.openacp/
  config.json                → Main configuration file
  data/
    workspaces/              → Default workspace base directory
      my-app/                → Created by /new claude my-app
      api-server/            → Created by /new codex api-server
    sessions/                → Session persistence (Phase 3)
  logs/                      → Log files (optional, Phase 1 logs to stdout)
```

## pnpm Workspace Config

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/core"
  - "packages/adapters/*"
```

## Package Dependencies

### @openacp/core
```json
{
  "name": "@openacp/core",
  "dependencies": {
    "@agentclientprotocol/sdk": "^0.16.0",
    "zod": "^3.25.0",
    "nanoid": "^5.0.0"
  }
}
```

### @openacp/adapter-telegram
```json
{
  "name": "@openacp/adapter-telegram",
  "dependencies": {
    "@openacp/core": "workspace:*",
    "grammy": "^1.30.0"
  }
}
```

## Entry Point

```typescript
// packages/core/src/main.ts
// Run as: npx openacp  OR  node dist/main.js
// Foreground process, Ctrl+C to stop

async function main() {
  const configManager = new ConfigManager()
  await configManager.load()

  const core = new OpenACPCore(configManager)

  // Register enabled adapters
  if (configManager.get().channels.telegram?.enabled) {
    const { TelegramAdapter } = await import('@openacp/adapter-telegram')
    core.registerAdapter('telegram', new TelegramAdapter(core, configManager.get().channels.telegram))
  }

  await core.start()

  // Graceful shutdown
  const shutdown = async () => {
    await core.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
```

## TypeScript Config

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```
