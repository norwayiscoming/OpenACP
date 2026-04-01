// src/core/adapter-primitives/display-spec-builder.ts

import { KIND_ICONS } from "./format-types.js";
import type { OutputMode, ViewerLinks } from "./format-types.js";
import type { ToolEntry } from "./stream-accumulator.js";
import type { TunnelServiceInterface } from "../plugin/types.js";

// ─── Output spec interfaces ────────────────────────────────────────────────

export interface ToolDisplaySpec {
  id: string;
  kind: string;
  icon: string;
  title: string;
  description: string | null;
  command: string | null;
  inputContent: string | null;
  outputSummary: string | null;
  outputContent: string | null;
  diffStats: { added: number; removed: number } | null;
  viewerLinks?: ViewerLinks;
  outputViewerLink?: string;
  outputFallbackContent?: string;
  status: string;
  isNoise: boolean;
  isHidden: boolean;
}

export interface ThoughtDisplaySpec {
  indicator: string;
  content: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────

/** Kinds that have a runnable command in rawInput.command */
const EXECUTE_KINDS = new Set(["execute", "bash", "command", "terminal"]);

const INLINE_MAX_LINES = 15;
const INLINE_MAX_CHARS = 800;

// ─── Helpers ──────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function buildTitle(entry: ToolEntry, kind: string): string {
  // Explicit overrides take highest priority
  if (entry.displayTitle) return entry.displayTitle;
  if (entry.displaySummary) return entry.displaySummary;

  const input = asRecord(entry.rawInput);

  if (kind === "read") {
    const filePath = typeof input.file_path === "string" ? input.file_path : null;
    if (filePath) {
      // start_line/end_line style
      const startLine = typeof input.start_line === "number" ? input.start_line : null;
      const endLine = typeof input.end_line === "number" ? input.end_line : null;
      if (startLine !== null && endLine !== null) return `${filePath} (lines ${startLine}–${endLine})`;
      if (startLine !== null) return `${filePath} (from line ${startLine})`;
      // offset/limit style (Claude Code Read tool)
      const offset = typeof input.offset === "number" ? input.offset : null;
      const limit = typeof input.limit === "number" ? input.limit : null;
      if (offset !== null && limit !== null) return `${filePath} (lines ${offset}–${offset + limit - 1})`;
      if (offset !== null) return `${filePath} (from line ${offset})`;
      return filePath;
    }
    return capitalize(entry.name);
  }

  if (kind === "edit" || kind === "write" || kind === "delete") {
    const filePath =
      typeof input.file_path === "string"
        ? input.file_path
        : typeof input.path === "string"
          ? input.path
          : null;
    if (filePath) return filePath;
    return capitalize(entry.name);
  }

  if (EXECUTE_KINDS.has(kind)) {
    const description = typeof input.description === "string" ? input.description : null;
    if (description) return description;
    const command = typeof input.command === "string" ? input.command : null;
    if (command) return command.length > 60 ? command.slice(0, 57) + "..." : command;
    return capitalize(entry.name);
  }

  if (kind === "agent") {
    const skill = typeof input.skill === "string" ? input.skill : null;
    const description = typeof input.description === "string" ? input.description : null;
    const subtype = typeof input.subagent_type === "string" ? input.subagent_type : null;
    if (skill) return skill;
    if (description) return description.length > 60 ? description.slice(0, 57) + "..." : description;
    if (subtype) return subtype;
    return capitalize(entry.name);
  }

  if (kind === "search") {
    const pattern =
      typeof input.pattern === "string"
        ? input.pattern
        : typeof input.query === "string"
          ? input.query
          : null;
    if (pattern) {
      let title = `${capitalize(entry.name)} "${pattern}"`;
      const glob = typeof input.glob === "string" ? input.glob : null;
      const type = typeof input.type === "string" ? input.type : null;
      if (glob) title += ` (glob: ${glob})`;
      else if (type) title += ` (type: ${type})`;
      return title;
    }
    return capitalize(entry.name);
  }

  if (kind === "fetch" || kind === "web") {
    const url = typeof input.url === "string" ? input.url : null;
    if (url && url !== "undefined") return url.length > 60 ? url.slice(0, 57) + "..." : url;
    const query = typeof input.query === "string" ? input.query : null;
    if (query && query !== "undefined") return query.length > 60 ? query.slice(0, 57) + "..." : query;
    return capitalize(entry.name);
  }

  // Show skill name for Skill tool calls (e.g. Claude Code's Skill tool)
  if (entry.name.toLowerCase() === "skill" && typeof input.skill === "string" && input.skill) {
    return input.skill;
  }

  return entry.name;
}

function buildOutputSummary(content: string): string {
  const lines = content.split("\n").length;
  return `${lines} line${lines === 1 ? "" : "s"} of output`;
}

function isShortOutput(content: string): boolean {
  return content.split("\n").length <= INLINE_MAX_LINES && content.length <= INLINE_MAX_CHARS;
}

/** Check if title was derived from the command (exact match or truncated version) */
function isTitleFromCommand(title: string, command: string): boolean {
  return title === command || (command.length > 60 && title === command.slice(0, 57) + "...");
}

// ─── DisplaySpecBuilder ───────────────────────────────────────────────────

export class DisplaySpecBuilder {
  constructor(private tunnelService?: TunnelServiceInterface) {}

  buildToolSpec(
    entry: ToolEntry,
    mode: OutputMode,
    sessionContext?: { id: string; workingDirectory: string },
  ): ToolDisplaySpec {
    const effectiveKind = entry.displayKind ?? entry.kind;
    const icon = KIND_ICONS[effectiveKind] ?? KIND_ICONS["other"] ?? "🛠️";
    const title = buildTitle(entry, effectiveKind);
    const isHidden = entry.isNoise && mode !== "high";

    // Fields that are always null on low
    const includeMeta = mode !== "low";

    const input = asRecord(entry.rawInput);

    // Deduplicate: skip description if it matches title, kind label, or tool name
    const rawDescription = typeof input.description === "string" ? input.description : null;
    const descLower = rawDescription?.toLowerCase();
    const description =
      includeMeta && rawDescription && rawDescription !== title
        && descLower !== effectiveKind && descLower !== entry.name.toLowerCase()
        ? rawDescription : null;

    // Deduplicate: skip command if title was derived from it
    const rawCommand =
      EXECUTE_KINDS.has(effectiveKind) && typeof input.command === "string"
        ? input.command
        : null;
    const command =
      includeMeta && rawCommand && !isTitleFromCommand(title, rawCommand)
        ? rawCommand
        : null;

    const inputContent: string | null = null;

    const content = entry.content;

    let outputSummary: string | null = null;
    let outputContent: string | null = null;
    let outputViewerLink: string | undefined = undefined;
    let outputFallbackContent: string | undefined = undefined;

    if (content && content.trim().length > 0 && includeMeta) {
      outputSummary = buildOutputSummary(content);

      const isLong = !isShortOutput(content);

      if (isLong) {
        const publicUrl = this.tunnelService?.getPublicUrl();
        const hasPublicTunnel = !!publicUrl && !publicUrl.startsWith("http://localhost") && !publicUrl.startsWith("http://127.0.0.1");
        if (this.tunnelService && sessionContext && hasPublicTunnel) {
          const label =
            typeof input.command === "string" ? input.command : entry.name;
          const id = this.tunnelService.getStore().storeOutput(sessionContext.id, label, content);
          if (id !== null) {
            outputViewerLink = this.tunnelService.outputUrl(id);
          }
        } else if (mode === "high") {
          outputFallbackContent = content;
        }
      } else if (mode === "high") {
        outputContent = content;
      }
    }

    const diffStats = includeMeta ? (entry.diffStats ?? null) : null;

    return {
      id: entry.id,
      kind: effectiveKind,
      icon,
      title,
      description,
      command,
      inputContent,
      outputSummary,
      outputContent,
      diffStats,
      viewerLinks: entry.viewerLinks,
      outputViewerLink,
      outputFallbackContent,
      status: entry.status,
      isNoise: entry.isNoise,
      isHidden,
    };
  }

  buildThoughtSpec(content: string, mode: OutputMode): ThoughtDisplaySpec {
    const indicator = "Thinking...";
    return {
      indicator,
      content: mode === "high" ? content : null,
    };
  }
}
