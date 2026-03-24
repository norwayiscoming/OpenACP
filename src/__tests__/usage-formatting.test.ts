import { describe, it, expect } from "vitest";
import { formatUsageReport } from "../adapters/telegram/formatting.js";
import type { UsageSummary } from "../core/types.js";

describe("formatUsageReport", () => {
  it("formats all periods with budget", () => {
    const today: UsageSummary = {
      period: "today", totalTokens: 189234, totalCost: 0.80,
      currency: "USD", sessionCount: 3, recordCount: 5,
    };
    const week: UsageSummary = {
      period: "week", totalTokens: 756123, totalCost: 3.20,
      currency: "USD", sessionCount: 12, recordCount: 25,
    };
    const month: UsageSummary = {
      period: "month", totalTokens: 1234567, totalCost: 5.40,
      currency: "USD", sessionCount: 23, recordCount: 60,
    };
    const budgetStatus = { status: "ok" as const, used: 5.40, budget: 10.0, percent: 54 };

    const result = formatUsageReport([month, week, today], budgetStatus);
    expect(result).toContain("Usage Report");
    expect(result).toContain("$5.40");
    expect(result).toContain("$10.00");
    expect(result).toContain("54%");
    expect(result).toContain("189k");
    expect(result).toContain("3 sessions");
  });

  it("formats single period", () => {
    const today: UsageSummary = {
      period: "today", totalTokens: 1000, totalCost: 0.05,
      currency: "USD", sessionCount: 1, recordCount: 1,
    };
    const budgetStatus = { status: "ok" as const, used: 0.05, budget: 10.0, percent: 1 };

    const result = formatUsageReport([today], budgetStatus);
    expect(result).toContain("Usage Report");
    expect(result).toContain("Today");
    expect(result).not.toContain("This Month");
    expect(result).not.toContain("This Week");
  });

  it("formats without budget", () => {
    const today: UsageSummary = {
      period: "today", totalTokens: 1000, totalCost: 0.05,
      currency: "USD", sessionCount: 1, recordCount: 1,
    };
    const budgetStatus = { status: "ok" as const, used: 0.05, budget: 0, percent: 0 };

    const result = formatUsageReport([today], budgetStatus);
    expect(result).toContain("Usage Report");
    expect(result).not.toContain("Budget");
  });

  it("returns empty message when no data", () => {
    const empty: UsageSummary = {
      period: "today", totalTokens: 0, totalCost: 0,
      currency: "USD", sessionCount: 0, recordCount: 0,
    };
    const budgetStatus = { status: "ok" as const, used: 0, budget: 0, percent: 0 };

    const result = formatUsageReport([empty], budgetStatus);
    expect(result).toContain("No usage data yet");
  });
});
