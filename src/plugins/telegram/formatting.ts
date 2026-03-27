import type { UsageSummary } from "../../core/types.js";
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

export function escapeHtml(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function markdownToTelegramHtml(md: string): string {
  // Step 1: Extract code blocks and inline code into placeholders
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // Extract fenced code blocks (```lang\n...\n```)
  let text = md.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    (_match, lang: string, code: string) => {
      const index = codeBlocks.length;
      const escapedCode = escapeHtml(code);
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      codeBlocks.push(`<pre><code${langAttr}>${escapedCode}</code></pre>`);
      return `\x00CODE_BLOCK_${index}\x00`;
    },
  );

  // Extract inline code (`...`)
  text = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE_CODE_${index}\x00`;
  });

  // Step 2: Escape HTML in remaining text
  text = escapeHtml(text);

  // Step 3: Apply markdown transformations
  // Bold: **text** → <b>text</b>
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *text* → <i>text</i> (but not the ** used for bold)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // Links: [text](url) → <a href="url">text</a>
  // Note: after escapeHtml, parentheses are not affected, but we need to handle
  // the escaped brackets properly. Since [ ] and ( ) are not escaped, this works directly.
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Step 4: Restore fenced code blocks
  text = text.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_match, idx: string) => {
    return codeBlocks[parseInt(idx, 10)];
  });

  // Step 5: Restore inline code
  text = text.replace(/\x00INLINE_CODE_(\d+)\x00/g, (_match, idx: string) => {
    return inlineCodes[parseInt(idx, 10)];
  });

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
  let text = `${si} <b>${escapeHtml(label)}</b>`;
  // viewer links always shown regardless of verbosity
  text += formatViewerLinks(tool.viewerLinks, tool.viewerFilePath);
  // high only: rawInput + content
  if (verbosity === "high") {
    text += formatHighDetails(tool.rawInput, tool.content, 3800);
  }
  return text;
}

export function formatToolUpdate(
  update: ToolUpdateMeta,
  verbosity: DisplayVerbosity = "medium",
): string {
  const si = resolveToolIcon(update);
  const name = update.name || "Tool";
  const label =
    verbosity === "low"
      ? formatToolTitle(name, update.rawInput, update.displayTitle)
      : formatToolSummary(name, update.rawInput, update.displaySummary);
  let text = `${si} <b>${escapeHtml(label)}</b>`;
  text += formatViewerLinks(update.viewerLinks, update.viewerFilePath);
  if (verbosity === "high") {
    text += formatHighDetails(update.rawInput, update.content, 3800);
  }
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
      text += `\n<b>Input:</b>\n<pre>${escapeHtml(truncateContent(inputStr, maxLen))}</pre>`;
    }
  }
  const details = stripCodeFences(extractContentText(content));
  if (details) {
    text += `\n<b>Output:</b>\n<pre>${escapeHtml(truncateContent(details, maxLen))}</pre>`;
  }
  return text;
}

function formatViewerLinks(links?: ViewerLinks, filePath?: string): string {
  if (!links) return "";
  const fileName = filePath ? filePath.split("/").pop() || filePath : "";
  let text = "\n";
  if (links.file)
    text += `\n📄 <a href="${escapeHtml(links.file)}">View ${escapeHtml(fileName || "file")}</a>`;
  if (links.diff)
    text += `\n📝 <a href="${escapeHtml(links.diff)}">View diff${fileName ? ` — ${escapeHtml(fileName)}` : ""}</a>`;
  return text;
}

export function formatPlan(
  plan: { entries: Array<{ content: string; status: string }> },
  verbosity: DisplayVerbosity = "medium",
): string {
  const { entries } = plan;
  // medium: summary count only
  if (verbosity === "medium") {
    const done = entries.filter((e) => e.status === "completed").length;
    return `📋 <b>Plan:</b> ${done}/${entries.length} steps completed`;
  }
  // high: full entries
  const statusIcon: Record<string, string> = {
    pending: "⬜",
    in_progress: "🔄",
    completed: "✅",
  };
  const lines = entries.map(
    (e, i) =>
      `${statusIcon[e.status] || "⬜"} ${i + 1}. ${escapeHtml(e.content)}`,
  );
  return `<b>Plan:</b>\n${lines.join("\n")}`;
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

const PERIOD_LABEL: Record<string, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  all: "All Time",
};

export function formatUsageReport(
  summaries: UsageSummary[],
  budgetStatus: {
    status: string;
    used: number;
    budget: number;
    percent: number;
  },
): string {
  const hasData = summaries.some((s) => s.recordCount > 0);
  if (!hasData) {
    return "📊 <b>Usage Report</b>\n\nNo usage data yet.";
  }

  const formatCost = (n: number) => `$${n.toFixed(2)}`;
  const lines: string[] = ["📊 <b>Usage Report</b>"];

  for (const summary of summaries) {
    lines.push("");
    lines.push(
      `── <b>${PERIOD_LABEL[summary.period] ?? summary.period}</b> ──`,
    );
    lines.push(
      `💰 ${formatCost(summary.totalCost)} · 🔤 ${formatTokens(summary.totalTokens)} tokens · 📋 ${summary.sessionCount} sessions`,
    );

    // Show budget bar only on the month section
    if (summary.period === "month" && budgetStatus.budget > 0) {
      const bar = progressBar(budgetStatus.used / budgetStatus.budget);
      lines.push(
        `Budget: ${formatCost(budgetStatus.used)} / ${formatCost(budgetStatus.budget)} (${budgetStatus.percent}%)`,
      );
      lines.push(`${bar} ${budgetStatus.percent}%`);
    }
  }

  return lines.join("\n");
}

export function formatSummary(summary: string, sessionName?: string): string {
  const header = sessionName
    ? `📋 <b>Summary — ${escapeHtml(sessionName)}</b>`
    : "📋 <b>Session Summary</b>";
  return `${header}\n\n${escapeHtml(summary)}`;
}

export function splitMessage(text: string, maxLength = 3800): string[] {
  return sharedSplitMessage(text, maxLength);
}
