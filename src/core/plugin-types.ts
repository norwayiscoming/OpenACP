import type { z } from "zod";
import type { OpenACPCore } from "./core.js";
import type { Session } from "./session.js";
import type { SessionManager } from "./session-manager.js";
import type { ChannelAdapter } from "./channel.js";
import type { ConfigManager } from "./config.js";
import type { EventBus } from "./event-bus.js";
import type { AgentCatalog } from "./agent-catalog.js";
import type { Logger } from "./log.js";
import type { Attachment } from "./types.js";

// --- Plugin Contract ---

export interface CorePlugin {
  /** Unique plugin name — used for dependency resolution & config namespace */
  name: string;

  /** Semver version string */
  version: string;

  /** Plugin names this plugin depends on (loaded in dependency order) */
  dependencies?: string[];

  /** Zod schema for plugin-specific config — validated under config.<name> */
  configSchema?: z.ZodTypeAny;

  /** Slash commands this plugin provides (generic, adapter-agnostic) */
  commands?: PluginCommand[];

  /** Adapter-specific command handlers keyed by adapter name */
  adapterCommands?: Record<string, PluginAdapterCommand[]>;

  /** Declarative session lifecycle hooks — core dispatches these */
  sessionHooks?: PluginSessionHooks;

  /** Called once during startup — after dependencies loaded, before adapters start */
  register(api: PluginAPI): Promise<void>;

  /** Called during shutdown — cleanup resources */
  unregister?(): Promise<void>;
}

// --- Session Hooks ---

export interface PluginSessionHooks {
  onSessionCreated?(session: Session, context: PluginContext): void | Promise<void>;
  onSessionResumed?(session: Session, record: SessionRecord, context: PluginContext): void | Promise<void>;
  onBeforePrompt?(session: Session, payload: PromptPayload, context: PluginContext): PromptPayload | Promise<PromptPayload>;
  onAfterPrompt?(session: Session, context: PluginContext): void | Promise<void>;
  onSessionEnd?(session: Session, reason: string, context: PluginContext): void | Promise<void>;
}

export interface PromptPayload {
  text: string;
  attachments?: Attachment[];
}

export interface PluginContext {
  pluginName: string;
  log: Logger;
}

export interface SessionRecord {
  sessionId: string;
  agentSessionId?: string;
  agentName: string;
  channelId: string;
  workingDir: string;
  status: string;
  name?: string;
  [key: string]: unknown;
}

// --- Commands ---

export interface PluginCommand {
  name: string;
  description: string;
  usage?: string;
  handler(args: string, context: CommandContext): Promise<void>;
}

export interface PluginAdapterCommand {
  command: string;
  description?: string;
  handler: PluginAdapterCommandHandler;
}

export type PluginAdapterCommandHandler = (
  ctx: unknown,
  core: OpenACPCore,
  chatId: string,
) => Promise<void>;

// --- Command Context ---

export interface CommandContext {
  channelId: string;
  threadId: string;
  userId: string;
  adapter: ChannelAdapter;
  sessionManager: SessionManager;
}

// --- Plugin API ---

export interface PluginAPI {
  /** Access core instance (escape hatch — prefer specific APIs below) */
  core: OpenACPCore;

  /** Plugin's own validated config (parsed via configSchema) */
  config: unknown;

  /** Logger scoped to plugin name */
  log: Logger;

  /** Session manager — lookup sessions, patch records */
  sessionManager: SessionManager;

  /** Registered adapters (read-only) */
  adapters: ReadonlyMap<string, ChannelAdapter>;

  /** Config manager — listen to config changes */
  configManager: ConfigManager;

  /** Event bus — subscribe to system events */
  eventBus: EventBus;

  /** Create sessions (e.g. Cowork spawning agent sessions) */
  createSession: OpenACPCore["createSession"];

  /** Resolve workspace path */
  resolveWorkspace(path?: string): string;

  /** Agent catalog — lookup agent definitions */
  agentCatalog: AgentCatalog;
}
