// src/adapters/slack/formatter.ts
import type { types } from "@slack/bolt";
import type { OutgoingMessage, PermissionRequest } from "../../core/types.js";
import { splitSafe } from "./utils.js";

type KnownBlock = types.KnownBlock;

export interface ISlackFormatter {
  formatOutgoing(message: OutgoingMessage): KnownBlock[];
  formatPermissionRequest(req: PermissionRequest): KnownBlock[];
  formatNotification(text: string): KnownBlock[];
  formatSessionEnd(reason?: string): KnownBlock[];
}

/**
 * Convert a markdown string to Slack mrkdwn format.
 * Handles the most common patterns from AI responses.
 */
export function markdownToMrkdwn(text: string): string {
  return text
    // Fenced code blocks — preserve as-is (Slack supports ``` natively)
    // Headers: # H1 → placeholder (protected from italic regex)
    .replace(/^#{1,6}\s+(.+)$/gm, "\x00BOLD\x00$1\x00BOLD\x00")
    // Bold: **text** → placeholder
    .replace(/\*\*(.+?)\*\*/g, "\x00BOLD\x00$1\x00BOLD\x00")
    // Italic: *text* → _text_ (won't match placeholder tokens)
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_")
    // Restore bold/header placeholders → *text*
    .replace(/\x00BOLD\x00(.+?)\x00BOLD\x00/g, "*$1*")
    // Inline code: `code` — kept as-is (Slack supports backtick)
    // Strikethrough: ~~text~~ → ~text~
    .replace(/~~(.+?)~~/g, "~$1~")
    // Links: [text](url) → <url|text>
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>")
    // Unordered lists: "- item" or "* item" → "• item"
    .replace(/^[ \t]*[-*]\s+/gm, "• ")
    // Ordered lists: "1. item" → "1. item" (already fine in mrkdwn)
    .trim();
}

// Slack mrkdwn text block, max 3000 chars per section
const SECTION_LIMIT = 3000;

function section(text: string): KnownBlock {
  return { type: "section", text: { type: "mrkdwn", text: text.slice(0, SECTION_LIMIT) } };
}

function context(text: string): KnownBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

export class SlackFormatter implements ISlackFormatter {
  formatOutgoing(message: OutgoingMessage): KnownBlock[] {
    switch (message.type) {
      case "text": {
        const text = message.text ?? "";
        if (!text.trim()) return [];
        const converted = markdownToMrkdwn(text);
        return splitSafe(converted).map(chunk => section(chunk));
      }

      case "thought":
        return [context(`💭 _${(message.text ?? "").slice(0, 500)}_`)];

      case "tool_call": {
        const name = (message as OutgoingMessage & { metadata?: { name?: string; input?: unknown } }).metadata?.name ?? "tool";
        const input = (message as OutgoingMessage & { metadata?: { input?: unknown } }).metadata?.input;
        const inputStr = input ? `\n\`\`\`\n${JSON.stringify(input, null, 2).slice(0, 500)}\n\`\`\`` : "";
        return [context(`🔧 \`${name}\`${inputStr}`)];
      }

      case "tool_update": {
        const name = (message as OutgoingMessage & { metadata?: { name?: string; status?: string } }).metadata?.name ?? "tool";
        const status = (message as OutgoingMessage & { metadata?: { status?: string } }).metadata?.status ?? "done";
        const icon = status === "error" ? "❌" : "✅";
        return [context(`${icon} \`${name}\` — ${status}`)];
      }

      case "plan":
        return [
          { type: "divider" },
          section(`📋 *Plan*\n${message.text ?? ""}`),
        ];

      case "usage": {
        const meta = (message as OutgoingMessage & { metadata?: { input_tokens?: number; output_tokens?: number; cost_usd?: number } }).metadata ?? {};
        const parts = [
          meta.input_tokens != null ? `in: ${meta.input_tokens}` : null,
          meta.output_tokens != null ? `out: ${meta.output_tokens}` : null,
          meta.cost_usd != null ? `$${Number(meta.cost_usd).toFixed(4)}` : null,
        ].filter((p): p is string => p !== null);
        return parts.length ? [context(`📊 ${parts.join(" · ")}`)] : [];
      }

      case "session_end":
        return this.formatSessionEnd(message.text);

      case "error":
        return [section(`⚠️ *Error:* ${message.text ?? "Unknown error"}`)];

      default:
        return [];
    }
  }

  formatPermissionRequest(req: PermissionRequest): KnownBlock[] {
    return [
      section(`🔐 *Permission Request*\n${req.description}`),
      {
        type: "actions",
        block_id: `perm_${req.id}`,
        elements: req.options.map(opt => ({
          type: "button" as const,
          text: { type: "plain_text" as const, text: opt.label, emoji: true },
          value: `${req.id}:${opt.id}`,
          action_id: `perm_action_${opt.id}_${req.id}`,
          style: (opt.isAllow ? "primary" : "danger") as "primary" | "danger",
        })),
      } as KnownBlock,
    ];
  }

  formatNotification(text: string): KnownBlock[] {
    return [section(text)];
  }

  formatSessionEnd(reason?: string): KnownBlock[] {
    return [
      { type: "divider" },
      context(`✅ Session ended${reason ? ` — ${reason}` : ""}`),
    ];
  }
}
