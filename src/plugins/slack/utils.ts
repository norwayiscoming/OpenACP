// src/adapters/slack/utils.ts
// Shared utilities for Slack adapter modules.

import type { SlackFileInfo } from "./types.js";

/** Detect Slack audio clips — MIME type or filename pattern */
export function isAudioClip(file: SlackFileInfo): boolean {
  return (file.mimetype === "video/mp4" && file.name?.startsWith("audio_message")) ||
         file.mimetype?.startsWith("audio/");
}

const SECTION_LIMIT = 3000;

/**
 * Split text at nearest newline boundary before `limit`.
 * Does NOT track code fence state — a triple-backtick block straddling
 * the boundary will be split mid-block.
 * Used by SlackFormatter and SlackTextBuffer to avoid exceeding Slack's
 * 3000-char section limit.
 */
export function splitSafe(text: string, limit = SECTION_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}
