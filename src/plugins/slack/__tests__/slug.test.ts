import { describe, expect, it } from "vitest";
import { toSlug } from "../slug.js";

describe("toSlug", () => {
  it("lowercases and replaces spaces with dashes", () => {
    const result = toSlug("Fix Auth Bug");
    expect(result).toMatch(/^openacp-fix-auth-bug-[a-z0-9]{4}$/);
  });

  it("strips special characters", () => {
    const result = toSlug("OAuth 2.0 & JWT");
    expect(result).toMatch(/^openacp-oauth-20-jwt-[a-z0-9]{4}$/);
  });

  it("uses custom prefix", () => {
    const result = toSlug("My Session", "myapp");
    expect(result).toMatch(/^myapp-my-session-[a-z0-9]{4}$/);
  });

  it("collapses consecutive dashes", () => {
    const result = toSlug("Hello   World");
    expect(result).not.toMatch(/--/);
  });

  it("suffix is lowercase alphanumeric only", () => {
    // Run many times to probabilistically verify
    for (let i = 0; i < 20; i++) {
      const result = toSlug("test");
      expect(result).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("result is ≤80 chars", () => {
    const long = "A".repeat(200);
    expect(toSlug(long).length).toBeLessThanOrEqual(80);
  });
});
