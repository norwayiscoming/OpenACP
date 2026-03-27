export { MessagingAdapter, type AdapterContext, type MessagingAdapterConfig, type SentMessage } from './messaging-adapter.js'
export { StreamAdapter, type StreamEvent } from './stream-adapter.js'
export { type IRenderer, BaseRenderer, type RenderedMessage, type RenderedPermission, type RenderedAction } from './rendering/index.js'
export { SendQueue, DraftManager, Draft, ToolCallTracker, ActivityTracker } from './primitives/index.js'
export type { SendQueueConfig, DraftConfig, TrackedToolCall, ActivityConfig, ActivityCallbacks } from './primitives/index.js'

export type { DisplayVerbosity, ToolCallMeta, ToolUpdateMeta, FormattedMessage, MessageMetadata, ViewerLinks } from './format-types.js'
export { STATUS_ICONS, KIND_ICONS } from './format-types.js'
export { progressBar, formatTokens, truncateContent, stripCodeFences, splitMessage } from './format-utils.js'
export { extractContentText, formatToolSummary, formatToolTitle, resolveToolIcon } from './message-formatter.js'
// Note: runAdapterConformanceTests is exported from the separate './testing' entry
// point to avoid pulling vitest into the main runtime bundle.
