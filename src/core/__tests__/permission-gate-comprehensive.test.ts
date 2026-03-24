import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PermissionGate } from "../permission-gate.js";
import type { PermissionRequest } from "../types.js";

function makeRequest(id = "req-1"): PermissionRequest {
  return {
    id,
    description: "Allow this action?",
    options: [
      { id: "allow", label: "Allow", isAllow: true },
      { id: "deny", label: "Deny", isAllow: false },
    ],
  };
}

describe("PermissionGate — Comprehensive Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic resolve/reject flow", () => {
    it("setPending returns a promise that resolves on resolve()", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());

      expect(gate.isPending).toBe(true);
      gate.resolve("allow");

      const result = await promise;
      expect(result).toBe("allow");
      expect(gate.isPending).toBe(false);
    });

    it("setPending returns a promise that rejects on reject()", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());

      gate.reject("User denied");

      await expect(promise).rejects.toThrow("User denied");
      expect(gate.isPending).toBe(false);
    });

    it("reject with default message uses 'Permission rejected'", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());

      gate.reject();

      await expect(promise).rejects.toThrow("Permission rejected");
    });
  });

  describe("idempotency and settlement guards", () => {
    it("double resolve is ignored (first wins)", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());

      gate.resolve("allow");
      gate.resolve("deny"); // should be ignored

      const result = await promise;
      expect(result).toBe("allow");
    });

    it("resolve after reject is ignored", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());

      gate.reject("denied");
      gate.resolve("allow"); // should be ignored

      await expect(promise).rejects.toThrow("denied");
    });

    it("reject after resolve is ignored", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());

      gate.resolve("allow");
      gate.reject("too late"); // should be ignored

      const result = await promise;
      expect(result).toBe("allow");
    });

    it("resolve without pending is no-op (does not throw)", () => {
      const gate = new PermissionGate();
      expect(() => gate.resolve("allow")).not.toThrow();
    });

    it("reject without pending is no-op (does not throw)", () => {
      const gate = new PermissionGate();
      expect(() => gate.reject("denied")).not.toThrow();
    });
  });

  describe("timeout", () => {
    it("rejects after default timeout (10 minutes)", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());

      vi.advanceTimersByTime(10 * 60 * 1000);

      await expect(promise).rejects.toThrow("timed out");
    });

    it("does not reject before timeout", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());
      let rejected = false;
      promise.catch(() => { rejected = true; });

      vi.advanceTimersByTime(9 * 60 * 1000);
      await Promise.resolve(); // flush microtasks

      expect(rejected).toBe(false);
      expect(gate.isPending).toBe(true);

      // Cleanup
      gate.resolve("allow");
    });

    it("custom timeout is respected", async () => {
      const gate = new PermissionGate(5000); // 5 seconds
      const promise = gate.setPending(makeRequest());

      vi.advanceTimersByTime(4999);
      await Promise.resolve();
      expect(gate.isPending).toBe(true);

      vi.advanceTimersByTime(1);
      await expect(promise).rejects.toThrow("timed out");
    });

    it("resolve before timeout clears the timer", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());

      gate.resolve("allow");
      await promise;

      // Advancing time should NOT cause any rejection
      vi.advanceTimersByTime(10 * 60 * 1000);
      // No error — timeout was cleared
    });

    it("reject before timeout clears the timer", async () => {
      const gate = new PermissionGate();
      const promise = gate.setPending(makeRequest());

      gate.reject("user denied");
      await promise.catch(() => {});

      vi.advanceTimersByTime(10 * 60 * 1000);
      // No additional error
    });
  });

  describe("state properties", () => {
    it("isPending is false initially", () => {
      const gate = new PermissionGate();
      expect(gate.isPending).toBe(false);
    });

    it("isPending is true after setPending", () => {
      const gate = new PermissionGate();
      gate.setPending(makeRequest());
      expect(gate.isPending).toBe(true);

      // Cleanup
      gate.resolve("allow");
    });

    it("isPending is false after resolve", async () => {
      const gate = new PermissionGate();
      const p = gate.setPending(makeRequest());
      gate.resolve("allow");
      await p;
      expect(gate.isPending).toBe(false);
    });

    it("currentRequest returns request when pending", () => {
      const gate = new PermissionGate();
      const req = makeRequest("unique-id");
      gate.setPending(req);

      expect(gate.currentRequest).toEqual(req);

      gate.resolve("allow");
    });

    it("currentRequest returns undefined when not pending", () => {
      const gate = new PermissionGate();
      expect(gate.currentRequest).toBeUndefined();
    });

    it("currentRequest returns undefined after settlement", async () => {
      const gate = new PermissionGate();
      const p = gate.setPending(makeRequest());
      gate.resolve("allow");
      await p;

      expect(gate.currentRequest).toBeUndefined();
    });

    it("requestId returns the request id when pending", () => {
      const gate = new PermissionGate();
      gate.setPending(makeRequest("my-req"));

      // requestId returns the id from the stored request
      // Note: after settlement, request is cleaned up so requestId is undefined
      expect(gate.requestId).toBe("my-req");

      gate.resolve("allow");
    });

    it("requestId is undefined when no pending request", () => {
      const gate = new PermissionGate();
      expect(gate.requestId).toBeUndefined();
    });
  });

  describe("overwriting pending request", () => {
    it("new setPending overwrites previous (previous promise hangs)", async () => {
      const gate = new PermissionGate();

      // First request — will never be resolved now
      const first = gate.setPending(makeRequest("first"));

      // Second request overwrites
      const second = gate.setPending(makeRequest("second"));

      expect(gate.requestId).toBe("second");

      gate.resolve("allow");

      const result = await second;
      expect(result).toBe("allow");

      // First promise is orphaned — resolving won't help since resolveFn was replaced
      // This is expected behavior
    });
  });

  describe("cleanup after settlement", () => {
    it("internal references are cleaned up after resolve", async () => {
      const gate = new PermissionGate();
      const p = gate.setPending(makeRequest());
      gate.resolve("allow");
      await p;

      // Verify state is clean
      expect(gate.isPending).toBe(false);
      expect(gate.currentRequest).toBeUndefined();
    });

    it("can set new pending after previous was resolved", async () => {
      const gate = new PermissionGate();

      const p1 = gate.setPending(makeRequest("first"));
      gate.resolve("allow");
      await p1;

      const p2 = gate.setPending(makeRequest("second"));
      expect(gate.isPending).toBe(true);
      expect(gate.requestId).toBe("second");

      gate.resolve("deny");
      const result = await p2;
      expect(result).toBe("deny");
    });

    it("can set new pending after previous was rejected", async () => {
      const gate = new PermissionGate();

      const p1 = gate.setPending(makeRequest("first"));
      gate.reject("nope");
      await p1.catch(() => {});

      const p2 = gate.setPending(makeRequest("second"));
      expect(gate.isPending).toBe(true);
      gate.resolve("ok");
      await p2;
    });

    it("can set new pending after previous timed out", async () => {
      const gate = new PermissionGate(100);

      const p1 = gate.setPending(makeRequest("first"));
      vi.advanceTimersByTime(100);
      await p1.catch(() => {});

      const p2 = gate.setPending(makeRequest("second"));
      expect(gate.isPending).toBe(true);
      gate.resolve("ok");
      const result = await p2;
      expect(result).toBe("ok");
    });
  });
});
