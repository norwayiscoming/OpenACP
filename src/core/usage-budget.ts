import type { UsageConfig } from "./config.js";
import type { UsageStore } from "./usage-store.js";

export class UsageBudget {
  private lastNotifiedStatus: "ok" | "warning" | "exceeded" = "ok";
  private lastNotifiedMonth: number;

  constructor(
    private store: UsageStore,
    private config: UsageConfig,
    private now: () => Date = () => new Date(),
  ) {
    this.lastNotifiedMonth = this.now().getMonth();
  }

  check(): { status: "ok" | "warning" | "exceeded"; message?: string } {
    if (!this.config.monthlyBudget) {
      return { status: "ok" };
    }

    // Reset de-duplication at month boundary
    const currentMonth = this.now().getMonth();
    if (currentMonth !== this.lastNotifiedMonth) {
      this.lastNotifiedStatus = "ok";
      this.lastNotifiedMonth = currentMonth;
    }

    const { totalCost } = this.store.getMonthlyTotal();
    const budget = this.config.monthlyBudget;
    const threshold = this.config.warningThreshold;

    let status: "ok" | "warning" | "exceeded";
    if (totalCost >= budget) {
      status = "exceeded";
    } else if (totalCost >= threshold * budget) {
      status = "warning";
    } else {
      status = "ok";
    }

    // Only emit message on status change (prevents spam)
    let message: string | undefined;
    if (status !== "ok" && status !== this.lastNotifiedStatus) {
      const pct = Math.round((totalCost / budget) * 100);
      const filled = Math.round(Math.min(totalCost / budget, 1) * 10);
      const bar = "▓".repeat(filled) + "░".repeat(10 - filled);

      if (status === "warning") {
        message =
          `⚠️ <b>Budget Warning</b>\n` +
          `Monthly usage: $${totalCost.toFixed(2)} / $${budget.toFixed(2)} (${pct}%)\n` +
          `${bar} ${pct}%`;
      } else {
        message =
          `🚨 <b>Budget Exceeded</b>\n` +
          `Monthly usage: $${totalCost.toFixed(2)} / $${budget.toFixed(2)} (${pct}%)\n` +
          `${bar} ${pct}%\n` +
          `Sessions are NOT blocked — this is a warning only.`;
      }
    }

    this.lastNotifiedStatus = status;
    return { status, message };
  }

  getStatus(): {
    status: "ok" | "warning" | "exceeded";
    used: number;
    budget: number;
    percent: number;
  } {
    const { totalCost } = this.store.getMonthlyTotal();
    const budget = this.config.monthlyBudget ?? 0;

    let status: "ok" | "warning" | "exceeded" = "ok";
    if (budget > 0) {
      if (totalCost >= budget) {
        status = "exceeded";
      } else if (totalCost >= this.config.warningThreshold * budget) {
        status = "warning";
      }
    }

    const percent = budget > 0 ? Math.round((totalCost / budget) * 100) : 0;
    return { status, used: totalCost, budget, percent };
  }
}
