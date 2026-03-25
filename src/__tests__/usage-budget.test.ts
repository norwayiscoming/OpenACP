import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { UsageStore } from "../core/usage-store.js";
import { UsageBudget } from "../core/usage-budget.js";
import type { UsageConfig } from "../core/config.js";
import type { UsageRecord } from "../core/types.js";

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: "rec-1",
    sessionId: "sess-1",
    agentName: "claude",
    tokensUsed: 1000,
    contextSize: 200000,
    cost: { amount: 0.05, currency: "USD" },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("UsageBudget", () => {
  let tmpDir: string;
  let store: UsageStore;
  let config: UsageConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openacp-budget-test-"));
    store = new UsageStore(path.join(tmpDir, "usage.json"), 90);
    config = {
      enabled: true,
      monthlyBudget: 10.0,
      warningThreshold: 0.8,
      currency: "USD",
      retentionDays: 90,
    };
  });

  afterEach(() => {
    store.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns ok when under threshold", () => {
    store.append(makeRecord({ cost: { amount: 5.0, currency: "USD" } }));
    const budget = new UsageBudget(store, config);
    const result = budget.check();
    expect(result.status).toBe("ok");
    expect(result.message).toBeUndefined();
  });

  it("returns warning when at threshold", () => {
    store.append(makeRecord({ cost: { amount: 8.5, currency: "USD" } }));
    const budget = new UsageBudget(store, config);
    const result = budget.check();
    expect(result.status).toBe("warning");
    expect(result.message).toContain("Budget Warning");
  });

  it("returns exceeded when over budget", () => {
    store.append(makeRecord({ cost: { amount: 11.0, currency: "USD" } }));
    const budget = new UsageBudget(store, config);
    const result = budget.check();
    expect(result.status).toBe("exceeded");
    expect(result.message).toContain("Budget Exceeded");
  });

  it("de-duplicates notifications (same status → no message second time)", () => {
    store.append(makeRecord({ cost: { amount: 8.5, currency: "USD" } }));
    const budget = new UsageBudget(store, config);
    const first = budget.check();
    expect(first.message).toBeDefined();
    const second = budget.check();
    expect(second.status).toBe("warning");
    expect(second.message).toBeUndefined();
  });

  it("sends new message when status escalates from warning to exceeded", () => {
    store.append(makeRecord({ id: "r1", cost: { amount: 8.5, currency: "USD" } }));
    const budget = new UsageBudget(store, config);
    budget.check(); // warning
    store.append(makeRecord({ id: "r2", cost: { amount: 2.0, currency: "USD" } }));
    const result = budget.check(); // now exceeded
    expect(result.status).toBe("exceeded");
    expect(result.message).toContain("Budget Exceeded");
  });

  it("returns ok when no monthlyBudget configured", () => {
    store.append(makeRecord({ cost: { amount: 100.0, currency: "USD" } }));
    const budget = new UsageBudget(store, { ...config, monthlyBudget: undefined });
    const result = budget.check();
    expect(result.status).toBe("ok");
    expect(result.message).toBeUndefined();
  });

  it("getStatus returns current state for display", () => {
    store.append(makeRecord({ cost: { amount: 5.0, currency: "USD" } }));
    const budget = new UsageBudget(store, config);
    const status = budget.getStatus();
    expect(status.status).toBe("ok");
    expect(status.used).toBe(5.0);
    expect(status.budget).toBe(10.0);
    expect(status.percent).toBe(50);
  });

  it("getStatus returns 0 percent when no budget set", () => {
    const budget = new UsageBudget(store, { ...config, monthlyBudget: undefined });
    const status = budget.getStatus();
    expect(status.percent).toBe(0);
    expect(status.budget).toBe(0);
  });

  it("resets de-duplication at month boundary", () => {
    store.append(makeRecord({ cost: { amount: 8.5, currency: "USD" } }));

    // Use injectable date provider to simulate month change
    let currentDate = new Date();
    const budget = new UsageBudget(store, config, () => currentDate);
    const first = budget.check();
    expect(first.message).toBeDefined(); // warning sent

    const second = budget.check();
    expect(second.message).toBeUndefined(); // de-duplicated

    // Advance to next month
    currentDate = new Date(currentDate);
    currentDate.setMonth(currentDate.getMonth() + 1);

    // Cost is still above threshold, but month changed → should re-notify
    const result = budget.check();
    expect(result.message).toBeDefined();
  });
});
