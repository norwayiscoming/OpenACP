import type {
  ToolCallMeta,
  ViewerLinks,
  DisplayVerbosity,
} from "../format-types.js";
import type { PlanEntry } from "../../types.js";
import {
  evaluateNoise,
  formatToolSummary,
  resolveToolIcon,
} from "../message-formatter.js";

const DEBOUNCE_MS = 500;

export interface ToolCardEntry {
  id: string;
  name: string;
  kind?: string;
  status: string;
  icon: string;
  label: string;
  viewerLinks?: ViewerLinks;
  viewerFilePath?: string;
  hidden: boolean;
}

export interface UsageData {
  tokensUsed?: number;
  contextSize?: number;
  cost?: number;
}

export interface ToolCardSnapshot {
  entries: ToolCardEntry[];
  planEntries?: PlanEntry[];
  usage?: UsageData;
  visibleCount: number;
  totalVisible: number;
  completedVisible: number;
  allComplete: boolean;
  verbosity: DisplayVerbosity;
}

export interface ToolCardStateConfig {
  onFlush: (snapshot: ToolCardSnapshot) => void;
  verbosity: DisplayVerbosity;
}

export class ToolCardState {
  private entries: ToolCardEntry[] = [];
  private planEntries?: PlanEntry[];
  private usage?: UsageData;
  private finalized = false;
  private isFirstFlush = true;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private verbosity: DisplayVerbosity;
  private onFlush: (snapshot: ToolCardSnapshot) => void;

  constructor(config: ToolCardStateConfig) {
    this.verbosity = config.verbosity;
    this.onFlush = config.onFlush;
  }

  addTool(meta: ToolCallMeta, kind: string, rawInput: unknown): void {
    if (this.finalized) return;

    const hidden =
      this.verbosity !== "high" &&
      evaluateNoise(meta.name, kind, rawInput) !== null;
    const entry: ToolCardEntry = {
      id: meta.id,
      name: meta.name,
      kind,
      status: meta.status ?? "running",
      icon: resolveToolIcon({ status: meta.status ?? "running", kind }),
      label: formatToolSummary(meta.name, rawInput, meta.displaySummary),
      viewerLinks: meta.viewerLinks,
      viewerFilePath: meta.viewerFilePath,
      hidden,
    };
    this.entries.push(entry);

    if (this.isFirstFlush) {
      this.isFirstFlush = false;
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  updateTool(
    id: string,
    status: string,
    viewerLinks?: ViewerLinks,
    viewerFilePath?: string,
  ): void {
    if (this.finalized) return;

    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;

    entry.status = status;
    entry.icon = resolveToolIcon({ status, kind: entry.kind });
    if (viewerLinks) entry.viewerLinks = viewerLinks;
    if (viewerFilePath) entry.viewerFilePath = viewerFilePath;

    this.scheduleFlush();
  }

  updatePlan(entries: PlanEntry[]): void {
    if (this.finalized) return;
    this.planEntries = entries;

    if (this.entries.length === 0 && this.isFirstFlush) {
      this.isFirstFlush = false;
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  appendUsage(usage: UsageData): void {
    if (this.finalized) return;
    this.usage = usage;
    this.flush();
  }

  finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.clearDebounce();
    this.flush();
  }

  destroy(): void {
    this.finalized = true;
    this.clearDebounce();
  }

  hasContent(): boolean {
    return this.entries.length > 0 || this.planEntries !== undefined;
  }

  private snapshot(): ToolCardSnapshot {
    const visible = this.entries.filter((e) => !e.hidden);
    const completedVisible = visible.filter(
      (e) => e.status === "completed" || e.status === "done",
    ).length;
    const allComplete =
      visible.length > 0 && completedVisible === visible.length;

    return {
      entries: this.entries,
      planEntries: this.planEntries,
      usage: this.usage,
      visibleCount: visible.length,
      totalVisible: visible.length,
      completedVisible,
      allComplete,
      verbosity: this.verbosity,
    };
  }

  private flush(): void {
    this.clearDebounce();
    this.onFlush(this.snapshot());
  }

  private scheduleFlush(): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.flush();
    }, DEBOUNCE_MS);
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}
