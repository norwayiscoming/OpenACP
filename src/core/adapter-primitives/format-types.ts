// src/adapters/shared/format-types.ts

export type DisplayVerbosity = "low" | "medium" | "high";

export type NoiseAction = "hide" | "collapse";

export interface NoiseRule {
  match: (name: string, kind: string, rawInput: unknown) => boolean;
  action: NoiseAction;
}

export type MessageStyle =
  | "text"
  | "thought"
  | "tool"
  | "plan"
  | "usage"
  | "system"
  | "error"
  | "attachment";

export interface MessageMetadata {
  toolName?: string;
  toolStatus?: string;
  toolKind?: string;
  filePath?: string;
  command?: string;
  planEntries?: { content: string; status: string }[];
  tokens?: number;
  contextSize?: number;
  cost?: number;
  viewerLinks?: ViewerLinks;
  viewerFilePath?: string;
}

/** summary and detail are always plain text (never pre-escaped HTML/markdown) — renderers handle escaping */
export interface FormattedMessage {
  summary: string;
  detail?: string;
  viewerLinks?: ViewerLinks;
  icon: string;
  originalType: string;
  style: MessageStyle;
  metadata?: MessageMetadata;
}

export const STATUS_ICONS: Record<string, string> = {
  pending: "⏳",
  in_progress: "🔄",
  completed: "✅",
  failed: "❌",
  cancelled: "🚫",
  running: "🔄",
  done: "✅",
  error: "❌",
};

export const KIND_ICONS: Record<string, string> = {
  read: "📖",
  edit: "✏️",
  write: "✏️",
  delete: "🗑️",
  execute: "▶️",
  command: "▶️",
  bash: "▶️",
  terminal: "▶️",
  search: "🔍",
  web: "🌐",
  fetch: "🌐",
  agent: "🧠",
  think: "🧠",
  install: "📦",
  move: "📦",
  other: "🛠️",
};

export interface ViewerLinks {
  file?: string;
  diff?: string;
}

export interface ToolCallMeta {
  id: string;
  name: string;
  kind?: string;
  status?: string;
  content?: unknown;
  rawInput?: unknown;
  viewerLinks?: ViewerLinks;
  viewerFilePath?: string;
  displaySummary?: string;
  displayTitle?: string;
  displayKind?: string;
}

export interface ToolUpdateMeta extends ToolCallMeta {
  status: string;
}
