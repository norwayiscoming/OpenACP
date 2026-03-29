import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolCardState } from "../primitives/tool-card-state.js";
import type { ToolDisplaySpec } from "../display-spec-builder.js";

function makeSpec(overrides: Partial<ToolDisplaySpec> = {}): ToolDisplaySpec {
  return {
    id: "t1",
    icon: "📖",
    title: "Read foo.ts",
    description: null,
    command: null,
    outputSummary: null,
    outputContent: null,
    diffStats: null,
    status: "running",
    isNoise: false,
    isHidden: false,
    ...overrides,
  };
}

describe("ToolCardState (refactored)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("first updateFromSpec flushes immediately (no debounce)", () => {
    const onFlush = vi.fn();
    const state = new ToolCardState({ onFlush });
    state.updateFromSpec(makeSpec());
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].specs).toHaveLength(1);
  });

  it("second updateFromSpec (same id) debounces", () => {
    const onFlush = vi.fn();
    const state = new ToolCardState({ onFlush });
    state.updateFromSpec(makeSpec());
    onFlush.mockClear();
    state.updateFromSpec(makeSpec({ status: "completed" }));
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].specs[0].status).toBe("completed");
  });

  it("second updateFromSpec (new id) batches — debounce, not immediate", () => {
    const onFlush = vi.fn();
    const state = new ToolCardState({ onFlush });
    state.updateFromSpec(makeSpec({ id: "t1" }));
    onFlush.mockClear();
    state.updateFromSpec(makeSpec({ id: "t2" }));
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].specs).toHaveLength(2);
  });

  it("updateFromSpec after finalize flushes immediately", () => {
    const onFlush = vi.fn();
    const state = new ToolCardState({ onFlush });
    state.updateFromSpec(makeSpec({ id: "t1" }));
    state.finalize();
    onFlush.mockClear();
    state.updateFromSpec(makeSpec({ id: "t1", status: "completed" }));
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("hasContent returns true when specs present", () => {
    const state = new ToolCardState({ onFlush: vi.fn() });
    expect(state.hasContent()).toBe(false);
    state.updateFromSpec(makeSpec());
    expect(state.hasContent()).toBe(true);
  });

  // Additional flow tests:
  it("flow: finalize flushes pending debounce", () => {
    const onFlush = vi.fn();
    const state = new ToolCardState({ onFlush });
    state.updateFromSpec(makeSpec());
    onFlush.mockClear();
    state.updateFromSpec(makeSpec({ status: "completed" }));
    // don't advance timers — finalize should flush immediately
    state.finalize();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].specs[0].status).toBe("completed");
  });

  it("flow: snapshot totalVisible excludes hidden specs", () => {
    const onFlush = vi.fn();
    const state = new ToolCardState({ onFlush });
    state.updateFromSpec(makeSpec({ id: "t1", isHidden: false }));
    state.updateFromSpec(makeSpec({ id: "t2", isHidden: true }));
    vi.advanceTimersByTime(500);
    const snap = onFlush.mock.calls[onFlush.mock.calls.length - 1][0];
    expect(snap.totalVisible).toBe(1);
  });

  it("flow: allComplete true when all visible specs are done", () => {
    const onFlush = vi.fn();
    const state = new ToolCardState({ onFlush });
    state.updateFromSpec(makeSpec({ id: "t1", status: "running" }));
    state.updateFromSpec(makeSpec({ id: "t1", status: "completed" }));
    vi.advanceTimersByTime(500);
    const snap = onFlush.mock.calls[onFlush.mock.calls.length - 1][0];
    expect(snap.allComplete).toBe(true);
  });

  it("destroy stops debounce without flushing", () => {
    const onFlush = vi.fn();
    const state = new ToolCardState({ onFlush });
    state.updateFromSpec(makeSpec());
    onFlush.mockClear();
    state.updateFromSpec(makeSpec({ status: "completed" })); // schedules debounce
    state.destroy();
    vi.advanceTimersByTime(500); // timer fired but should not call onFlush
    expect(onFlush).not.toHaveBeenCalled();
  });
});
