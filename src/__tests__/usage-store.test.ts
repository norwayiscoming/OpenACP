import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { UsageStore } from "../core/usage-store.js";
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

describe("UsageStore", () => {
  let tmpDir: string;
  let filePath: string;
  let store: UsageStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openacp-usage-test-"));
    filePath = path.join(tmpDir, "usage.json");
    store = new UsageStore(filePath, 90);
  });

  afterEach(() => {
    store.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends and queries records", () => {
    const record = makeRecord();
    store.append(record);
    const summary = store.query("all");
    expect(summary.totalTokens).toBe(1000);
    expect(summary.totalCost).toBe(0.05);
    expect(summary.sessionCount).toBe(1);
    expect(summary.recordCount).toBe(1);
  });

  it("aggregates multiple records", () => {
    store.append(makeRecord({ id: "r1", sessionId: "s1", tokensUsed: 1000, cost: { amount: 0.05, currency: "USD" } }));
    store.append(makeRecord({ id: "r2", sessionId: "s1", tokensUsed: 2000, cost: { amount: 0.10, currency: "USD" } }));
    store.append(makeRecord({ id: "r3", sessionId: "s2", tokensUsed: 500, cost: { amount: 0.02, currency: "USD" } }));
    const summary = store.query("all");
    expect(summary.totalTokens).toBe(3500);
    expect(summary.totalCost).toBeCloseTo(0.17);
    expect(summary.sessionCount).toBe(2);
    expect(summary.recordCount).toBe(3);
  });

  it("filters by today", () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0); // midnight yesterday

    store.append(makeRecord({ id: "r1", timestamp: yesterday.toISOString(), tokensUsed: 500 }));
    store.append(makeRecord({ id: "r2", timestamp: now.toISOString(), tokensUsed: 1000 }));

    const summary = store.query("today");
    expect(summary.totalTokens).toBe(1000);
    expect(summary.recordCount).toBe(1);
  });

  it("filters by week", () => {
    const now = new Date();
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    store.append(makeRecord({ id: "r1", timestamp: twoWeeksAgo.toISOString(), tokensUsed: 500 }));
    store.append(makeRecord({ id: "r2", timestamp: now.toISOString(), tokensUsed: 1000 }));

    const summary = store.query("week");
    expect(summary.totalTokens).toBe(1000);
    expect(summary.recordCount).toBe(1);
  });

  it("filters by month (current calendar month)", () => {
    const now = new Date();
    const lastMonth = new Date(now);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    lastMonth.setDate(15);

    store.append(makeRecord({ id: "r1", timestamp: lastMonth.toISOString(), tokensUsed: 500 }));
    store.append(makeRecord({ id: "r2", timestamp: now.toISOString(), tokensUsed: 1000 }));

    const summary = store.query("month");
    expect(summary.totalTokens).toBe(1000);
    expect(summary.recordCount).toBe(1);
  });

  it("handles records without cost", () => {
    store.append(makeRecord({ id: "r1", cost: undefined }));
    const summary = store.query("all");
    expect(summary.totalTokens).toBe(1000);
    expect(summary.totalCost).toBe(0);
  });

  it("flushes to disk synchronously", () => {
    store.append(makeRecord());
    store.flushSync();
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.records).toHaveLength(1);
    expect(raw.records[0].id).toBe("rec-1");
  });

  it("loads from existing file", () => {
    store.append(makeRecord());
    store.flushSync();
    store.destroy();

    const store2 = new UsageStore(filePath, 90);
    const summary = store2.query("all");
    expect(summary.recordCount).toBe(1);
    store2.destroy();
  });

  it("handles corrupt file gracefully", () => {
    fs.writeFileSync(filePath, "NOT VALID JSON{{{");
    const store2 = new UsageStore(filePath, 90);
    const summary = store2.query("all");
    expect(summary.recordCount).toBe(0);
    // Should create backup
    expect(fs.existsSync(filePath + ".bak")).toBe(true);
    store2.destroy();
  });

  it("cleans up old records", () => {
    const old = new Date();
    old.setDate(old.getDate() - 100); // older than 90 days
    store.append(makeRecord({ id: "old", timestamp: old.toISOString() }));
    store.append(makeRecord({ id: "new", timestamp: new Date().toISOString() }));
    store.cleanup();
    const summary = store.query("all");
    expect(summary.recordCount).toBe(1);
  });

  it("getMonthlyTotal returns current calendar month total", () => {
    const now = new Date();
    const lastMonth = new Date(now);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    lastMonth.setDate(15);

    store.append(makeRecord({ id: "r1", timestamp: lastMonth.toISOString(), cost: { amount: 5.00, currency: "USD" } }));
    store.append(makeRecord({ id: "r2", timestamp: now.toISOString(), cost: { amount: 3.00, currency: "USD" } }));

    const total = store.getMonthlyTotal();
    expect(total.totalCost).toBe(3.00);
  });

  it("query('month') and getMonthlyTotal() use the same time range", () => {
    const now = new Date();
    store.append(makeRecord({ id: "r1", timestamp: now.toISOString(), cost: { amount: 7.50, currency: "USD" } }));

    const queryResult = store.query("month");
    const monthlyTotal = store.getMonthlyTotal();
    expect(queryResult.totalCost).toBe(monthlyTotal.totalCost);
  });
});
