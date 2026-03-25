import type { OutgoingMessage } from "../../core/types.js";
import type {
  FormattedMessage,
  MessageMetadata,
  DisplayVerbosity,
  NoiseAction,
  NoiseRule,
} from "./format-types.js";
import { STATUS_ICONS, KIND_ICONS } from "./format-types.js";
import { formatTokens } from "./format-utils.js";

export function extractContentText(content: unknown, depth = 0): string {
  if (!content || depth > 5) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => extractContentText(c, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content !== "object") return String(content);

  const obj = content as Record<string, unknown>;
  if (obj.text && typeof obj.text === "string") return obj.text;
  if (obj.content) {
    if (typeof obj.content === "string") return obj.content;
    if (Array.isArray(obj.content)) {
      return obj.content
        .map((c) => extractContentText(c, depth + 1))
        .filter(Boolean)
        .join("\n");
    }
    return extractContentText(obj.content, depth + 1);
  }
  if (obj.input && typeof obj.input === "string") return obj.input;
  if (obj.output && typeof obj.output === "string") return obj.output;
  return "";
}

function parseRawInput(rawInput: unknown): Record<string, unknown> {
  try {
    if (typeof rawInput === "string") {
      return JSON.parse(rawInput) as Record<string, unknown>;
    }
    if (typeof rawInput === "object" && rawInput !== null) {
      return rawInput as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

// --- Step 5: formatToolSummary with displaySummary override ---

export function formatToolSummary(
  name: string,
  rawInput: unknown,
  displaySummary?: string,
): string {
  if (displaySummary && typeof displaySummary === "string") {
    return displaySummary;
  }

  const args = parseRawInput(rawInput);
  const lowerName = name.toLowerCase();

  if (lowerName === "read") {
    const fp = args.file_path ?? args.filePath ?? "";
    const limit = args.limit ? ` (${args.limit} lines)` : "";
    return fp ? `📖 Read ${fp}${limit}` : `🔧 ${name}`;
  }
  if (lowerName === "edit") {
    const fp = args.file_path ?? args.filePath ?? "";
    return fp ? `✏️ Edit ${fp}` : `🔧 ${name}`;
  }
  if (lowerName === "write") {
    const fp = args.file_path ?? args.filePath ?? "";
    return fp ? `📝 Write ${fp}` : `🔧 ${name}`;
  }
  if (lowerName === "bash") {
    const cmd = String(args.command ?? "").slice(0, 60);
    return cmd ? `▶️ Run: ${cmd}` : `🔧 ${name}`;
  }
  if (lowerName === "grep") {
    const pattern = args.pattern ?? "";
    const path = args.path ?? "";
    return pattern
      ? `🔍 Grep "${pattern}"${path ? ` in ${path}` : ""}`
      : `🔧 ${name}`;
  }
  if (lowerName === "glob") {
    const pattern = args.pattern ?? "";
    return pattern ? `🔍 Glob ${pattern}` : `🔧 ${name}`;
  }
  if (lowerName === "agent") {
    const desc = String(args.description ?? "").slice(0, 60);
    return desc ? `🧠 Agent: ${desc}` : `🔧 ${name}`;
  }
  if (lowerName === "webfetch" || lowerName === "web_fetch") {
    const url = String(args.url ?? "").slice(0, 60);
    return url ? `🌐 Fetch ${url}` : `🔧 ${name}`;
  }
  if (lowerName === "websearch" || lowerName === "web_search") {
    const query = String(args.query ?? "").slice(0, 60);
    return query ? `🌐 Search "${query}"` : `🔧 ${name}`;
  }

  return `🔧 ${name}`;
}

// --- Step 6: formatToolTitle for low verbosity ---

export function formatToolTitle(
  name: string,
  rawInput: unknown,
  displayTitle?: string,
): string {
  if (displayTitle && typeof displayTitle === "string") {
    return displayTitle;
  }

  const args = parseRawInput(rawInput);
  const lowerName = name.toLowerCase();

  if (["read", "edit", "write"].includes(lowerName)) {
    return String(args.file_path ?? args.filePath ?? name);
  }
  if (lowerName === "bash") {
    return String(args.command ?? name).slice(0, 60);
  }
  if (lowerName === "grep") {
    const pattern = args.pattern ?? "";
    const path = args.path ?? "";
    return pattern ? `"${pattern}"${path ? ` in ${path}` : ""}` : name;
  }
  if (lowerName === "glob") {
    return String(args.pattern ?? name);
  }
  if (lowerName === "agent") {
    return String(args.description ?? name).slice(0, 60);
  }
  if (["webfetch", "web_fetch"].includes(lowerName)) {
    return String(args.url ?? name).slice(0, 60);
  }
  if (["websearch", "web_search"].includes(lowerName)) {
    return String(args.query ?? name).slice(0, 60);
  }

  return name;
}

// --- Step 7: Noise filtering ---

const NOISE_RULES: NoiseRule[] = [
  {
    match: (name) => name.toLowerCase() === "ls",
    action: "hide",
  },
  {
    match: (_name, kind, rawInput) => {
      if (kind !== "read") return false;
      const args = parseRawInput(rawInput);
      const p = String(args.file_path ?? args.filePath ?? args.path ?? "");
      return p.endsWith("/");
    },
    action: "hide",
  },
  {
    match: (name) => name.toLowerCase() === "glob",
    action: "collapse",
  },
];

export function evaluateNoise(
  name: string,
  kind: string,
  rawInput: unknown,
): NoiseAction | null {
  for (const rule of NOISE_RULES) {
    if (rule.match(name, kind, rawInput)) return rule.action;
  }
  return null;
}

// --- Step 8: formatOutgoingMessage with verbosity + noise + viewerLinks ---

function buildViewerLinks(
  meta: Record<string, unknown>,
): { type: "file" | "diff"; url: string; label: string }[] | undefined {
  const vl = meta.viewerLinks as Record<string, string> | undefined;
  if (!vl) return undefined;

  const filePath = String(meta.viewerFilePath ?? "file");
  const links: { type: "file" | "diff"; url: string; label: string }[] = [];
  if (vl.file)
    links.push({ type: "file", url: vl.file, label: `📄 View ${filePath}` });
  if (vl.diff)
    links.push({
      type: "diff",
      url: vl.diff,
      label: `📝 View diff — ${filePath}`,
    });
  return links.length > 0 ? links : undefined;
}

function formatToolMessage(
  meta: Record<string, unknown>,
  msgType: string,
  msgText: string,
  verbosity: DisplayVerbosity,
): FormattedMessage | null {
  const name = String(meta.name ?? msgText ?? "Tool");
  const kind = String(meta.displayKind ?? meta.kind ?? "other");
  const status = String(
    meta.status ?? (msgType === "tool_update" ? "completed" : "pending"),
  );
  const rawInput = meta.rawInput;
  const displaySummary = meta.displaySummary as string | undefined;
  const displayTitle = meta.displayTitle as string | undefined;
  const statusIcon = STATUS_ICONS[status] ?? "⏳";
  const kindIcon = KIND_ICONS[kind] ?? "🔧";
  const viewerLinks = buildViewerLinks(meta);

  const noiseAction = evaluateNoise(name, kind, rawInput);

  if (noiseAction === "hide" && verbosity !== "high") return null;
  if (noiseAction === "hide" && verbosity === "high") {
    return {
      summary: `${statusIcon} ${formatToolTitle(name, rawInput, displayTitle)}`,
      viewerLinks,
      icon: kindIcon,
      originalType: msgType,
      style: "tool",
      metadata: { toolName: name, toolStatus: status, toolKind: kind },
    };
  }
  if (noiseAction === "collapse" && verbosity === "low") return null;
  if (noiseAction === "collapse" && verbosity === "medium") {
    return {
      summary: `${statusIcon} ${kindIcon}`,
      viewerLinks,
      icon: kindIcon,
      originalType: msgType,
      style: "tool",
      metadata: { toolName: name, toolStatus: status, toolKind: kind },
    };
  }

  const summary =
    verbosity === "low"
      ? `${statusIcon} ${formatToolTitle(name, rawInput, displayTitle)}`
      : `${statusIcon} ${formatToolSummary(name, rawInput, displaySummary)}`;

  const detail =
    verbosity === "high"
      ? extractContentText(meta.content) || undefined
      : undefined;

  return {
    summary,
    detail,
    viewerLinks,
    icon: kindIcon,
    originalType: msgType,
    style: "tool",
    metadata: { toolName: name, toolStatus: status, toolKind: kind },
  };
}

export function formatOutgoingMessage(
  msg: OutgoingMessage,
  verbosity: DisplayVerbosity = "medium",
): FormattedMessage | null {
  const meta = (msg.metadata ?? {}) as Record<string, unknown>;

  switch (msg.type) {
    case "text":
      return {
        summary: msg.text,
        icon: "",
        originalType: "text",
        style: "text",
      };

    case "thought": {
      const full = msg.text;
      const summary = full.length > 80 ? full.slice(0, 80) + "..." : full;
      return {
        summary,
        detail: full.length > 80 ? full : undefined,
        icon: "💭",
        originalType: "thought",
        style: "thought",
      };
    }

    case "tool_call":
      return formatToolMessage(meta, "tool_call", msg.text, verbosity);

    case "tool_update":
      return formatToolMessage(meta, "tool_update", msg.text, verbosity);

    case "plan": {
      const entries = (meta.entries ?? []) as {
        content: string;
        status: string;
      }[];
      return {
        summary: `📋 Plan: ${entries.length} steps`,
        icon: "📋",
        originalType: "plan",
        style: "plan",
        metadata: { planEntries: entries } satisfies MessageMetadata,
      };
    }

    case "usage": {
      const tokens = Number(meta.tokensUsed ?? 0);
      const costObj = meta.cost as
        | { amount?: number; currency?: string }
        | number
        | undefined;
      const costAmount =
        typeof costObj === "number" ? costObj : (costObj?.amount ?? 0);
      const summary = `📊 ${formatTokens(tokens)} tokens${costAmount ? ` · $${costAmount.toFixed(2)}` : ""}`;
      return {
        summary,
        icon: "📊",
        originalType: "usage",
        style: "usage",
        metadata: {
          tokens,
          contextSize: Number(meta.contextSize ?? 0),
          cost: costAmount,
        },
      };
    }

    case "error": {
      const full = msg.text;
      return {
        summary: full.length > 120 ? full.slice(0, 120) + "..." : full,
        detail: full.length > 120 ? full : undefined,
        icon: "❌",
        originalType: "error",
        style: "error",
      };
    }

    case "session_end":
      return {
        summary: `Session ${msg.text}`,
        icon: msg.text.includes("completed") ? "✅" : "❌",
        originalType: "session_end",
        style: "system",
      };

    case "system_message":
      return {
        summary: msg.text,
        icon: "ℹ️",
        originalType: "system_message",
        style: "system",
      };

    case "attachment":
      return {
        summary: msg.text || "File",
        icon: "📎",
        originalType: "attachment",
        style: "attachment",
      };

    default:
      return {
        summary: msg.text || "",
        icon: "",
        originalType: msg.type,
        style: "text",
      };
  }
}
