import { describe, it, expect } from "vitest";
import { Router } from "../router.js";

describe("Router", () => {
  it("matches exact path", () => {
    const router = new Router();
    const handler = async () => {};
    router.get("/api/health", handler);
    const match = router.match("GET", "/api/health");
    expect(match).not.toBeNull();
    expect(match!.handler).toBe(handler);
  });

  it("matches path with params", () => {
    const router = new Router();
    router.get("/api/sessions/:id", async () => {});
    const match = router.match("GET", "/api/sessions/abc123");
    expect(match).not.toBeNull();
    expect(match!.params.id).toBe("abc123");
  });

  it("returns null for unmatched path", () => {
    const router = new Router();
    router.get("/api/health", async () => {});
    expect(router.match("GET", "/api/unknown")).toBeNull();
  });

  it("matches correct method", () => {
    const router = new Router();
    const getHandler = async () => {};
    const postHandler = async () => {};
    router.get("/api/sessions", getHandler);
    router.post("/api/sessions", postHandler);
    expect(router.match("GET", "/api/sessions")!.handler).toBe(getHandler);
    expect(router.match("POST", "/api/sessions")!.handler).toBe(postHandler);
  });

  it("strips query string before matching", () => {
    const router = new Router();
    router.get("/api/health", async () => {});
    const match = router.match("GET", "/api/health?foo=bar");
    expect(match).not.toBeNull();
  });
});
