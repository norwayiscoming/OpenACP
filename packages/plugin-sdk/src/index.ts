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
  IChannelAdapter, OutgoingMessage, PermissionRequest,
  PermissionOption, NotificationMessage, AgentCommand,
} from '@openacp/cli'

// Adapter base classes
export { MessagingAdapter, StreamAdapter, BaseRenderer } from '@openacp/cli'

// Adapter primitives
export { SendQueue, DraftManager, ToolCallTracker, ActivityTracker } from '@openacp/cli'
