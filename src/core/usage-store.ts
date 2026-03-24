import fs from "node:fs";
import path from "node:path";
import type { UsageRecord, UsageSummary } from "./types.js";
import { createChildLogger } from "./log.js";

const log = createChildLogger({ module: "usage-store" });

interface StoreFile {
  version: number;
  records: UsageRecord[];
}

const DEBOUNCE_MS = 2000;

export class UsageStore {
  private records: UsageRecord[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private flushHandler: (() => void) | null = null;

  constructor(
    private filePath: string,
    private retentionDays: number,
  ) {
    this.load();
    this.cleanup();

    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      24 * 60 * 60 * 1000,
    );

    this.flushHandler = () => {
      try {
        this.flushSync();
      } catch {
        // Best effort — don't block other exit handlers (e.g., session store flush)
      }
    };
    process.on("SIGTERM", this.flushHandler);
    process.on("SIGINT", this.flushHandler);
    process.on("exit", this.flushHandler);
  }

  append(record: UsageRecord): void {
    this.records.push(record);
    this.scheduleDiskWrite();
  }

  query(period: "today" | "week" | "month" | "all"): UsageSummary {
    const cutoff = this.getCutoff(period);
    const filtered = cutoff
      ? this.records.filter((r) => new Date(r.timestamp).getTime() >= cutoff)
      : this.records;

    const totalTokens = filtered.reduce((sum, r) => sum + r.tokensUsed, 0);
    const totalCost = filtered.reduce(
      (sum, r) => sum + (r.cost?.amount ?? 0),
      0,
    );
    const sessionIds = new Set(filtered.map((r) => r.sessionId));
    const currency =
      filtered.find((r) => r.cost?.currency)?.cost?.currency ?? "USD";

    return {
      period,
      totalTokens,
      totalCost,
      currency,
      sessionCount: sessionIds.size,
      recordCount: filtered.length,
    };
  }

  getMonthlyTotal(): { totalCost: number; currency: string } {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const cutoff = startOfMonth.getTime();

    const filtered = this.records.filter(
      (r) => new Date(r.timestamp).getTime() >= cutoff,
    );
    const totalCost = filtered.reduce(
      (sum, r) => sum + (r.cost?.amount ?? 0),
      0,
    );
    const currency =
      filtered.find((r) => r.cost?.currency)?.cost?.currency ?? "USD";

    return { totalCost, currency };
  }

  cleanup(): void {
    const cutoff =
      Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const before = this.records.length;
    this.records = this.records.filter(
      (r) => new Date(r.timestamp).getTime() >= cutoff,
    );
    const removed = before - this.records.length;
    if (removed > 0) {
      log.info({ removed }, "Cleaned up expired usage records");
      this.scheduleDiskWrite();
    }
  }

  flushSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const data: StoreFile = { version: 1, records: this.records };
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  destroy(): void {
    if (this.debounceTimer) this.flushSync();
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.flushHandler) {
      process.removeListener("SIGTERM", this.flushHandler);
      process.removeListener("SIGINT", this.flushHandler);
      process.removeListener("exit", this.flushHandler);
      this.flushHandler = null;
    }
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.filePath, "utf-8"),
      ) as StoreFile;
      if (raw.version !== 1) {
        log.warn(
          { version: raw.version },
          "Unknown usage store version, skipping load",
        );
        return;
      }
      this.records = raw.records || [];
      log.info({ count: this.records.length }, "Loaded usage records");
    } catch (err) {
      log.error({ err }, "Failed to load usage store, backing up corrupt file");
      try {
        fs.copyFileSync(this.filePath, this.filePath + ".bak");
      } catch {
        /* best effort */
      }
      this.records = [];
    }
  }

  private getCutoff(
    period: "today" | "week" | "month" | "all",
  ): number | null {
    const now = new Date();
    switch (period) {
      case "today": {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return start.getTime();
      }
      case "week":
        return Date.now() - 7 * 24 * 60 * 60 * 1000;
      case "month": {
        // Use current calendar month (1st of month), consistent with getMonthlyTotal()
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return startOfMonth.getTime();
      }
      case "all":
        return null;
    }
  }

  private scheduleDiskWrite(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.flushSync();
    }, DEBOUNCE_MS);
  }
}
