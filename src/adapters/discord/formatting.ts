import type { PlanEntry } from "../../core/types.js";
import type {
  ToolCallMeta,
  ToolUpdateMeta,
  ViewerLinks,
} from "../shared/format-types.js";
import { STATUS_ICONS } from "../shared/format-types.js";
import {
  progressBar,
  formatTokens,
  truncateContent,
  stripCodeFences,
  splitMessage as sharedSplitMessage,
} from "../shared/format-utils.js";
import {
  extractContentText,
  formatToolSummary,
  formatToolTitle,
} from "../shared/message-formatter.js";
import type { DisplayVerbosity } from "../shared/format-types.js";

function formatViewerLinks(links?: ViewerLinks, filePath?: string): string {
  if (!links) return "";
  const fileName = filePath ? filePath.split("/").pop() || filePath : "";
  let text = "\n";
  if (links.file) text += `\n[View ${fileName || "file"}](${links.file})`;
  if (links.diff)
    text += `\n[View diff${fileName ? ` — ${fileName}` : ""}](${links.diff})`;
  return text;
}

export function formatToolCall(
  tool: ToolCallMeta,
  verbosity: DisplayVerbosity = "medium",
): string {
  const si = STATUS_ICONS[tool.status || ""] || "🔧";
  const name = tool.name || "Tool";
  const label =
    verbosity === "low"
      ? formatToolTitle(name, tool.rawInput)
      : formatToolSummary(name, tool.rawInput);
  let text = `${si} **${label}**`;
  text += formatViewerLinks(tool.viewerLinks, tool.viewerFilePath);
  if (verbosity === "high" || (verbosity === "medium" && !tool.viewerLinks)) {
    const details = stripCodeFences(extractContentText(tool.content));
    if (details) {
      text += `\n\`\`\`\n${truncateContent(details, 500)}\n\`\`\``;
    }
  }
  return text;
}

export function formatToolUpdate(
  update: ToolUpdateMeta,
  verbosity: DisplayVerbosity = "medium",
): string {
  return formatToolCall(update, verbosity);
}

export function formatPlan(entries: PlanEntry[]): string {
  const statusIcon: Record<string, string> = {
    pending: "⏳",
    in_progress: "🔄",
    completed: "✅",
  };
  const lines = entries.map(
    (e, i) => `${statusIcon[e.status] || "⬜"} ${i + 1}. ${e.content}`,
  );
  return `**Plan:**\n${lines.join("\n")}`;
}

export function formatUsage(usage: {
  tokensUsed?: number;
  contextSize?: number;
}): string {
  const { tokensUsed, contextSize } = usage;
  if (tokensUsed == null) return "📊 Usage data unavailable";
  if (contextSize == null) return `📊 ${formatTokens(tokensUsed)} tokens`;

  const ratio = tokensUsed / contextSize;
  const pct = Math.round(ratio * 100);
  const bar = progressBar(ratio);
  const emoji = pct >= 85 ? "⚠️" : "📊";
  return `${emoji} ${formatTokens(tokensUsed)} / ${formatTokens(contextSize)} tokens\n${bar} ${pct}%`;
}

export function splitMessage(text: string, maxLength = 1800): string[] {
  return sharedSplitMessage(text, maxLength);
}
