# Built-in Plugins Reference

OpenACP ships with 11 built-in plugins. They live in `src/plugins/` and are loaded automatically on boot. Built-in plugins cannot be uninstalled, but they can be disabled.

---

## Adapter Plugins

### @openacp/telegram

Telegram messaging adapter using the grammY framework.

- **Service**: `adapter:telegram`
- **Dependencies**: `@openacp/security`, `@openacp/file-service`
- **Permissions**: `services:register`, `kernel:access`, `events:read`, `events:emit`, `commands:register`

**What it does**: Connects OpenACP to Telegram. Creates forum topics for sessions, renders agent output as HTML messages with inline keyboards, handles permission buttons, and supports voice messages.

**Settings** (`settings.json`):

| Key | Type | Description |
|-----|------|-------------|
| `botToken` | string | Telegram Bot Token from @BotFather |
| `chatId` | string | Supergroup Chat ID |
| `displayVerbosity` | `'low' \| 'medium' \| 'high'` | How much agent output to show |

**Commands**: `/verbosity`, `/archive` (adapter-specific), plus overrides for `/new`, `/resume`, `/settings` with multi-step wizards.

---

### @openacp/discord

Discord messaging adapter using discord.js.

- **Service**: `adapter:discord`
- **Dependencies**: `@openacp/security`, `@openacp/file-service`
- **Permissions**: `services:register`, `kernel:access`, `events:read`, `events:emit`, `commands:register`

**What it does**: Connects OpenACP to Discord. Creates threads for sessions, renders output with embeds and markdown, registers slash commands, and supports file uploads.

**Settings**:

| Key | Type | Description |
|-----|------|-------------|
| `botToken` | string | Discord Bot Token |
| `guildId` | string | Discord Server ID |
| `displayVerbosity` | `'low' \| 'medium' \| 'high'` | How much agent output to show |

**Commands**: `/verbosity` (adapter-specific).

---

### @openacp/slack

Slack messaging adapter using @slack/bolt.

- **Service**: `adapter:slack`
- **Dependencies**: `@openacp/security`, `@openacp/file-service`
- **Permissions**: `services:register`, `kernel:access`, `events:read`, `events:emit`, `commands:register`

**What it does**: Connects OpenACP to Slack via Socket Mode. Creates channels/threads for sessions, renders output with Block Kit, and handles interactive components.

**Settings**:

| Key | Type | Description |
|-----|------|-------------|
| `botToken` | string | Slack Bot Token |
| `appToken` | string | Slack App-Level Token (for Socket Mode) |
| `signingSecret` | string | Slack Signing Secret |

---

## Service Plugins

### @openacp/security

Access control and rate limiting.

- **Service**: `security` (implements `SecurityService`)
- **Dependencies**: none
- **Permissions**: `services:register`, `events:read`, `middleware:register`

**What it does**: Checks if users are allowed to interact with OpenACP (`allowedUserIds`), enforces session limits (`maxConcurrentSessions`), and provides user role management.

**Service interface**:

```typescript
interface SecurityService {
  checkAccess(userId: string): Promise<{ allowed: boolean; reason?: string }>
  checkSessionLimit(userId: string): Promise<{ allowed: boolean; reason?: string }>
  getUserRole(userId: string): Promise<'admin' | 'user' | 'blocked'>
}
```

**Commands**: `/dangerous on|off` -- toggle auto-approve mode for all permissions.

**Config**: Uses core `config.json` security section (`allowedUserIds`, `maxConcurrentSessions`).

---

### @openacp/file-service

File I/O for agent operations.

- **Service**: `file-service` (implements `FileServiceInterface`)
- **Dependencies**: none
- **Permissions**: `services:register`, `middleware:register`

**What it does**: Handles file operations that agents request -- saving attachments, resolving file paths, reading file contents with line ranges, and audio format conversion (OGG to WAV for speech).

**Service interface**:

```typescript
interface FileServiceInterface {
  saveFile(sessionId: string, fileName: string, data: Buffer, mimeType: string): Promise<Attachment>
  resolveFile(filePath: string): Promise<Attachment | null>
  readTextFileWithRange(path: string, opts?: { line?: number; limit?: number }): Promise<string>
  convertOggToWav(oggData: Buffer): Promise<Buffer>
}
```

---

### @openacp/speech

Text-to-speech and speech-to-text with pluggable providers.

- **Service**: `speech` (implements `SpeechServiceInterface`)
- **Dependencies**: `@openacp/file-service`
- **Optional dependencies**: none
- **Permissions**: `services:register`, `services:use`, `commands:register`

**What it does**: Provides TTS (text-to-speech) and STT (speech-to-text) capabilities. Ships with two built-in providers: Edge TTS and Groq STT. Community plugins can add more providers via `registerTTSProvider()` / `registerSTTProvider()`.

**Service interface**:

```typescript
interface SpeechServiceInterface {
  textToSpeech(text: string, opts?: { language?: string; voice?: string }): Promise<Buffer>
  speechToText(audio: Buffer, opts?: { language?: string }): Promise<string>
  registerTTSProvider(name: string, provider: TTSProvider): void
  registerSTTProvider(name: string, provider: STTProvider): void
}
```

**Settings**:

| Key | Type | Description |
|-----|------|-------------|
| `stt.provider` | string | STT provider name (default: `'groq'`) |
| `tts.provider` | string | TTS provider name (default: `'edge-tts'`) |

**Commands**: `/tts on|off` -- toggle text-to-speech for the current session.

**Extension point**: Community plugins can add providers:
```typescript
// @community/speech-elevenlabs setup()
const speech = ctx.getService<SpeechServiceInterface>('speech')
speech.registerTTSProvider('elevenlabs', new ElevenLabsTTS())
```

---

### @openacp/tunnel

Expose local ports publicly via tunnel providers.

- **Service**: `tunnel` (implements `TunnelServiceInterface`)
- **Dependencies**: none
- **Permissions**: `services:register`, `commands:register`

**What it does**: Creates public URLs for local development servers. Useful when agents need to preview web applications they're building. Ships with providers: Cloudflare Tunnel, ngrok, bore, tailscale.

**Service interface**:

```typescript
interface TunnelServiceInterface {
  getPublicUrl(): string | undefined
  isConnected(): boolean
  start(): Promise<string>   // returns public URL
  stop(): Promise<void>
}
```

**Settings**:

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable tunnel on startup |
| `provider` | string | Tunnel provider (`'cloudflare'`, `'ngrok'`, `'bore'`, `'tailscale'`) |

**Commands**: `/tunnel start|stop|status`, `/tunnels` -- manage and list tunnels.

---

### @openacp/usage

Cost tracking and budget management.

- **Service**: `usage` (implements `UsageService`)
- **Dependencies**: none
- **Permissions**: `services:register`, `events:read`, `commands:register`, `storage:read`, `storage:write`

**What it does**: Tracks API usage costs per session and month. Enforces monthly budgets and sends warnings when approaching limits.

**Service interface**:

```typescript
interface UsageService {
  trackUsage(record: UsageRecord): Promise<void>
  checkBudget(sessionId: string): Promise<{ ok: boolean; percent: number; warning?: string }>
  getSummary(period: string): Promise<UsageSummary>
}
```

**Settings**:

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable usage tracking |
| `monthlyBudget` | number | Monthly budget in USD |

**Commands**: `/usage` -- view usage summary and budget status.

---

### @openacp/notifications

Cross-session notification delivery.

- **Service**: `notifications` (implements `NotificationService`)
- **Dependencies**: none
- **Permissions**: `services:register`, `events:read`

**What it does**: Delivers notifications across sessions. When a session completes, errors, or hits a budget warning, notifications are sent to dedicated notification channels/topics on all active adapters.

**Service interface**:

```typescript
interface NotificationService {
  notify(channelId: string, notification: NotificationMessage): Promise<void>
  notifyAll(notification: NotificationMessage): Promise<void>
}
```

---

### @openacp/context

Conversation history and session resume.

- **Service**: `context` (implements `ContextService`)
- **Dependencies**: none
- **Permissions**: `services:register`, `events:read`, `storage:read`, `storage:write`

**What it does**: Stores conversation context and enables session resume. When resuming a session, builds a context summary that can be injected into the new agent's initial prompt. Supports pluggable context providers.

**Service interface**:

```typescript
interface ContextService {
  buildContext(sessionId: string, opts?: { maxTokens?: number }): Promise<string>
  registerProvider(provider: ContextProvider): void
}
```

---

### @openacp/api-server

REST API and Server-Sent Events for external integrations.

- **Service**: `api-server`
- **Dependencies**: `@openacp/security`
- **Permissions**: `services:register`, `kernel:access`, `events:read`

**What it does**: Exposes a REST API for managing sessions, sending prompts, and streaming agent events via SSE. Enables future Web UI integration. Also exposes plugin management endpoints.

**Settings**:

| Key | Type | Description |
|-----|------|-------------|
| `port` | number | HTTP port (default: `21420`) |

**API endpoints**:

| Endpoint | Description |
|----------|-------------|
| `GET /api/plugins` | List all plugins |
| `GET /api/plugins/:name` | Plugin details + settings |
| `PUT /api/plugins/:name/settings` | Update plugin settings |
| `POST /api/plugins/:name/enable` | Enable a plugin |
| `POST /api/plugins/:name/disable` | Disable a plugin |
| `GET /api/config` | Core config |
| `PUT /api/config` | Update core config |

---

## Plugin Dependency Graph

```
@openacp/security          (no deps)
@openacp/file-service      (no deps)
@openacp/notifications     (no deps)
@openacp/context           (no deps)
@openacp/usage             (no deps)
@openacp/tunnel            (no deps)
@openacp/speech            -> @openacp/file-service
@openacp/api-server        -> @openacp/security
@openacp/telegram          -> @openacp/security, @openacp/file-service
@openacp/discord           -> @openacp/security, @openacp/file-service
@openacp/slack             -> @openacp/security, @openacp/file-service
```

Plugins at the top (no deps) load first. Adapter plugins load last since they depend on services being available.

---

## Further Reading

- [Architecture Overview](README.md) -- high-level picture
- [Plugin System](plugin-system.md) -- how plugins work
- [Writing Plugins](writing-plugins.md) -- build your own
- [Command System](command-system.md) -- how commands are registered and dispatched
