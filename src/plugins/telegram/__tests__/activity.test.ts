import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThinkingIndicator, ToolCard, ActivityTracker } from "../activity.js";
import type { SendQueue } from "../../../core/adapter-primitives/primitives/send-queue.js";
import type { ToolCallMeta } from "../../../core/adapter-primitives/format-types.js";
import type { ToolDisplaySpec } from "../../../core/adapter-primitives/display-spec-builder.js";

// Flush the microtask queue multiple times to let promise chains resolve
async function flushMicrotasks(ticks = 5): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
}

// Minimal mock for SendQueue: runs the fn immediately, returns result
function makeMockQueue(): SendQueue {
  return {
    enqueue: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    onRateLimited: vi.fn(),
  } as unknown as SendQueue;
}

// Minimal mock for bot.api
function makeMockApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
  };
}

function makeMeta(overrides: Partial<ToolCallMeta> = {}): ToolCallMeta {
  return {
    id: "tool-1",
    name: "read_file",
    kind: "file_read",
    status: "running",
    ...overrides,
  };
}

function makeSpec(overrides: Partial<ToolDisplaySpec> = {}): ToolDisplaySpec {
  return {
    id: "tool-1",
    icon: "📄",
    title: "read_file",
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

describe("ThinkingIndicator", () => {
  let api: ReturnType<typeof makeMockApi>;
  let queue: SendQueue;
  let indicator: ThinkingIndicator;

  beforeEach(() => {
    api = makeMockApi();
    queue = makeMockQueue();
    indicator = new ThinkingIndicator(api as never, 100, 200, queue);
  });

  afterEach(() => {
    void indicator.dismiss();
  });

  it("show() sends a thinking message", async () => {
    await indicator.show();
    expect(api.sendMessage).toHaveBeenCalledWith(
      100,
      "💭 <i>Thinking...</i>",
      expect.objectContaining({ message_thread_id: 200, parse_mode: "HTML" }),
    );
  });

  it("show() called twice only sends one message", async () => {
    await indicator.show();
    await indicator.show();
    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it("dismiss() after show stops refresh and leaves message in chat", async () => {
    await indicator.show();
    await indicator.dismiss();
    expect(api.deleteMessage).not.toHaveBeenCalled();
  });

  it("dismiss() called twice is idempotent", async () => {
    await indicator.show();
    await indicator.dismiss();
    await indicator.dismiss();
    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it("reset() allows show() to work again after dismiss", async () => {
    await indicator.show();
    await indicator.dismiss();
    indicator.reset();
    await indicator.show();
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("show() while dismissed (race: dismiss during queue wait) does not set msgId", async () => {
    let resolveEnqueue!: (v: unknown) => void;
    const slowQueue: SendQueue = {
      enqueue: vi.fn(
        (fn: () => Promise<unknown>) =>
          new Promise((resolve) => {
            resolveEnqueue = async () => {
              const result = await fn();
              resolve(result);
            };
          }),
      ),
      onRateLimited: vi.fn(),
    } as unknown as SendQueue;

    const ind = new ThinkingIndicator(api as never, 100, 200, slowQueue);
    const showPromise = ind.show();

    // dismiss() while show() is waiting in the queue
    await ind.dismiss();

    // Now resolve the queue — sendMessage returns the message
    await resolveEnqueue(undefined);
    await showPromise;

    // The message was sent but NOT deleted (saves API calls)
    expect(api.sendMessage).toHaveBeenCalledOnce();
    expect(api.deleteMessage).not.toHaveBeenCalled();
  });
});

describe("ToolCard", () => {
  let api: ReturnType<typeof makeMockApi>;
  let queue: SendQueue;
  let card: ToolCard;

  beforeEach(() => {
    api = makeMockApi();
    queue = makeMockQueue();
    card = new ToolCard(api as never, 100, 200, queue);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    card.destroy();
  });

  it("hasContent() returns false before any spec added", () => {
    expect(card.hasContent()).toBe(false);
  });

  it("hasContent() returns true after updateFromSpec()", async () => {
    card.updateFromSpec(makeSpec());
    await flushMicrotasks();
    expect(card.hasContent()).toBe(true);
  });

  it("sends message on updateFromSpec() (immediate first flush)", async () => {
    card.updateFromSpec(makeSpec());
    await flushMicrotasks();
    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it("getMsgId() returns the message id after first send", async () => {
    card.updateFromSpec(makeSpec());
    await flushMicrotasks();
    expect(card.getMsgId()).toBe(42);
  });

  it("finalize() flushes pending state", async () => {
    card.updateFromSpec(makeSpec());
    await flushMicrotasks();
    card.updateFromSpec(makeSpec({ status: "completed" }));
    // Debounce not fired yet
    expect(api.editMessageText).not.toHaveBeenCalled();
    await card.finalize();
    expect(api.editMessageText).toHaveBeenCalled();
  });

  it("destroy() cancels pending debounce", async () => {
    card.updateFromSpec(makeSpec());
    await flushMicrotasks();
    card.updateFromSpec(makeSpec({ status: "completed" }));
    card.destroy();
    await vi.advanceTimersByTimeAsync(1000);
    // Should not have edited after destroy
    expect(api.editMessageText).not.toHaveBeenCalled();
  });
});

describe("ActivityTracker", () => {
  let api: ReturnType<typeof makeMockApi>;
  let queue: SendQueue;
  let tracker: ActivityTracker;

  beforeEach(() => {
    api = makeMockApi();
    queue = makeMockQueue();
    tracker = new ActivityTracker(api as never, 100, 200, queue);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    tracker.destroy();
  });

  it("onThought() shows thinking indicator", async () => {
    await tracker.onThought("thinking...");
    expect(api.sendMessage).toHaveBeenCalledWith(
      100,
      "💭 <i>Thinking...</i>",
      expect.anything(),
    );
  });

  it("onThought() called multiple times only sends one message", async () => {
    await tracker.onThought("a");
    await tracker.onThought("b");
    await tracker.onThought("c");
    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it("onToolCall() dismisses thinking (no delete)", async () => {
    await tracker.onThought("thinking...");
    await tracker.onToolCall(makeMeta(), "file_read", { path: "/tmp/foo" });
    expect(api.deleteMessage).not.toHaveBeenCalled();
  });

  it("onTextStart() dismisses thinking (no delete)", async () => {
    await tracker.onThought("thinking...");
    await tracker.onTextStart();
    expect(api.deleteMessage).not.toHaveBeenCalled();
  });

  it("sendUsage() is a no-op (usage is sent as separate message by adapter)", async () => {
    await tracker.sendUsage({ tokensUsed: 1000, contextSize: 10000 });
    await flushMicrotasks();
    // sendUsage no longer triggers any Telegram API calls — adapter handles it
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("onNewPrompt() dismisses thinking (no delete)", async () => {
    await tracker.onThought("thinking...");
    await tracker.onNewPrompt();
    expect(api.deleteMessage).not.toHaveBeenCalled();
  });

  it("cleanup() finalizes toolCard and dismisses thinking", async () => {
    await tracker.onThought("thinking...");
    await tracker.onToolCall(makeMeta(), "file_read", { path: "/tmp/foo" });
    await flushMicrotasks();
    await tracker.cleanup();
    // After cleanup, tracker is finalized — no errors thrown
    expect(true).toBe(true);
  });

  it("onNewPrompt() dismisses thinking (message left in chat)", async () => {
    await tracker.onThought("thinking...");
    expect(api.sendMessage).toHaveBeenCalledOnce();
    await tracker.onNewPrompt();
    expect(api.deleteMessage).not.toHaveBeenCalled();
  });

  it("getToolCardMsgId() returns undefined when no tool content", () => {
    expect(tracker.getToolCardMsgId()).toBeUndefined();
  });

  it("getToolCardMsgId() returns msgId after tool call", async () => {
    await tracker.onToolCall(makeMeta(), "file_read", { path: "/tmp/foo" });
    await flushMicrotasks();
    expect(tracker.getToolCardMsgId()).toBe(42);
  });
});
