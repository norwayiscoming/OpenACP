import { describe, expect, it, vi } from "vitest";
import { SlackTextBuffer } from "../text-buffer.js";

describe("SlackTextBuffer", () => {
  it("flushes buffered text as a single message", async () => {
    const mockQueue = {
      enqueue: vi.fn().mockResolvedValue({}),
    } as any;
    const buf = new SlackTextBuffer("C123", "sess1", mockQueue);

    buf.append("Hello ");
    buf.append("world");
    await buf.flush();

    expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
    const call = mockQueue.enqueue.mock.calls[0];
    expect(call[1].text).toContain("Hello");
    expect(call[1].text).toContain("world");
  });

  it("does not post empty content", async () => {
    const mockQueue = { enqueue: vi.fn().mockResolvedValue({}) } as any;
    const buf = new SlackTextBuffer("C123", "sess1", mockQueue);
    await buf.flush();
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });

  it("does not lose content appended during flush", async () => {
    const resolvers: Array<() => void> = [];
    const mockQueue = {
      enqueue: vi.fn().mockImplementation(
        () => new Promise<void>(r => { resolvers.push(r); }),
      ),
    } as any;
    const buf = new SlackTextBuffer("C123", "sess1", mockQueue);

    buf.append("first");
    const flushPromise = buf.flush(); // starts flush, blocks on first enqueue

    // Wait for first enqueue to be called
    await new Promise(r => setTimeout(r, 10));

    // Append more content while flush is in progress
    buf.append(" second");

    // Unblock first enqueue — this triggers re-flush in finally block
    resolvers[0]();

    // Wait for re-flush to call enqueue again, then unblock it
    await new Promise(r => setTimeout(r, 20));
    if (resolvers[1]) resolvers[1]();

    await flushPromise;
    await new Promise(r => setTimeout(r, 20));

    const allText = mockQueue.enqueue.mock.calls
      .map((c: any) => c[1].text as string)
      .join(" ");
    expect(allText).toContain("second");
  });

  it("concurrent flush() awaits ongoing flush instead of returning immediately", async () => {
    let resolveFirst!: () => void;
    const firstCallPromise = new Promise<void>(r => { resolveFirst = r; });
    const postResults: string[] = [];

    const mockQueue: { enqueue: ReturnType<typeof vi.fn> } = {
      enqueue: vi.fn().mockImplementation(async (_method: string, _params: unknown) => {
        if (postResults.length === 0) {
          postResults.push("first-start");
          await firstCallPromise;
          postResults.push("first-end");
        } else {
          postResults.push("second");
        }
        return { ts: "123" };
      }),
    };

    const buf = new SlackTextBuffer("C123", "sess-1", mockQueue as any);
    buf.append("hello ");

    // Start flush1 — this blocks on firstCallPromise
    const flush1 = buf.flush();

    // Append more while flush1 is in flight
    buf.append("world");

    // Call flush2 while flush1 is still in progress
    const flush2 = buf.flush();

    // flush2 should not have resolved yet (first flush is still blocked)
    let flush2Resolved = false;
    flush2.then(() => { flush2Resolved = true; });

    // Yield to microtask queue — if flush2 returned immediately (old bug),
    // flush2Resolved would already be true here
    await Promise.resolve();
    await Promise.resolve();

    // Under the buggy implementation: flush2 returns immediately when flushing=true
    // so flush2Resolved would be true even though "world" hasn't been sent yet.
    // Under the fixed implementation: flush2 awaits the ongoing flush promise,
    // so flush2Resolved is still false while firstCallPromise is unresolved.
    expect(flush2Resolved).toBe(false);

    // Now unblock the first flush
    resolveFirst();
    await flush1;
    await flush2;

    // After awaiting both, all content must have been sent
    expect(mockQueue.enqueue).toHaveBeenCalledTimes(2);
    expect(postResults).toContain("second");

    buf.destroy();
  });

  it("destroy clears buffer and timer", async () => {
    const mockQueue = { enqueue: vi.fn().mockResolvedValue({}) } as any;
    const buf = new SlackTextBuffer("C123", "sess1", mockQueue);
    buf.append("text");
    buf.destroy();
    // After destroy, flush should not post anything
    await buf.flush();
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
});
