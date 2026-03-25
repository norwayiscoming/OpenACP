import type { NoiseAction, NoiseRule } from "./format-types.js";
import { STATUS_ICONS, KIND_ICONS } from "./format-types.js";

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
  if (obj.input) return extractContentText(obj.input, depth + 1);
  if (obj.output) return extractContentText(obj.output, depth + 1);

  // Skip objects with only a 'type' key and no content fields
  const keys = Object.keys(obj).filter((k) => k !== "type");
  if (keys.length === 0) return "";

  // Fallback: serialize unrecognized objects so edge-case agent responses are not silently dropped
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return "";
  }
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
