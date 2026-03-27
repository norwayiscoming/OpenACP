// ============================================================
// @openacp/plugin-sdk — main entry point
//
// Sub-path imports available:
//   @openacp/plugin-sdk/formatting — format utils, icons
//   @openacp/plugin-sdk/config     — config utils, doctor engine
//   @openacp/plugin-sdk/testing    — test helpers, conformance tests
// ============================================================

// --- Plugin interfaces ---
export type {
  OpenACPPlugin, PluginContext, PluginPermission, PluginStorage,
  InstallContext, MigrateContext, TerminalIO, SettingsAPI,
} from '@openacp/cli'

// --- Command types ---
export type {
  CommandDef, CommandArgs, CommandResponse, MenuOption, ListItem,
} from '@openacp/cli'

// --- Service interfaces ---
export type {
  SecurityService, FileServiceInterface, NotificationService,
  UsageService, SpeechServiceInterface, TunnelServiceInterface, ContextService,
} from '@openacp/cli'

// --- Adapter types ---
export type {
  IChannelAdapter, AdapterCapabilities, OutgoingMessage, PermissionRequest,
  PermissionOption, NotificationMessage, AgentCommand,
  MessagingAdapterConfig, IRenderer, RenderedMessage,
} from '@openacp/cli'

// --- Adapter base classes (runtime) ---
export { MessagingAdapter, StreamAdapter, BaseRenderer } from '@openacp/cli'

// --- Adapter primitives (runtime) ---
export { SendQueue, DraftManager, ToolCallTracker, ActivityTracker } from '@openacp/cli'

// --- Core types ---
export type {
  OpenACPCore, Session, SessionEvents, SessionManager, CommandRegistry,
  Attachment, PlanEntry, StopReason, SessionStatus, ConfigOption,
  UsageRecord, InstallProgress,
  DisplayVerbosity, ToolCallMeta, ToolUpdateMeta, ViewerLinks,
  TelegramPlatformData,
} from '@openacp/cli'

// --- Logging (runtime) ---
export { log, createChildLogger } from '@openacp/cli'

// --- Data (runtime) ---
export { PRODUCT_GUIDE } from '@openacp/cli'

// --- Sub-path re-exports (types only — use sub-path imports for values) ---
export type { ConfigFieldDef, DoctorReport, PendingFix } from './config.js'
