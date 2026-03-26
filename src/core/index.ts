export * from "./types.js";
export {
  log,
  initLogger,
  createChildLogger,
  createSessionLogger,
  shutdownLogger,
  cleanupOldSessionLogs,
  setLogLevel,
  type Logger,
} from "./utils/log.js";
export {
  ChannelAdapter,
  type IChannelAdapter,
  type AdapterCapabilities,
  type ChannelConfig,
} from "./channel.js";
export { NotificationManager } from "../plugins/notifications/notification.js";
export { nodeToWebWritable, nodeToWebReadable } from "./utils/streams.js";
export { StderrCapture } from "./utils/stderr-capture.js";
export {
  ConfigManager,
  expandHome,
  type Config,
  type LoggingConfig,
  type UsageConfig,
  PLUGINS_DIR,
} from "./config/config.js";
export { AgentInstance } from "./agents/agent-instance.js";
export { AgentManager } from "./agents/agent-manager.js";
export { Session, type SessionEvents } from "./sessions/session.js";
export { TypedEmitter } from "./utils/typed-emitter.js";
export { PromptQueue } from "./sessions/prompt-queue.js";
export { PermissionGate } from "./sessions/permission-gate.js";
export { MessageTransformer } from "./message-transformer.js";
export { FileService } from "../plugins/file-service/file-service.js";
export { SessionManager } from "./sessions/session-manager.js";
export { SecurityGuard } from "../plugins/security/security-guard.js";
export { SessionBridge, type BridgeDeps } from "./sessions/session-bridge.js";
export {
  SessionFactory,
  type SessionCreateParams,
  type SideEffectDeps,
} from "./sessions/session-factory.js";
export { OpenACPCore } from "./core.js";
export { UsageStore } from "../plugins/usage/usage-store.js";
export { UsageBudget } from "../plugins/usage/usage-budget.js";
export {
  AdapterFactory,
  installPlugin,
  uninstallPlugin,
  listPlugins,
  loadAdapterFactory,
} from "./plugin-manager.js";
export { startDaemon, stopDaemon, getStatus, getPidPath } from "../cli/daemon.js";
export {
  installAutoStart,
  uninstallAutoStart,
  isAutoStartInstalled,
  isAutoStartSupported,
} from "../cli/autostart.js";
export { runConfigEditor } from "./config/config-editor.js";
export { ApiServer, type ApiConfig } from "../plugins/api-server/api-server.js";
export { SSEManager } from "../plugins/api-server/sse-manager.js";
export { StaticServer } from "../plugins/api-server/static-server.js";
export { EventBus, type EventBusEvents } from "./event-bus.js";
export {
  TopicManager,
  type TopicInfo,
  type DeleteTopicResult,
  type CleanupResult,
} from "./topic-manager.js";
export {
  CONFIG_REGISTRY,
  getFieldDef,
  getSafeFields,
  isHotReloadable,
  resolveOptions,
  getConfigValue,
  type ConfigFieldDef,
} from "./config/config-registry.js";
export { SpeechService, GroqSTT } from "../plugins/speech/exports.js";
export type {
  STTProvider,
  TTSProvider,
  STTOptions,
  STTResult,
  TTSOptions,
  TTSResult,
  SpeechServiceConfig,
  SpeechProviderConfig,
} from "../plugins/speech/exports.js";
export type { ContextProvider, ContextQuery, ContextOptions, ContextResult, SessionInfo as ContextSessionInfo, SessionListResult } from "../plugins/context/context-provider.js";
export { ContextManager } from "../plugins/context/context-manager.js";
export { EntireProvider } from "../plugins/context/entire/entire-provider.js";
