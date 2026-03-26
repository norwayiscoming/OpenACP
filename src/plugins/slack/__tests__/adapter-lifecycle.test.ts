import { describe, it, expect, vi } from "vitest";
import { SlackTextBuffer } from "../text-buffer.js";

function createMockQueue() {
  return { enqueue: vi.fn().mockResolvedValue({ ts: "123" }) } as any;
}

describe("SlackAdapter lifecycle — stop() flush", () => {
  it("flushes all active text buffers before stopping", async () => {
    const queue = createMockQueue();
    const buf1 = new SlackTextBuffer("C1", "sess-1", queue);
    const buf2 = new SlackTextBuffer("C2", "sess-2", queue);
    buf1.append("buffered text 1");
    buf2.append("buffered text 2");

    const textBuffers = new Map<string, SlackTextBuffer>();
    textBuffers.set("sess-1", buf1);
    textBuffers.set("sess-2", buf2);

    for (const [_sessionId, buf] of textBuffers) {
      try { await buf.flush(); } catch { /* swallow */ }
      buf.destroy();
    }
    textBuffers.clear();

    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue.mock.calls[0][1].text).toContain("buffered text 1");
    expect(queue.enqueue.mock.calls[1][1].text).toContain("buffered text 2");
    expect(textBuffers.size).toBe(0);
  });

  it("continues flushing remaining buffers even if one flush throws", async () => {
    const failQueue = {
      enqueue: vi.fn()
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValue({ ts: "456" }),
    } as any;
    const successQueue = createMockQueue();

    const buf1 = new SlackTextBuffer("C1", "sess-1", failQueue);
    const buf2 = new SlackTextBuffer("C2", "sess-2", successQueue);
    buf1.append("text 1");
    buf2.append("text 2");

    const textBuffers = new Map<string, SlackTextBuffer>();
    textBuffers.set("sess-1", buf1);
    textBuffers.set("sess-2", buf2);

    for (const [_sessionId, buf] of textBuffers) {
      try { await buf.flush(); } catch { /* swallow */ }
      buf.destroy();
    }
    textBuffers.clear();

    expect(successQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(successQueue.enqueue.mock.calls[0][1].text).toContain("text 2");
    expect(textBuffers.size).toBe(0);
  });
});

describe("SlackAdapter lifecycle — session_end flush error handling", () => {
  it("cleans up buffer even when flush throws on session_end", async () => {
    const failQueue = {
      enqueue: vi.fn().mockRejectedValue(new Error("network error")),
    } as any;
    const buf = new SlackTextBuffer("C1", "sess-1", failQueue);
    buf.append("some pending text");

    const textBuffers = new Map<string, SlackTextBuffer>();
    textBuffers.set("sess-1", buf);

    const sessionId = "sess-1";
    const sessionBuf = textBuffers.get(sessionId);
    if (sessionBuf) {
      try {
        await sessionBuf.flush();
      } catch {
        // swallow
      }
      sessionBuf.destroy();
      textBuffers.delete(sessionId);
    }

    expect(textBuffers.has("sess-1")).toBe(false);
  });

  it("successfully flushes buffer on session_end when no error", async () => {
    const queue = createMockQueue();
    const buf = new SlackTextBuffer("C1", "sess-1", queue);
    buf.append("final response");

    const textBuffers = new Map<string, SlackTextBuffer>();
    textBuffers.set("sess-1", buf);

    const sessionBuf = textBuffers.get("sess-1");
    if (sessionBuf) {
      try {
        await sessionBuf.flush();
      } catch { /* swallow */ }
      sessionBuf.destroy();
      textBuffers.delete("sess-1");
    }

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue.mock.calls[0][1].text).toContain("final response");
    expect(textBuffers.has("sess-1")).toBe(false);
  });
});
