// src/adapters/slack/slug.ts
import { customAlphabet } from "nanoid";

const nanoidAlpha = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 4);

/**
 * Convert a human-readable session name to a valid Slack channel name.
 * Rules: lowercase, ≤80 chars, only [a-z0-9-], unique suffix appended.
 *
 * Examples:
 *   "Fix authentication bug"            → "openacp-fix-authentication-bug-a3k9"
 *   "New Session"                       → "openacp-new-session-x7p2"
 *   "Implement OAuth 2.0 & JWT refresh" → "openacp-implement-oauth-20-jwt-refresh-b8qr"
 */
export function toSlug(name: string, prefix = "openacp"): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")   // strip special chars
    .trim()
    .replace(/\s+/g, "-")            // spaces → dashes
    .replace(/-+/g, "-")             // collapse consecutive dashes
    .slice(0, 60);                   // leave room for prefix and suffix

  const suffix = nanoidAlpha();
  return `${prefix}-${base}-${suffix}`.replace(/-+/g, "-");
}
