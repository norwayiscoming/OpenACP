import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolCardState } from "../tool-card-state.js";
import type { ToolCallMeta } from "../../format-types.js";

function makeTool(
  id: string,
  name: string,
  overrides?: Partial<ToolCallMeta>,
): ToolCallMeta {
  return { id, name, status: "running", ...overrides };
}

describe("ToolCardState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("addTool appends entry and calls onFlush", async () => {
    const onFlush = vi.fn();
    const card = new ToolCardState({ onFlush, verbosity: "medium" });
    card.addTool(makeTool("t1", "Read"), "read", { file_path: "src/main.ts" });
    expect(onFlush).toHaveBeenCalledTimes(1);
    const state = onFlush.mock.calls[0][0];
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].id).toBe("t1");
    expect(state.entries[0].hidden).toBe(false);
    card.destroy();
  });

  it("subsequent tools debounce 500ms", async () => {
    const onFlush = vi.fn();
    const card = new ToolCardState({ onFlush, verbosity: "medium" });
    card.addTool(makeTool("t1", "Read"), "read", { file_path: "src/a.ts" });
    expect(onFlush).toHaveBeenCalledTimes(1);
    card.addTool(makeTool("t2", "Edit"), "edit", { file_path: "src/b.ts" });
    expect(onFlush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(onFlush).toHaveBeenCalledTimes(2);
    card.destroy();
  });

  it("updateTool changes entry status", () => {
    const onFlush = vi.fn();
    const card = new ToolCardState({ onFlush, verbosity: "medium" });
    card.addTool(makeTool("t1", "Read"), "read", { file_path: "src/a.ts" });
    card.updateTool("t1", "completed", { file: "http://example.com/file" });
    vi.advanceTimersByTime(500);
    const state = onFlush.mock.lastCall![0];
    expect(state.entries[0].status).toBe("completed");
    expect(state.entries[0].viewerLinks).toEqual({
      file: "http://example.com/file",
    });
    card.destroy();
  });

  it("hides noise tools on low/medium verbosity", () => {
    const onFlush = vi.fn();
    const card = new ToolCardState({ onFlush, verbosity: "medium" });
    card.addTool(makeTool("t1", "ls"), "other", {});
    card.addTool(makeTool("t2", "Grep"), "search", {});
    card.addTool(makeTool("t3", "Read"), "read", { file_path: "src/a.ts" });
    vi.advanceTimersByTime(500);
    const state = onFlush.mock.lastCall![0];
    expect(state.entries[0].hidden).toBe(true);
    expect(state.entries[1].hidden).toBe(true);
    expect(state.entries[2].hidden).toBe(false);
    card.destroy();
  });

  it("shows noise tools on high verbosity", () => {
    const onFlush = vi.fn();
    const card = new ToolCardState({ onFlush, verbosity: "high" });
    card.addTool(makeTool("t1", "ls"), "other", {});
    card.addTool(makeTool("t2", "Grep"), "search", {});
    vi.advanceTimersByTime(500);
    const state = onFlush.mock.lastCall![0];
    expect(state.entries[0].hidden).toBe(false);
    expect(state.entries[1].hidden).toBe(false);
    card.destroy();
  });

  it("updatePlan sets plan entries", () => {
    const onFlush = vi.fn();
    const card = new ToolCardState({ onFlush, verbosity: "medium" });
    card.addTool(makeTool("t1", "Read"), "read", { file_path: "src/a.ts" });
    card.updatePlan([
      { content: "Step 1", status: "completed", priority: "high" },
      { content: "Step 2", status: "in_progress", priority: "medium" },
    ]);
    vi.advanceTimersByTime(500);
    const state = onFlush.mock.lastCall![0];
    expect(state.planEntries).toHaveLength(2);
    card.destroy();
  });

  it("appendUsage sets usage and force flushes", () => {
    const onFlush = vi.fn();
    const card = new ToolCardState({ onFlush, verbosity: "medium" });
    card.addTool(makeTool("t1", "Read"), "read", { file_path: "src/a.ts" });
    onFlush.mockClear();
    card.appendUsage({ tokensUsed: 5000, cost: 0.05 });
    expect(onFlush).toHaveBeenCalledTimes(1);
    const state = onFlush.mock.lastCall![0];
    expect(state.usage).toEqual({ tokensUsed: 5000, cost: 0.05 });
    card.destroy();
  });

  it("finalize force flushes and prevents further updates", () => {
    const onFlush = vi.fn();
    const card = new ToolCardState({ onFlush, verbosity: "medium" });
    card.addTool(makeTool("t1", "Read"), "read", { file_path: "src/a.ts" });
    onFlush.mockClear();
    card.finalize();
    expect(onFlush).toHaveBeenCalledTimes(1);
    card.addTool(makeTool("t2", "Edit"), "edit", { file_path: "src/b.ts" });
    vi.advanceTimersByTime(500);
    expect(onFlush).toHaveBeenCalledTimes(1);
    card.destroy();
  });

  it("visibleCount excludes hidden tools", () => {
    const onFlush = vi.fn();
    const card = new ToolCardState({ onFlush, verbosity: "medium" });
    card.addTool(makeTool("t1", "ls"), "other", {});
    card.addTool(makeTool("t2", "Read"), "read", { file_path: "src/a.ts" });
    card.addTool(makeTool("t3", "Glob"), "search", {});
    card.addTool(makeTool("t4", "Edit"), "edit", { file_path: "src/b.ts" });
    vi.advanceTimersByTime(500);
    const state = onFlush.mock.lastCall![0];
    expect(state.visibleCount).toBe(2);
    expect(state.totalVisible).toBe(2);
    card.destroy();
  });
});
