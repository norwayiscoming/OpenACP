import type { OutputMode } from "./adapter-primitives/format-types.js";

export interface Attachment {
  type: 'image' | 'audio' | 'file';
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  originalFilePath?: string;
}

export interface IncomingMessage {
  channelId: string;
  threadId: string;
  userId: string;
  text: string;
  attachments?: Attachment[];
}

export interface OutgoingMessage {
  type:
    | "text"
    | "thought"
    | "tool_call"
    | "tool_update"
    | "plan"
    | "usage"
    | "session_end"
    | "error"
    | "attachment"
    | "system_message"
    // ACP Phase 2 additions
    | "mode_change"
    | "config_update"
    | "model_update"
    | "user_replay"
    | "resource"
    | "resource_link";
  text: string;
  metadata?: Record<string, unknown>;
  attachment?: Attachment;
}

export interface PermissionRequest {
  id: string;
  description: string;
  options: PermissionOption[];
}

export interface PermissionOption {
  id: string;
  label: string;
  isAllow: boolean;
}

export interface NotificationMessage {
  sessionId: string;
  sessionName?: string;
  type: "completed" | "error" | "permission" | "input_required" | "budget_warning";
  summary: string;
  deepLink?: string;
}

export interface AgentCommand {
  name: string;
  description: string;
  input?: unknown;
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "thought"; content: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      kind?: string;
      status: string;
      content?: unknown;
      locations?: unknown;
      rawInput?: unknown;
      rawOutput?: unknown;
      meta?: unknown;
    }
  | {
      type: "tool_update";
      id: string;
      name?: string;
      kind?: string;
      status: string;
      content?: unknown;
      locations?: unknown;
      rawInput?: unknown;
      rawOutput?: unknown;
      meta?: unknown;
    }
  | { type: "plan"; entries: PlanEntry[] }
  | {
      type: "usage";
      tokensUsed?: number;
      contextSize?: number;
      cost?: { amount: number; currency: string };
    }
  | { type: "commands_update"; commands: AgentCommand[] }
  | { type: "image_content"; data: string; mimeType: string }
  | { type: "audio_content"; data: string; mimeType: string }
  | { type: "session_end"; reason: string }
  | { type: "error"; message: string }
  | { type: "system_message"; message: string }
  // ACP Phase 2 additions
  | { type: "session_info_update"; title?: string; updatedAt?: string; _meta?: Record<string, unknown> }
  | { type: "config_option_update"; options: ConfigOption[] }
  | { type: "user_message_chunk"; content: string }
  | { type: "resource_content"; uri: string; name: string; text?: string; blob?: string; mimeType?: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string; title?: string; description?: string; size?: number }
  | { type: "tts_strip" };

export interface PlanEntry {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

export interface AgentDefinition {
  name: string;
  command: string;
  args: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
}

// --- Agent Registry Types ---

export type AgentDistribution = "npx" | "uvx" | "binary" | "custom";

export interface InstalledAgent {
  registryId: string | null;
  name: string;
  version: string;
  distribution: AgentDistribution;
  command: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory?: string;
  installedAt: string;
  binaryPath: string | null;
}

export interface RegistryBinaryTarget {
  archive: string;
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface RegistryDistribution {
  npx?: { package: string; args?: string[]; env?: Record<string, string> };
  uvx?: { package: string; args?: string[]; env?: Record<string, string> };
  binary?: Record<string, RegistryBinaryTarget>;
}

export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  repository?: string;
  website?: string;
  authors?: string[];
  license?: string;
  icon?: string;
  distribution: RegistryDistribution;
}

export interface AgentListItem {
  key: string;
  registryId: string;
  name: string;
  version: string;
  description?: string;
  distribution: AgentDistribution;
  installed: boolean;
  available: boolean;
  missingDeps?: string[];
}

export interface AvailabilityResult {
  available: boolean;
  reason?: string;
  missing?: Array<{ label: string; installHint: string }>;
}

export interface InstallProgress {
  onStart(agentId: string, agentName: string): void | Promise<void>;
  onStep(step: string): void | Promise<void>;
  onDownloadProgress(percent: number): void | Promise<void>;
  onSuccess(agentName: string): void | Promise<void>;
  onError(error: string, hint?: string): void | Promise<void>;
}

export interface InstallResult {
  ok: boolean;
  agentKey: string;
  error?: string;
  hint?: string;
  setupSteps?: string[];
}

export type SessionStatus =
  | "initializing"
  | "active"
  | "cancelled"
  | "finished"
  | "error";

export interface AgentSwitchEntry {
  agentName: string;
  agentSessionId: string;
  switchedAt: string;
  promptCount: number;
}

export interface SessionRecord<P = Record<string, unknown>> {
  sessionId: string;
  agentSessionId: string;
  originalAgentSessionId?: string;
  agentName: string;
  workingDir: string;
  channelId: string;
  status: SessionStatus;
  createdAt: string;
  lastActiveAt: string;
  name?: string;
  dangerousMode?: boolean;
  clientOverrides?: { bypassPermissions?: boolean };
  outputMode?: OutputMode;
  platform: P;
  firstAgent?: string;
  currentPromptCount?: number;
  agentSwitchHistory?: AgentSwitchEntry[];
  // ACP state (cached — overridden by agent response on resume)
  acpState?: {
    // Primary fields (used on load)
    configOptions?: ConfigOption[];
    agentCapabilities?: AgentCapabilities;
    // Legacy fields (kept for backward compat, ignored on load)
    currentMode?: string;
    availableModes?: SessionMode[];
    currentModel?: string;
    availableModels?: ModelInfo[];
  };
}

export interface TelegramPlatformData {
  topicId: number;
  skillMsgId?: number;
}

export interface UsageRecord {
  id: string;
  sessionId: string;
  agentName: string;
  tokensUsed: number;
  contextSize: number;
  cost?: { amount: number; currency: string };
  timestamp: string;
}

export interface UsageRecordEvent {
  sessionId: string;
  agentName: string;
  timestamp: string;
  tokensUsed: number;
  contextSize: number;
  cost?: { amount: number; currency: string };
}


// --- ACP Protocol Types (Phase 2) ---

// Session Modes
export interface SessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface SessionModeState {
  currentModeId: string;
  availableModes: SessionMode[];
}

// Config Options (matches ACP SDK SessionConfigOption)
export interface ConfigSelectChoice {
  value: string;
  label: string;
  description?: string;
}

export interface ConfigSelectGroup {
  group: string;
  name: string;
  options: ConfigSelectChoice[];
}

export type ConfigOption =
  | {
      id: string;
      name: string;
      description?: string;
      category?: string;
      type: "select";
      currentValue: string;
      options: (ConfigSelectChoice | ConfigSelectGroup)[];
      _meta?: Record<string, unknown>;
    }
  | {
      id: string;
      name: string;
      description?: string;
      category?: string;
      type: "boolean";
      currentValue: boolean;
      _meta?: Record<string, unknown>;
    };

export type SetConfigOptionValue =
  | { type: "select"; value: string }
  | { type: "boolean"; value: boolean };

// Model Selection
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

export interface SessionModelState {
  currentModelId: string;
  availableModels: ModelInfo[];
}

// Agent Capabilities (from initialize response)
export interface AgentCapabilities {
  name: string;
  title?: string;
  version?: string;
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
  sessionCapabilities?: {
    list?: boolean;
    fork?: boolean;
    close?: boolean;
  };
  mcp?: { http?: boolean; sse?: boolean };
  authMethods?: AuthMethod[];
}

// Session Response (modes, configOptions, models from session/new response)
export interface NewSessionResponse {
  sessionId: string;
  modes?: SessionModeState;
  configOptions?: ConfigOption[];
  models?: SessionModelState;
}

// Auth
export type AuthMethod =
  | { type: "agent" }
  | { type: "env_var"; name: string; description?: string }
  | { type: "terminal" };

export interface AuthenticateRequest {
  methodId: string;
}

// Prompt Response
export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

export interface PromptResponse {
  stopReason: StopReason;
  _meta?: Record<string, unknown>;
}

// Content Blocks (for prompt input)
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; uri?: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string; title?: string; description?: string; size?: number };

// Session List
export interface SessionListItem {
  sessionId: string;
  title?: string;
  createdAt: string;
  updatedAt?: string;
  _meta?: Record<string, unknown>;
}

export interface SessionListResponse {
  sessions: SessionListItem[];
  nextCursor?: string;
}

// MCP Server Config
export type McpServerConfig =
  | { type?: "stdio"; name: string; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; name: string; url: string; headers?: Record<string, string> }
  | { type: "sse"; name: string; url: string; headers?: Record<string, string> };
