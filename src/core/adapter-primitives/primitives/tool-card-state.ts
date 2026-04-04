import type { ToolDisplaySpec } from "../display-spec-builder.js";
import type { PlanEntry } from "../../types.js";

const DEBOUNCE_MS = 500;

export type { ToolDisplaySpec };

export interface UsageData {
  tokensUsed?: number;
  contextSize?: number;
  cost?: number;
}

export interface ToolCardSnapshot {
  specs: ToolDisplaySpec[];
  planEntries?: PlanEntry[];
  usage?: UsageData;
  totalVisible: number;
  completedVisible: number;
  allComplete: boolean;
}

export interface ToolCardStateConfig {
  onFlush: (snapshot: ToolCardSnapshot) => void;
}

const DONE_STATUSES = new Set(["completed", "done", "failed", "error"]);

export class ToolCardState {
  private specs: ToolDisplaySpec[] = [];
  private planEntries?: PlanEntry[];
  private usage?: UsageData;
  private finalized = false;
  private isFirstFlush = true;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private onFlush: (snapshot: ToolCardSnapshot) => void;

  constructor(config: ToolCardStateConfig) {
    this.onFlush = config.onFlush;
  }

  updateFromSpec(spec: ToolDisplaySpec): void {
    if (this.finalized) return;

    const existingIdx = this.specs.findIndex((s) => s.id === spec.id);
    if (existingIdx >= 0) {
      this.specs[existingIdx] = spec;
    } else {
      this.specs.push(spec);
    }

    if (this.isFirstFlush) {
      this.isFirstFlush = false;
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  updatePlan(entries: PlanEntry[]): void {
    if (this.finalized) return;
    this.planEntries = entries;

    if (this.specs.length === 0 && this.isFirstFlush) {
      this.isFirstFlush = false;
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  appendUsage(usage: UsageData): void {
    if (this.finalized) return;
    this.usage = usage;
    this.scheduleFlush();
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
    return this.specs.length > 0 || this.planEntries !== undefined;
  }

  private snapshot(): ToolCardSnapshot {
    const visible = this.specs.filter((s) => !s.isHidden);
    const completedVisible = visible.filter((s) => DONE_STATUSES.has(s.status)).length;
    const allComplete = visible.length > 0 && completedVisible === visible.length;
    return {
      specs: this.specs,
      planEntries: this.planEntries,
      usage: this.usage,
      totalVisible: visible.length,
      completedVisible,
      allComplete,
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
