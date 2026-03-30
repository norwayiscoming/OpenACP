import type {
  ToolCallMeta,
  ToolUpdateMeta,
  ViewerLinks,
} from "../../core/adapter-primitives/format-types.js";
import type { ToolCardSnapshot } from "../../core/adapter-primitives/primitives/tool-card-state.js";
import type { ToolDisplaySpec } from "../../core/adapter-primitives/display-spec-builder.js";
import {
  STATUS_ICONS,
  KIND_ICONS,
  KIND_LABELS,
} from "../../core/adapter-primitives/format-types.js";
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
  return formatToolCall(update, verbosity);
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

export function formatPlan(plan: {
  entries: Array<{ content: string; status: string }>;
}): string {
  const { entries } = plan;
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
  _verbosity: DisplayVerbosity = "medium",
): string {
  const { tokensUsed, contextSize } = usage;
  if (tokensUsed == null) return "📊 Usage data unavailable";
  if (contextSize == null) return `📊 ${formatTokens(tokensUsed)} tokens`;

  const ratio = tokensUsed / contextSize;
  const pct = Math.round(ratio * 100);
  const bar = progressBar(ratio);
  const emoji = pct >= 85 ? "⚠️" : "📊";
  return `${emoji} ${formatTokens(tokensUsed)} / ${formatTokens(contextSize)} tokens\n${bar} ${pct}%`;
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

export function renderToolCard(snap: ToolCardSnapshot): string {
  const sections: string[] = [];

  const { totalVisible, completedVisible, allComplete } = snap;
  const headerCheck = allComplete ? " ✅" : "";
  if (totalVisible > 0) {
    sections.push(`<b>📋 Tools (${completedVisible}/${totalVisible})</b>${headerCheck}`);
  }

  const DONE = new Set(["completed", "done", "failed", "error"]);
  const visible = snap.specs.filter((s) => !s.isHidden);
  const completed = visible.filter((s) => DONE.has(s.status));
  const running = visible.filter((s) => !DONE.has(s.status));

  for (const spec of completed) {
    sections.push(renderSpecSection(spec));
  }

  if (snap.planEntries && snap.planEntries.length > 0) {
    const planDone = snap.planEntries.filter((e) => e.status === "completed").length;
    const planTotal = snap.planEntries.length;
    sections.push(`── Plan: ${planDone}/${planTotal} ──`);
    const statusIcon: Record<string, string> = { completed: "✅", in_progress: "🔄", pending: "⬜" };
    for (let i = 0; i < snap.planEntries.length; i++) {
      const e = snap.planEntries[i];
      sections.push(`${statusIcon[e.status] ?? "⬜"} ${i + 1}. ${escapeHtml(e.content)}`);
    }
    sections.push("────");
  }

  for (const spec of running) {
    sections.push(renderSpecSection(spec));
  }

  return sections.join("\n\n");
}

const FILE_KINDS = new Set(["read", "edit", "write", "delete"]);

/** Shorten absolute file paths to just filename (+ line range if present) */
function shortenTitle(title: string, kind: string): string {
  if (!FILE_KINDS.has(kind) || !title.includes("/")) return title;
  // Separate optional parenthesized suffix (e.g. " (lines 10–50)" or " (from line 10)")
  const parenIdx = title.indexOf(" (");
  const pathPart = parenIdx > 0 ? title.slice(0, parenIdx) : title;
  const rangePart = parenIdx > 0 ? title.slice(parenIdx) : "";
  const fileName = pathPart.split("/").pop() || pathPart;
  return fileName + rangePart;
}

function renderSpecSection(spec: ToolDisplaySpec): string {
  const lines: string[] = [];

  const DONE = new Set(["completed", "done", "failed", "error"]);
  // Status prefix at the start so text doesn't shift when status changes
  const statusPrefix =
    spec.status === "error" || spec.status === "failed"
      ? "❌ "
      : DONE.has(spec.status)
        ? "✅ "
        : "🔄 ";

  // Build title line: "✅ 📖 Read · filename.ts"
  const kindLabel = KIND_LABELS[spec.kind];
  const displayTitle = shortenTitle(spec.title, spec.kind);
  // Suppress title when it duplicates the kind label (e.g. "Edit · Edit")
  const hasUniqueTitle = displayTitle && displayTitle.toLowerCase() !== kindLabel?.toLowerCase()
    && displayTitle.toLowerCase() !== spec.kind;
  let titleLine: string;
  if (kindLabel) {
    titleLine = hasUniqueTitle
      ? `${statusPrefix}${spec.icon} <b>${kindLabel}</b> · ${escapeHtml(displayTitle)}`
      : `${statusPrefix}${spec.icon} <b>${kindLabel}</b>`;
  } else {
    titleLine = `${statusPrefix}${spec.icon} ${escapeHtml(displayTitle)}`;
  }
  if (spec.diffStats) {
    const { added, removed } = spec.diffStats;
    if (added > 0 && removed > 0) titleLine += ` · <i>+${added}/-${removed} lines</i>`;
    else if (added > 0) titleLine += ` · <i>+${added} lines</i>`;
    else if (removed > 0) titleLine += ` · <i>-${removed} lines</i>`;
  }
  lines.push(titleLine);

  if (spec.description) lines.push(`   <i>${escapeHtml(spec.description)}</i>`);
  if (spec.command) lines.push(`   <code>${escapeHtml(spec.command)}</code>`);
  if (spec.inputContent) {
    const truncated = spec.inputContent.length > 800 ? spec.inputContent.slice(0, 797) + "…" : spec.inputContent;
    lines.push(`   <pre><code>${escapeHtml(truncated)}</code></pre>`);
  }
  if (spec.outputSummary) lines.push(`   · ${escapeHtml(spec.outputSummary)}`);
  if (spec.outputContent || spec.outputFallbackContent) {
    const raw = spec.outputContent ?? spec.outputFallbackContent!;
    const truncated =
      raw.length > 800
        ? raw.slice(0, 797) + "…"
        : raw;
    lines.push(`   <pre><code>${escapeHtml(truncated)}</code></pre>`);
  }

  if (spec.viewerLinks?.file || spec.viewerLinks?.diff || spec.outputViewerLink) {
    const linkParts: string[] = [];
    const shortName = displayTitle || kindLabel || spec.kind;
    if (spec.viewerLinks?.file)
      linkParts.push(`<a href="${escapeHtml(spec.viewerLinks.file)}">View ${escapeHtml(shortName)}</a>`);
    if (spec.viewerLinks?.diff)
      linkParts.push(`<a href="${escapeHtml(spec.viewerLinks.diff)}">View diff</a>`);
    if (spec.outputViewerLink)
      linkParts.push(`<a href="${escapeHtml(spec.outputViewerLink)}">View output</a>`);
    lines.push(`      ${linkParts.join(" · ")}`);
  }

  return lines.join("\n");
}

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Split a tool card into multiple chunks at entry boundaries.
 * Each chunk stays under the Telegram message length limit.
 */
export function splitToolCardText(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];

  const sections = text.split("\n\n");
  const chunks: string[] = [];
  let current = "";

  for (const section of sections) {
    // Handle single section > limit (truncate with ellipsis)
    const safeSection =
      section.length > TELEGRAM_MAX_LENGTH
        ? section.slice(0, TELEGRAM_MAX_LENGTH - 3) + "..."
        : section;

    const candidate = current ? `${current}\n\n${safeSection}` : safeSection;
    if (candidate.length > TELEGRAM_MAX_LENGTH && current) {
      chunks.push(current);
      current = safeSection;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
