import type { Attachment } from "../../../core/types.js";

export interface SessionHistory {
  version: 1;
  sessionId: string;
  turns: Turn[];
}

export interface Turn {
  index: number;
  role: "user" | "assistant";
  timestamp: string;
  // User turn
  content?: string;
  attachments?: HistoryAttachment[];
  sourceAdapterId?: string;
  // Assistant turn
  steps?: Step[];
  usage?: HistoryUsage;
  stopReason?: string;
}

export interface HistoryAttachment {
  type: "image" | "audio" | "file";
  fileName: string;
  mimeType: string;
  size: number;
}

export interface HistoryUsage {
  tokensUsed?: number;
  contextSize?: number;
  cost?: { amount: number; currency: string };
}

export type Step =
  | ThinkingStep
  | TextStep
  | ToolCallStep
  | PlanStep
  | ImageStep
  | AudioStep
  | ResourceStep
  | ResourceLinkStep
  | ModeChangeStep
  | ConfigChangeStep;

export interface ThinkingStep {
  type: "thinking";
  content: string;
}

export interface TextStep {
  type: "text";
  content: string;
}

export interface ToolCallStep {
  type: "tool_call";
  id: string;
  name: string;
  kind?: string;
  status: string;
  input?: unknown;
  output?: unknown;
  diff?: { path: string; oldText?: string; newText: string } | null;
  locations?: { path: string; line?: number }[];
  permission?: { requested: boolean; outcome: string } | null;
}

export interface PlanStep {
  type: "plan";
  entries: { content: string; priority: string; status: string }[];
}

export interface ImageStep {
  type: "image";
  mimeType: string;
  filePath: string;
  size?: number;
}

export interface AudioStep {
  type: "audio";
  mimeType: string;
  filePath: string;
  size?: number;
}

export interface ResourceStep {
  type: "resource";
  uri: string;
  name: string;
  text?: string;
}

export interface ResourceLinkStep {
  type: "resource_link";
  uri: string;
  name: string;
  title?: string;
  description?: string;
}

export interface ModeChangeStep {
  type: "mode_change";
  modeId: string;
}

export interface ConfigChangeStep {
  type: "config_change";
  configId: string;
  value: string;
}
