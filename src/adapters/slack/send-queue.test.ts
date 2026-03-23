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
});
