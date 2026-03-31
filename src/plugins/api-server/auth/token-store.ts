import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { StoredToken, CreateTokenOpts } from './types.js';

const REFRESH_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;

function generateTokenId(): string {
  return `tok_${randomBytes(12).toString('hex')}`;
}

export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(h|d|m)$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: throw new Error(`Invalid duration unit: ${match[2]}`);
  }
}

export class TokenStore {
  private tokens = new Map<string, StoredToken>();
  private savePromise: Promise<void> | null = null;
  private savePending = false;

  constructor(private filePath: string) {}

  async load(): Promise<void> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      let parsed: { tokens: StoredToken[] };
      try {
        parsed = JSON.parse(data) as { tokens: StoredToken[] };
      } catch {
        console.warn(`[TokenStore] Failed to parse ${this.filePath} — retaining existing tokens`);
        return;
      }
      this.tokens.clear();
      for (const token of parsed.tokens) {
        this.tokens.set(token.id, token);
      }
    } catch {
      // File does not exist yet — start with empty store
      this.tokens.clear();
    }
  }

  async save(): Promise<void> {
    const data = { tokens: Array.from(this.tokens.values()) };
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private scheduleSave(): void {
    if (this.savePromise) {
      this.savePending = true;
      return;
    }
    this.savePromise = this.save()
      .catch(() => {})
      .finally(() => {
        this.savePromise = null;
        if (this.savePending) {
          this.savePending = false;
          this.scheduleSave();
        }
      });
  }

  create(opts: CreateTokenOpts): StoredToken {
    const now = new Date();
    const token: StoredToken = {
      id: generateTokenId(),
      name: opts.name,
      role: opts.role,
      scopes: opts.scopes,
      createdAt: now.toISOString(),
      refreshDeadline: new Date(now.getTime() + REFRESH_DEADLINE_MS).toISOString(),
      revoked: false,
    };
    this.tokens.set(token.id, token);
    this.scheduleSave();
    return token;
  }

  get(id: string): StoredToken | undefined {
    return this.tokens.get(id);
  }

  revoke(id: string): void {
    const token = this.tokens.get(id);
    if (token) {
      token.revoked = true;
      this.scheduleSave();
    }
  }

  list(): StoredToken[] {
    return Array.from(this.tokens.values()).filter((t) => !t.revoked);
  }

  private lastUsedSaveTimer: ReturnType<typeof setTimeout> | null = null;

  updateLastUsed(id: string): void {
    const token = this.tokens.get(id);
    if (token) {
      token.lastUsedAt = new Date().toISOString();
      // Debounce persist — batch lastUsedAt updates every 60s
      if (!this.lastUsedSaveTimer) {
        this.lastUsedSaveTimer = setTimeout(() => {
          this.lastUsedSaveTimer = null;
          this.scheduleSave();
        }, 60_000);
      }
    }
  }

  destroy(): void {
    if (this.lastUsedSaveTimer) {
      clearTimeout(this.lastUsedSaveTimer);
      this.lastUsedSaveTimer = null;
    }
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, token] of this.tokens) {
      if (new Date(token.refreshDeadline).getTime() < now) {
        this.tokens.delete(id);
      }
    }
    this.scheduleSave();
  }
}
