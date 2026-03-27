import { describe, it, expect } from "vitest";
import { formatUsage } from "../formatting.js";

describe("formatUsage", () => {
  it("shows progress bar with tokens and contextSize (high)", () => {
    // 28k/200k = 14%, Math.round(0.14 * 10) = 1 filled block
    const result = formatUsage(
      { tokensUsed: 28000, contextSize: 200000 },
      "high",
    );
    expect(result).toBe("📊 28k / 200k tokens\n▓░░░░░░░░░ 14%");
  });

  it("shows warning emoji when usage >= 85% (high)", () => {
    const result = formatUsage(
      { tokensUsed: 85000, contextSize: 100000 },
      "high",
    );
    expect(result).toBe("⚠️ 85k / 100k tokens\n▓▓▓▓▓▓▓▓▓░ 85%");
  });

  it("shows warning emoji at exactly 85% (high)", () => {
    const result = formatUsage(
      { tokensUsed: 8500, contextSize: 10000 },
      "high",
    );
    expect(result).toContain("⚠️");
  });

  it("shows 100% with full bar (high)", () => {
    const result = formatUsage(
      { tokensUsed: 100000, contextSize: 100000 },
      "high",
    );
    expect(result).toBe("⚠️ 100k / 100k tokens\n▓▓▓▓▓▓▓▓▓▓ 100%");
  });

  it("shows only tokens when no contextSize", () => {
    const result = formatUsage({ tokensUsed: 5000 });
    expect(result).toBe("📊 5k tokens");
  });

  it("shows placeholder when no data", () => {
    const result = formatUsage({});
    expect(result).toBe("📊 Usage data unavailable");
  });

  it("displays small numbers without k suffix (high)", () => {
    const result = formatUsage(
      { tokensUsed: 500, contextSize: 1000 },
      "high",
    );
    expect(result).toBe("📊 500 / 1k tokens\n▓▓▓▓▓░░░░░ 50%");
  });
});
