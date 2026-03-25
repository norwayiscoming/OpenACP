import { describe, expect, it, vi } from "vitest";
import { SlackSendQueue } from "./send-queue.js";
import type { WebClient } from "@slack/web-api";

describe("SlackSendQueue", () => {
  it("enqueues and resolves a valid method call", async () => {
    const mockClient = {
      apiCall: vi.fn().mockResolvedValue({ ok: true, ts: "12345" }),
    } as unknown as WebClient;

    const queue = new SlackSendQueue(mockClient);
    const result = await queue.enqueue("chat.postMessage", { channel: "C123", text: "hi" });

    expect(mockClient.apiCall).toHaveBeenCalledWith("chat.postMessage", { channel: "C123", text: "hi" });
    expect((result as any).ok).toBe(true);
  });

  it("throws for unknown method", async () => {
    const mockClient = { apiCall: vi.fn() } as unknown as WebClient;
    const queue = new SlackSendQueue(mockClient);
    await expect(queue.enqueue("unknown.method" as any, {})).rejects.toThrow("Unknown Slack method");
  });

  it("different methods have independent queues", async () => {
    const callOrder: string[] = [];
    const mockClient = {
      apiCall: vi.fn().mockImplementation(async (method: string) => {
        callOrder.push(method);
        await new Promise(r => setTimeout(r, 10));
        return { ok: true };
      }),
    };

    const queue = new SlackSendQueue(mockClient as any);

    const p1 = queue.enqueue("chat.postMessage", { channel: "C1", text: "a" });
    const p2 = queue.enqueue("conversations.create", { name: "test" });

    await Promise.all([p1, p2]);

    expect(mockClient.apiCall).toHaveBeenCalledTimes(2);
  });

  it("same method calls are serialized (FIFO order)", async () => {
    const callOrder: number[] = [];
    const mockClient = {
      apiCall: vi.fn().mockImplementation(async (_method: string, params: any) => {
        callOrder.push(params.order);
        return { ok: true };
      }),
    };

    const queue = new SlackSendQueue(mockClient as any);

    const promises = [
      queue.enqueue("chat.postMessage", { channel: "C1", text: "1", order: 1 }),
      queue.enqueue("chat.postMessage", { channel: "C1", text: "2", order: 2 }),
      queue.enqueue("chat.postMessage", { channel: "C1", text: "3", order: 3 }),
    ];

    await Promise.all(promises);

    expect(callOrder).toEqual([1, 2, 3]);
  });
});
