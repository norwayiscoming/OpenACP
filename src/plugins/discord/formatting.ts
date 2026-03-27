import type { PlanEntry } from "../../core/types.js";
import type {
  ToolCallMeta,
  ToolUpdateMeta,
  ViewerLinks,
} from "../../core/adapter-primitives/format-types.js";
import { STATUS_ICONS, KIND_ICONS } from "../../core/adapter-primitives/format-types.js";
import {
  progressBar,
  formatTokens,
  truncateContent,
  stripCodeFences,
  splitMessage as sharedSplitMessage,
} from "../../core/adapter-primitives/format-utils.js";
import {
  extractContentText,
  formatToolSummary,
  formatToolTitle,
  resolveToolIcon,
} from "../../core/adapter-primitives/message-formatter.js";
import type { DisplayVerbosity } from "../../core/adapter-primitives/format-types.js";

function formatViewerLinks(links?: ViewerLinks, filePath?: string): string {
  if (!links) return "";
  const fileName = filePath ? filePath.split("/").pop() || filePath : "";
  let text = "\n";
  if (links.file) text += `\n[View ${fileName || "file"}](${links.file})`;
  if (links.diff)
    text += `\n[View diff${fileName ? ` — ${fileName}` : ""}](${links.diff})`;
  return text;
}

function formatHighDetails(
  rawInput: unknown,
  content: unknown,
  maxLen: number,
): string {
  let text = "";
  if (rawInput) {
    const inputStr =
      typeof rawInput === "string"
        ? rawInput
        : JSON.stringify(rawInput, null, 2);
    if (inputStr && inputStr !== "{}") {
      text += `\n**Input:**\n\`\`\`\n${truncateContent(inputStr, maxLen)}\n\`\`\``;
    }
  }
  const details = stripCodeFences(extractContentText(content));
  if (details) {
    text += `\n**Output:**\n\`\`\`\n${truncateContent(details, maxLen)}\n\`\`\``;
  }
  return text;
}

export function formatToolCall(
  tool: ToolCallMeta,
  verbosity: DisplayVerbosity = "medium",
): string {
  const si = resolveToolIcon(tool);
  const name = tool.name || "Tool";
  const label =
    verbosity === "low"
      ? formatToolTitle(name, tool.rawInput, tool.displayTitle)
      : formatToolSummary(name, tool.rawInput, tool.displaySummary);
  let text = `${si} **${label}**`;
  // viewer links always shown regardless of verbosity
  text += formatViewerLinks(tool.viewerLinks, tool.viewerFilePath);
  // high only: rawInput + content
  if (verbosity === "high") {
    text += formatHighDetails(tool.rawInput, tool.content, 500);
  }
  return text;
}

export function formatToolUpdate(
  update: ToolUpdateMeta,
  verbosity: DisplayVerbosity = "medium",
): string {
  return formatToolCall(update, verbosity);
}

export function formatPlan(
  entries: PlanEntry[],
  verbosity: DisplayVerbosity = "medium",
): string {
  // medium: summary count only
  if (verbosity === "medium") {
    const done = entries.filter((e) => e.status === "completed").length;
    return `📋 **Plan:** ${done}/${entries.length} steps completed`;
  }
  // high: full entries
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

export function formatUsage(
  usage: { tokensUsed?: number; contextSize?: number; cost?: number },
  verbosity: DisplayVerbosity = "medium",
): string {
  const { tokensUsed, contextSize, cost } = usage;
  if (tokensUsed == null) return "📊 Usage data unavailable";

  // medium: compact one-line
  if (verbosity === "medium") {
    const costStr = cost != null ? ` · $${cost.toFixed(2)}` : "";
    return `📊 ${formatTokens(tokensUsed)} tokens${costStr}`;
  }

  // high: full progress bar + cost
  if (contextSize == null) return `📊 ${formatTokens(tokensUsed)} tokens`;
  const ratio = tokensUsed / contextSize;
  const pct = Math.round(ratio * 100);
  const bar = progressBar(ratio);
  const emoji = pct >= 85 ? "⚠️" : "📊";
  let text = `${emoji} ${formatTokens(tokensUsed)} / ${formatTokens(contextSize)} tokens\n${bar} ${pct}%`;
  if (cost != null) text += `\n💰 $${cost.toFixed(2)}`;
  return text;
}

export function splitMessage(text: string, maxLength = 1800): string[] {
  return sharedSplitMessage(text, maxLength);
}
