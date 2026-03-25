import type { UsageSummary } from "../../core/types.js";
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
  const si = STATUS_ICONS[tool.status || ""] || "🔧";
  const name = tool.name || "Tool";
  const label =
    verbosity === "low"
      ? formatToolTitle(name, tool.rawInput)
      : formatToolSummary(name, tool.rawInput);
  let text = `${si} <b>${escapeHtml(label)}</b>`;
  text += formatViewerLinks(tool.viewerLinks, tool.viewerFilePath);
  // high: always show content; medium: show when no viewer links; low: never
  if (verbosity === "high" || (verbosity === "medium" && !tool.viewerLinks)) {
    const details = stripCodeFences(extractContentText(tool.content));
    if (details) {
      text += `\n<pre>${escapeHtml(truncateContent(details, 3800))}</pre>`;
    }
  }
  return text;
}

export function formatToolUpdate(
  update: ToolUpdateMeta,
  verbosity: DisplayVerbosity = "medium",
): string {
  const si = STATUS_ICONS[update.status] || "🔧";
  const name = update.name || "Tool";
  const label =
    verbosity === "low"
      ? formatToolTitle(name, update.rawInput)
      : formatToolSummary(name, update.rawInput);
  let text = `${si} <b>${escapeHtml(label)}</b>`;
  text += formatViewerLinks(update.viewerLinks, update.viewerFilePath);
  if (verbosity === "high" || (verbosity === "medium" && !update.viewerLinks)) {
    const details = stripCodeFences(extractContentText(update.content));
    if (details) {
      text += `\n<pre>${escapeHtml(truncateContent(details, 3800))}</pre>`;
    }
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

export function formatPlan(plan: {
  entries: Array<{ content: string; status: string }>;
}): string {
  const statusIcon: Record<string, string> = {
    pending: "⬜",
    in_progress: "🔄",
    completed: "✅",
  };
  const lines = plan.entries.map(
    (e, i) =>
      `${statusIcon[e.status] || "⬜"} ${i + 1}. ${escapeHtml(e.content)}`,
  );
  return `<b>Plan:</b>\n${lines.join("\n")}`;
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
    : '📋 <b>Session Summary</b>'
  return `${header}\n\n${escapeHtml(summary)}`
}

export function splitMessage(text: string, maxLength = 3800): string[] {
  return sharedSplitMessage(text, maxLength);
}
