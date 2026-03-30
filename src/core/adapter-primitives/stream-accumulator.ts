// src/core/adapter-primitives/stream-accumulator.ts

import type { ToolCallMeta, ViewerLinks } from "./format-types.js";
import { evaluateNoise } from "./message-formatter.js";

export interface ToolEntry {
  id: string;
  name: string;
  kind: string;
  rawInput: unknown;
  content: string | null;
  status: string;
  viewerLinks?: ViewerLinks;
  diffStats?: { added: number; removed: number };
  displaySummary?: string;
  displayTitle?: string;
  displayKind?: string;
  isNoise: boolean;
}

interface PendingUpdate {
  status: string;
  rawInput?: unknown;
  content?: string | null;
  viewerLinks?: ViewerLinks;
  diffStats?: { added: number; removed: number };
}

export class ToolStateMap {
  private entries: Map<string, ToolEntry> = new Map();
  private pendingUpdates: Map<string, PendingUpdate> = new Map();

  /**
   * Creates or updates an entry from a tool_call event.
   * If a pending update exists for this id, applies it immediately.
   */
  upsert(meta: ToolCallMeta, kind: string, rawInput: unknown): ToolEntry {
    const isNoise = evaluateNoise(meta.name, kind, rawInput) !== null;

    const entry: ToolEntry = {
      id: meta.id,
      name: meta.name,
      kind,
      rawInput,
      content: null,
      status: meta.status ?? "running",
      viewerLinks: meta.viewerLinks,
      displaySummary: meta.displaySummary,
      displayTitle: meta.displayTitle,
      displayKind: meta.displayKind,
      isNoise,
    };

    this.entries.set(meta.id, entry);

    // Apply any pending update that arrived before the initial call
    const pending = this.pendingUpdates.get(meta.id);
    if (pending) {
      this.pendingUpdates.delete(meta.id);
      this._applyUpdate(entry, pending);
    }

    return entry;
  }

  /**
   * Updates an existing entry from a tool_call_update event.
   * If the entry doesn't exist yet (out-of-order delivery), buffers the update.
   */
  merge(
    id: string,
    status: string,
    rawInput?: unknown,
    content?: string | null,
    viewerLinks?: ViewerLinks,
    diffStats?: { added: number; removed: number },
  ): ToolEntry | undefined {
    const entry = this.entries.get(id);

    if (!entry) {
      // Buffer the update for when upsert is called
      this.pendingUpdates.set(id, { status, rawInput, content, viewerLinks, diffStats });
      return undefined;
    }

    this._applyUpdate(entry, { status, rawInput, content, viewerLinks, diffStats });
    return entry;
  }

  private _applyUpdate(entry: ToolEntry, update: PendingUpdate): void {
    entry.status = update.status;
    if (update.rawInput !== undefined) {
      entry.rawInput = update.rawInput;
    }
    if (update.content !== undefined) {
      entry.content = update.content ?? null;
    }
    if (update.viewerLinks !== undefined) {
      entry.viewerLinks = update.viewerLinks;
    }
    if (update.diffStats !== undefined) {
      entry.diffStats = update.diffStats;
    }
  }

  get(id: string): ToolEntry | undefined {
    return this.entries.get(id);
  }

  clear(): void {
    this.entries.clear();
    this.pendingUpdates.clear();
  }
}

export class ThoughtBuffer {
  private chunks: string[] = [];
  private sealed = false;

  append(chunk: string): void {
    if (this.sealed) return;
    this.chunks.push(chunk);
  }

  seal(): string {
    this.sealed = true;
    return this.chunks.join("");
  }

  getText(): string {
    return this.chunks.join("");
  }

  isSealed(): boolean {
    return this.sealed;
  }

  reset(): void {
    this.chunks = [];
    this.sealed = false;
  }
}
