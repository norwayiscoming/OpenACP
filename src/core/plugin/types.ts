import type {
  OutgoingMessage,
  AgentEvent,
  PermissionRequest,
  Attachment,
  StopReason,
  SessionStatus,
  ConfigOption,
  NotificationMessage,
  UsageRecord,
} from '../types.js'
import type { IChannelAdapter } from '../channel.js'

// Re-export IChannelAdapter for plugin authors
export type { IChannelAdapter }

// ============================================================
// Section 2: Plugin Interface
// ============================================================

export type PluginPermission =
  | 'events:read'
  | 'events:emit'
  | 'services:register'
  | 'services:use'
  | 'middleware:register'
  | 'commands:register'
  | 'storage:read'
  | 'storage:write'
  | 'kernel:access'

export interface OpenACPPlugin {
  /** Unique identifier, e.g., '@openacp/security' */
  name: string
  /** Semver version */
  version: string
  /** Human-readable description */
  description?: string
  /** Required plugin dependencies — loaded before this plugin's setup() */
  pluginDependencies?: Record<string, string>
  /** Optional dependencies — used if available, gracefully degrade if not */
  optionalPluginDependencies?: Record<string, string>
  /** Override a built-in plugin (replaces it entirely) */
  overrides?: string
  /** Required permissions — PluginContext enforces these */
  permissions?: PluginPermission[]
  /** Called during startup in dependency order */
  setup(ctx: PluginContext): Promise<void>
  /** Called during shutdown in reverse order. 10s timeout. */
  teardown?(): Promise<void>
  install?(ctx: InstallContext): Promise<void>
  uninstall?(ctx: InstallContext, opts: { purge: boolean }): Promise<void>
  configure?(ctx: InstallContext): Promise<void>
  migrate?(ctx: MigrateContext, oldSettings: unknown, oldVersion: string): Promise<unknown>
  settingsSchema?: import('zod').ZodSchema
  essential?: boolean
  /** Settings keys that can be copied when creating a new instance from this one */
  inheritableKeys?: string[]
}

// ============================================================
// Section 3: PluginContext, PluginStorage, CommandDef
// ============================================================

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<string[]>
  getDataDir(): string
}

// ─── Settings API (per-plugin settings.json) ───

export interface SettingsAPI {
  get<T = unknown>(key: string): Promise<T | undefined>
  set<T = unknown>(key: string, value: T): Promise<void>
  getAll(): Promise<Record<string, unknown>>
  setAll(settings: Record<string, unknown>): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  has(key: string): Promise<boolean>
}

// ─── Terminal I/O (interactive CLI for plugins) ───

export interface TerminalIO {
  text(opts: {
    message: string
    placeholder?: string
    defaultValue?: string
    validate?: (value: string) => string | undefined
  }): Promise<string>

  select<T>(opts: {
    message: string
    options: { value: T; label: string; hint?: string }[]
  }): Promise<T>

  confirm(opts: {
    message: string
    initialValue?: boolean
  }): Promise<boolean>

  password(opts: {
    message: string
    validate?: (value: string) => string | undefined
  }): Promise<string>

  multiselect<T>(opts: {
    message: string
    options: { value: T; label: string; hint?: string }[]
    required?: boolean
  }): Promise<T[]>

  log: {
    info(message: string): void
    success(message: string): void
    warning(message: string): void
    error(message: string): void
    step(message: string): void
  }

  spinner(): {
    start(message: string): void
    stop(message?: string): void
    fail(message?: string): void
  }

  note(message: string, title?: string): void
  cancel(message?: string): void
}

// ─── Install Context (for install/configure/uninstall) ───

export interface InstallContext {
  pluginName: string
  terminal: TerminalIO
  settings: SettingsAPI
  legacyConfig?: Record<string, unknown>
  dataDir: string
  log: Logger
  /** Root of the OpenACP instance directory (e.g. ~/.openacp) */
  instanceRoot?: string
}

// ─── Migrate Context (for boot-time migration) ───

export interface MigrateContext {
  pluginName: string
  settings: SettingsAPI
  log: Logger
}

// ─── Command Response Types ───

export type CommandResponse =
  | { type: 'text'; text: string }
  | { type: 'menu'; title: string; options: MenuOption[] }
  | { type: 'list'; title: string; items: ListItem[] }
  | { type: 'confirm'; question: string; onYes: string; onNo: string }
  | { type: 'error'; message: string }
  | { type: 'silent' }
  | { type: 'delegated' }

// ─── Menu Types ───

export interface MenuItem {
  id: string
  label: string
  priority: number
  group?: string
  action:
    | { type: 'command'; command: string }
    | { type: 'delegate'; prompt: string }
    | { type: 'callback'; callbackData: string }
  visible?: () => boolean
}

export interface MenuOption {
  label: string
  command: string
  hint?: string
}

export interface ListItem {
  label: string
  detail?: string
}

export interface CommandArgs {
  /** Raw argument string after command name */
  raw: string
  /** Parsed key/value options (e.g., --flag value) */
  options?: Record<string, string>
  /** Session ID where command was invoked (null if from notification/system topic) */
  sessionId: string | null
  /** Channel ID ('telegram', 'discord', 'slack') */
  channelId: string
  /** User ID who invoked the command */
  userId: string
  /** Reply helper — sends message to the topic where command was invoked */
  reply(content: string | CommandResponse | OutgoingMessage): Promise<void>
  /** Direct access to OpenACPCore instance. Available when 'kernel:access' permission is granted. */
  coreAccess?: CoreAccess
}

export interface CommandDef {
  /** Command name without slash, e.g., 'context' for /context */
  name: string
  /** Short description shown in command list */
  description: string
  /** Usage pattern, e.g., '<session-number>' */
  usage?: string
  /** Whether this is a built-in system command or registered by a plugin */
  category: 'system' | 'plugin'
  /** Plugin that registered this command (set automatically by plugin manager) */
  pluginName?: string
  /** Handler function */
  handler(args: CommandArgs): Promise<CommandResponse | void>
}

// Forward declarations for kernel types used in PluginContext.
// These are structural types to avoid circular imports.
export interface SessionManager {
  [key: string]: unknown
}

export interface ConfigManager {
  [key: string]: unknown
}

export interface EventBus {
  [key: string]: unknown
}

/**
 * Typed view of the OpenACPCore instance exposed to plugins via ctx.core.
 * Plugins that need kernel:access should cast ctx.core to this interface
 * instead of using `as any`. Only includes fields plugins actually need.
 */
export interface CoreAccess {
  configManager: ConfigManager
  sessionManager: SessionManager
  adapters: Map<string, IChannelAdapter>
}

export interface Logger {
  trace(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  fatal(msg: string, ...args: unknown[]): void
  child(bindings: Record<string, unknown>): Logger
}

export interface PluginContext {
  // === Identity ===
  pluginName: string
  pluginConfig: Record<string, unknown>

  // === Tier 1 — Events ===
  /** Subscribe to events. Auto-cleaned on teardown. Requires 'events:read'. */
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
  /** Emit custom events. Event names MUST be prefixed with plugin name. Requires 'events:emit'. */
  emit(event: string, payload: unknown): void

  // === Tier 2 — Actions ===
  /** Register middleware. Requires 'middleware:register'. */
  registerMiddleware<H extends MiddlewareHook>(hook: H, opts: MiddlewareOptions<MiddlewarePayloadMap[H]>): void
  /** Provide a service. Requires 'services:register'. */
  registerService<T>(name: string, implementation: T): void
  /** Consume a service. Requires 'services:use'. */
  getService<T>(name: string): T | undefined
  /** Register slash command. Requires 'commands:register'. */
  registerCommand(def: CommandDef): void
  /** Register a menu item. Requires 'commands:register'. */
  registerMenuItem(item: MenuItem): void
  /** Unregister a menu item by id. Requires 'commands:register'. */
  unregisterMenuItem(id: string): void
  /** Register an assistant section. Requires 'commands:register'. */
  registerAssistantSection(section: import('../assistant/assistant-registry.js').AssistantSection): void
  /** Unregister an assistant section by id. Requires 'commands:register'. */
  unregisterAssistantSection(id: string): void
  /** Plugin-scoped storage. Requires 'storage:read' and/or 'storage:write'. */
  storage: PluginStorage
  /** Plugin-scoped logger. Always available (no permission needed). */
  log: Logger
  /**
   * Send message to a session. Requires 'services:use'.
   *
   * Routing: sessionId → lookup session → find adapter for session's channelId
   *          → [HOOK: message:outgoing] → adapter.sendMessage()
   */
  sendMessage(sessionId: string, content: OutgoingMessage): Promise<void>

  // === Tier 3 — Kernel access (requires 'kernel:access') ===
  sessions: SessionManager
  config: ConfigManager
  eventBus: EventBus
  /** Direct access to OpenACPCore instance. Requires 'kernel:access'. */
  core: unknown

  /**
   * Root directory for this OpenACP instance (default: ~/.openacp).
   * Plugins should derive file paths from this instead of hardcoding ~/.openacp.
   */
  instanceRoot: string
}

// ============================================================
// Section 4: Middleware System
// ============================================================

export interface MiddlewarePayloadMap {
  // === Message flow ===
  'message:incoming': {
    channelId: string
    threadId: string
    userId: string
    text: string
    attachments?: Attachment[]
  }
  'message:outgoing': {
    sessionId: string
    message: OutgoingMessage
  }

  // === Agent flow ===
  'agent:beforePrompt': {
    sessionId: string
    text: string
    attachments?: Attachment[]
  }
  'agent:beforeEvent': {
    sessionId: string
    event: AgentEvent
  }
  'agent:afterEvent': {
    sessionId: string
    event: AgentEvent
    outgoingMessage: OutgoingMessage
  }

  // === Turn lifecycle ===
  'turn:start': {
    sessionId: string
    promptText: string
    promptNumber: number
  }
  'turn:end': {
    sessionId: string
    stopReason: StopReason
    durationMs: number
  }

  // === File system ===
  'fs:beforeRead': {
    sessionId: string
    path: string
    line?: number
    limit?: number
  }
  'fs:beforeWrite': {
    sessionId: string
    path: string
    content: string
  }

  // === Terminal ===
  'terminal:beforeCreate': {
    sessionId: string
    command: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
  }
  'terminal:afterExit': {
    sessionId: string
    terminalId: string
    command: string
    exitCode: number
    durationMs: number
  }

  // === Permission ===
  'permission:beforeRequest': {
    sessionId: string
    request: PermissionRequest
    autoResolve?: string
  }
  'permission:afterResolve': {
    sessionId: string
    requestId: string
    decision: string
    userId: string
    durationMs: number
  }

  // === Session ===
  'session:beforeCreate': {
    agentName: string
    workingDir: string
    userId: string
    channelId: string
    threadId: string
  }
  'session:afterDestroy': {
    sessionId: string
    reason: string
    durationMs: number
    promptCount: number
  }

  // === Control ===
  'config:beforeChange': {
    sessionId: string
    configId: string
    oldValue: unknown
    newValue: unknown
  }
  'agent:beforeCancel': {
    sessionId: string
    reason?: string
  }

  // === Agent switch ===
  'agent:beforeSwitch': {
    sessionId: string
    fromAgent: string
    toAgent: string
  }
  'agent:afterSwitch': {
    sessionId: string
    fromAgent: string
    toAgent: string
    resumed: boolean
  }
}

export type MiddlewareHook = keyof MiddlewarePayloadMap

export type MiddlewareFn<T> = (payload: T, next: () => Promise<T>) => Promise<T | null>

export interface MiddlewareOptions<T> {
  /** Override execution order within same dependency level. Lower = earlier. */
  priority?: number
  /** The middleware handler */
  handler: MiddlewareFn<T>
}

// ============================================================
// Section 8: Plugin Events
// ============================================================

export interface PluginEventMap {
  // System lifecycle
  'kernel:booted': Record<string, never>
  'system:ready': Record<string, never>
  'system:shutdown': Record<string, never>
  'system:commands-ready': { commands: CommandDef[] }

  // Plugin lifecycle
  'plugin:loaded': { name: string; version: string }
  'plugin:failed': { name: string; error: string }
  'plugin:disabled': { name: string; reason: string }
  'plugin:unloaded': { name: string }

  // Session lifecycle
  'session:created': { sessionId: string; agentName: string; userId: string; channelId: string; workingDir: string }
  'session:ended': { sessionId: string; reason: string }
  'session:named': { sessionId: string; name: string }
  'session:updated': { sessionId: string; status: SessionStatus }

  // Agent events
  'agent:event': { sessionId: string; event: AgentEvent }
  'agent:prompt': { sessionId: string; text: string; attachments?: Attachment[] }

  // Permission events
  'permission:request': { sessionId: string; request: PermissionRequest }
  'permission:resolved': { sessionId: string; requestId: string; decision: string }

  // Custom events (plugins emit with their name prefix)
  [key: `${string}:${string}`]: unknown
}

// ============================================================
// Section 6: Service Contract Interfaces
// ============================================================

export interface SecurityService {
  checkAccess(userId: string): Promise<{ allowed: boolean; reason?: string }>
  checkSessionLimit(userId: string): Promise<{ allowed: boolean; reason?: string }>
  getUserRole(userId: string): Promise<'admin' | 'user' | 'blocked'>
}

export interface FileServiceInterface {
  saveFile(sessionId: string, fileName: string, data: Buffer, mimeType: string): Promise<Attachment>
  resolveFile(filePath: string): Promise<Attachment | null>
  readTextFileWithRange(path: string, opts?: { line?: number; limit?: number }): Promise<string>
  extensionFromMime(mimeType: string): string
  convertOggToWav(oggData: Buffer): Promise<Buffer>
}

export interface NotificationService {
  notify(channelId: string, notification: NotificationMessage): Promise<void>
  notifyAll(notification: NotificationMessage): Promise<void>
}

export interface UsageService {
  trackUsage(record: UsageRecord): Promise<void>
  checkBudget(sessionId: string): Promise<{ ok: boolean; percent: number; warning?: string }>
}

export interface TTSProvider {
  synthesize(text: string, opts?: { language?: string; voice?: string }): Promise<Buffer>
}

export interface STTProvider {
  transcribe(audio: Buffer, opts?: { language?: string }): Promise<string>
}

export interface SpeechServiceInterface {
  textToSpeech(text: string, opts?: { language?: string; voice?: string }): Promise<Buffer>
  speechToText(audio: Buffer, opts?: { language?: string }): Promise<string>
  registerTTSProvider(name: string, provider: TTSProvider): void
  registerSTTProvider(name: string, provider: STTProvider): void
}

export interface ContextProvider {
  provide(sessionId: string, opts?: { maxTokens?: number }): Promise<string>
}

export interface ContextService {
  buildContext(sessionId: string, opts?: { maxTokens?: number }): Promise<string>
  registerProvider(provider: ContextProvider): void
}

export interface ViewerStoreInterface {
  storeFile(sessionId: string, filePath: string, content: string, workingDirectory: string): string | null
  storeDiff(sessionId: string, filePath: string, oldContent: string, newContent: string, workingDirectory: string): string | null
  storeOutput(sessionId: string, label: string, output: string): string | null
}

export interface TunnelServiceInterface {
  getPublicUrl(): string
  start(apiPort: number): Promise<string>
  stop(): Promise<void>
  getStore(): ViewerStoreInterface
  fileUrl(entryId: string): string
  diffUrl(entryId: string): string
  outputUrl(entryId: string): string
}

// Re-export types needed by plugin authors from types.ts
export type {
  OutgoingMessage,
  AgentEvent,
  PermissionRequest,
  Attachment,
  StopReason,
  SessionStatus,
  ConfigOption,
  NotificationMessage,
  UsageRecord,
}
