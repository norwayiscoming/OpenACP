import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsageBudget } from "../usage-budget.js";
import type { UsageStore } from "../usage-store.js";
import type { UsageConfig } from "../config.js";

function createMockStore(monthlyTotal = 0): UsageStore {
  return {
    getMonthlyTotal: vi.fn().mockReturnValue({
      totalCost: monthlyTotal,
      currency: "USD",
    }),
    append: vi.fn(),
    query: vi.fn(),
    cleanup: vi.fn(),
    flushSync: vi.fn(),
    destroy: vi.fn(),
  } as any;
}

function createConfig(
  monthlyBudget?: number,
  warningThreshold = 0.8,
): UsageConfig {
  return {
    enabled: true,
    retentionDays: 90,
    monthlyBudget,
    warningThreshold,
  } as UsageConfig;
}

describe("UsageBudget — Comprehensive Boundary Tests", () => {
  describe("basic status determination", () => {
    it("returns ok when no budget configured", () => {
      const store = createMockStore(100);
      const budget = new UsageBudget(store, createConfig(undefined));

      const result = budget.check();
      expect(result.status).toBe("ok");
      expect(result.message).toBeUndefined();
    });

    it("returns ok when under warning threshold", () => {
      const store = createMockStore(7); // 70% of $10
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      expect(budget.check().status).toBe("ok");
    });

    it("returns warning when at warning threshold (exact boundary)", () => {
      const store = createMockStore(8); // exactly 80% of $10
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      const result = budget.check();
      expect(result.status).toBe("warning");
      expect(result.message).toContain("Budget Warning");
    });

    it("returns warning when between threshold and budget", () => {
      const store = createMockStore(9); // 90% of $10
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      expect(budget.check().status).toBe("warning");
    });

    it("returns exceeded when at budget (exact boundary)", () => {
      const store = createMockStore(10); // exactly $10
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      const result = budget.check();
      expect(result.status).toBe("exceeded");
      expect(result.message).toContain("Budget Exceeded");
    });

    it("returns exceeded when over budget", () => {
      const store = createMockStore(15); // 150% of $10
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      expect(budget.check().status).toBe("exceeded");
    });
  });

  describe("message de-duplication", () => {
    it("emits message only on first status change", () => {
      const store = createMockStore(8);
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      const first = budget.check();
      expect(first.message).toBeDefined();

      const second = budget.check();
      expect(second.status).toBe("warning");
      expect(second.message).toBeUndefined(); // de-duplicated
    });

    it("emits new message when escalating from warning to exceeded", () => {
      let cost = 8;
      const store = {
        getMonthlyTotal: vi.fn(() => ({
          totalCost: cost,
          currency: "USD",
        })),
      } as any;
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      const warn = budget.check();
      expect(warn.status).toBe("warning");
      expect(warn.message).toContain("Warning");

      cost = 12;
      const exceeded = budget.check();
      expect(exceeded.status).toBe("exceeded");
      expect(exceeded.message).toContain("Exceeded");
    });

    it("does not emit message when returning to ok", () => {
      let cost = 8;
      const store = {
        getMonthlyTotal: vi.fn(() => ({
          totalCost: cost,
          currency: "USD",
        })),
      } as any;
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      budget.check(); // warning with message

      cost = 5; // back to ok
      const result = budget.check();
      expect(result.status).toBe("ok");
      expect(result.message).toBeUndefined();
    });

    it("re-emits warning after going back to ok then warning again", () => {
      let cost = 8;
      const store = {
        getMonthlyTotal: vi.fn(() => ({
          totalCost: cost,
          currency: "USD",
        })),
      } as any;
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      budget.check(); // warning

      cost = 3; // ok
      budget.check();

      cost = 9; // warning again
      const result = budget.check();
      // lastNotifiedStatus was set to "warning" then "ok" is not tracked...
      // Actually looking at the code: lastNotifiedStatus is set to "ok" only if status === "ok"?
      // No — the code sets lastNotifiedStatus = status always at the end
      // So warning → ok → warning should re-emit
      expect(result.status).toBe("warning");
      expect(result.message).toBeDefined();
    });
  });

  describe("month boundary reset", () => {
    it("resets de-duplication at month boundary", () => {
      let currentMonth = 0;
      const store = createMockStore(9);
      const budget = new UsageBudget(
        store,
        createConfig(10, 0.8),
        () => {
          const d = new Date(2024, currentMonth, 15);
          return d;
        },
      );

      const first = budget.check();
      expect(first.message).toBeDefined();

      // Same month — no new message
      const second = budget.check();
      expect(second.message).toBeUndefined();

      // New month
      currentMonth = 1;
      const third = budget.check();
      expect(third.message).toBeDefined(); // reset, so new message
    });
  });

  describe("getStatus()", () => {
    it("returns status, used, budget, percent", () => {
      const store = createMockStore(8);
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      const status = budget.getStatus();
      expect(status).toEqual({
        status: "warning",
        used: 8,
        budget: 10,
        percent: 80,
      });
    });

    it("returns 0% when budget is 0", () => {
      const store = createMockStore(5);
      const budget = new UsageBudget(store, createConfig(0));

      const status = budget.getStatus();
      expect(status.percent).toBe(0);
      expect(status.status).toBe("ok");
    });

    it("returns 0% when no budget configured", () => {
      const store = createMockStore(5);
      const budget = new UsageBudget(store, createConfig(undefined));

      const status = budget.getStatus();
      expect(status.percent).toBe(0);
      expect(status.budget).toBe(0);
    });

    it("rounds percent to nearest integer", () => {
      const store = createMockStore(3.33);
      const budget = new UsageBudget(store, createConfig(10));

      const status = budget.getStatus();
      expect(status.percent).toBe(33); // Math.round(33.3)
    });
  });

  describe("warning threshold edge cases", () => {
    it("threshold of 1.0 means warning only at 100%", () => {
      const store = createMockStore(9.99);
      const budget = new UsageBudget(store, createConfig(10, 1.0));

      // 99.9% is below 100% threshold, so ok
      expect(budget.check().status).toBe("ok");
    });

    it("threshold of 0 means any usage triggers warning", () => {
      const store = createMockStore(0.01);
      const budget = new UsageBudget(store, createConfig(10, 0));

      expect(budget.check().status).toBe("warning");
    });

    it("threshold of 0.5 triggers at 50%", () => {
      const store = createMockStore(5);
      const budget = new UsageBudget(store, createConfig(10, 0.5));

      expect(budget.check().status).toBe("warning");
    });
  });

  describe("message content format", () => {
    it("warning message includes dollar amounts and progress bar", () => {
      const store = createMockStore(8.5);
      const budget = new UsageBudget(store, createConfig(10, 0.8));

      const result = budget.check();
      expect(result.message).toContain("$8.50");
      expect(result.message).toContain("$10.00");
      expect(result.message).toContain("85%");
      expect(result.message).toContain("▓");
    });

    it("exceeded message includes warning that sessions are not blocked", () => {
      const store = createMockStore(12);
      const budget = new UsageBudget(store, createConfig(10));

      const result = budget.check();
      expect(result.message).toContain("NOT blocked");
    });
  });
});
