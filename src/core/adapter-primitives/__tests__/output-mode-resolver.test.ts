// src/core/adapter-primitives/__tests__/output-mode-resolver.test.ts
import { describe, it, expect } from "vitest";
import { OutputModeResolver } from "../output-mode-resolver.js";

function makeConfig(global?: string, adapterMode?: string) {
  return {
    get: () => ({
      outputMode: global,
      channels: { telegram: { outputMode: adapterMode } },
    }),
  } as any;
}

function makeSessionManager(sessionMode?: string) {
  return {
    getSession: (id: string) => id === "sess1" ? { record: { outputMode: sessionMode } } : undefined,
  } as any;
}

describe("OutputModeResolver", () => {
  const resolver = new OutputModeResolver();

  it("returns medium as default when nothing configured", () => {
    expect(resolver.resolve(makeConfig(), "telegram")).toBe("medium");
  });

  it("uses global outputMode when set", () => {
    expect(resolver.resolve(makeConfig("low"), "telegram")).toBe("low");
  });

  it("adapter-level overrides global", () => {
    expect(resolver.resolve(makeConfig("low", "high"), "telegram")).toBe("high");
  });

  it("session-level overrides adapter", () => {
    const result = resolver.resolve(
      makeConfig("low", "medium"),
      "telegram",
      "sess1",
      makeSessionManager("high"),
    );
    expect(result).toBe("high");
  });

  it("skips session override when sessionManager not provided", () => {
    const result = resolver.resolve(
      makeConfig("low", "medium"),
      "telegram",
      "sess1",
      undefined, // no sessionManager
    );
    expect(result).toBe("medium");
  });

  it("skips session override when sessionId not provided", () => {
    const result = resolver.resolve(
      makeConfig("low", "medium"),
      "telegram",
      undefined,
      makeSessionManager("high"),
    );
    expect(result).toBe("medium");
  });

  // Additional flow tests:
  it("flow: all three levels set — session wins", () => {
    const result = resolver.resolve(makeConfig("low", "medium"), "telegram", "sess1", makeSessionManager("high"));
    expect(result).toBe("high");
  });

  it("flow: only session set — falls through to medium default", () => {
    // session set but no sessionId provided → adapter/global both unset → medium
    expect(resolver.resolve(makeConfig(), "telegram", undefined, makeSessionManager("high"))).toBe("medium");
  });

  it("adapter channel not present — falls back to global", () => {
    const config = { get: () => ({ outputMode: "low", channels: {} }) } as any;
    expect(resolver.resolve(config, "telegram")).toBe("low");
  });
});
