export interface Attachment {
  type: 'image' | 'audio' | 'file';
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
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
    | "attachment";
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
  type: "completed" | "error" | "permission" | "input_required";
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
  | { type: "error"; message: string };

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
  platform: P;
}

export interface TelegramPlatformData {
  topicId: number;
  skillMsgId?: number;
}

export interface DiscordPlatformData {
  threadId: string;
  skillMsgId?: string;
}
