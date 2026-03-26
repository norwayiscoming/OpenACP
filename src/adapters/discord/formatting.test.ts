import { describe, it, expect } from "vitest";
import {
  splitMessage,
  formatUsage,
  formatToolCall,
  formatPlan,
} from "./formatting.js";
import type { PlanEntry } from "../../core/types.js";

describe("splitMessage", () => {
  it("returns array with original text when within maxLength", () => {
    const text = "Hello world";
    expect(splitMessage(text, 1800)).toEqual([text]);
  });

  it("splits long text at paragraph boundary", () => {
    const para1 = "A".repeat(1000);
    const para2 = "B".repeat(1000);
    const text = para1 + "\n\n" + para2;
    const chunks = splitMessage(text, 1800);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n").replace(/\n\n/g, "\n\n")).toContain("A");
    expect(chunks.join("")).toContain("B");
  });

  it("splits long text at line boundary if no paragraph break", () => {
    const lines = Array.from(
      { length: 30 },
      (_, i) => `Line ${i}: ${"x".repeat(60)}`,
    ).join("\n");
    const chunks = splitMessage(lines, 1800);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2100); // some tolerance for fence logic
    }
  });

  it("does not split inside a fenced code block", () => {
    const before = "Some intro text\n\n";
    const codeBlock =
      "```javascript\n" + "const x = 1;\n".repeat(100) + "```\n";
    const after = "\nAfter code block";
    const text = before + codeBlock + after;
    const chunks = splitMessage(text, 1800);
    // No chunk should have an unclosed fenced code block
    for (const chunk of chunks) {
      const fences = chunk.match(/```/g) || [];
      expect(fences.length % 2).toBe(0);
    }
  });

  it("handles text exactly at maxLength", () => {
    const text = "x".repeat(1800);
    expect(splitMessage(text, 1800)).toEqual([text]);
  });

  it("handles text one char over maxLength", () => {
    const text = "x".repeat(1801);
    const chunks = splitMessage(text, 1800);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("formatUsage", () => {
  it("shows progress bar with tokens and contextSize (high)", () => {
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
    const result = formatUsage({ tokensUsed: 500, contextSize: 1000 }, "high");
    expect(result).toBe("📊 500 / 1k tokens\n▓▓▓▓▓░░░░░ 50%");
  });
});

describe("formatToolCall", () => {
  it("uses Discord bold markdown not HTML", () => {
    const result = formatToolCall({
      id: "1",
      name: "read_file",
      kind: "read",
      status: "completed",
    });
    expect(result).toContain("**");
    expect(result).not.toContain("<b>");
  });

  it("shows status icon and smart summary", () => {
    const result = formatToolCall({
      id: "1",
      name: "Grep",
      kind: "search",
      status: "running",
      rawInput: { pattern: "handleNewSession", path: "src/" },
    });
    expect(result).toContain("🔄"); // running
    expect(result).toContain('🔍 Grep "handleNewSession"');
  });

  it("includes code block for content on high verbosity", () => {
    const result = formatToolCall(
      {
        id: "1",
        name: "write_file",
        kind: "write",
        status: "completed",
        content: "file content here",
      },
      "high",
    );
    expect(result).toContain("```");
    expect(result).toContain("file content here");
  });

  it("no inline content on low verbosity", () => {
    const result = formatToolCall(
      {
        id: "1",
        name: "write_file",
        kind: "write",
        status: "completed",
        content: "file content here",
      },
      "low",
    );
    expect(result).not.toContain("```");
  });

  it("medium hides content when viewer links present", () => {
    const result = formatToolCall({
      id: "1",
      name: "edit_file",
      kind: "write",
      status: "completed",
      content: "should not appear",
      viewerLinks: { file: "https://example.com/file" },
      viewerFilePath: "test.ts",
    });
    expect(result).not.toContain("```");
    expect(result).toContain("[View test.ts]");
  });

  it("truncates content at 500 chars (high verbosity)", () => {
    const longContent = "x".repeat(600);
    const result = formatToolCall(
      {
        id: "1",
        name: "tool",
        status: "completed",
        content: longContent,
      },
      "high",
    );
    expect(result).toContain("… (truncated)");
    // The code block content should be truncated
    const codeBlockContent = result.replace(
      /```[\s\S]*?```/g,
      (match) => match,
    );
    expect(codeBlockContent.length).toBeLessThan(700);
  });

  it("shows viewer links instead of code block", () => {
    const result = formatToolCall({
      id: "1",
      name: "edit_file",
      kind: "write",
      status: "completed",
      content: "some content",
      viewerLinks: {
        file: "https://example.com/file",
        diff: "https://example.com/diff",
      },
      viewerFilePath: "/path/to/file.ts",
    });
    expect(result).toContain("[View file.ts](https://example.com/file)");
    expect(result).toContain("[View diff — file.ts](https://example.com/diff)");
    expect(result).not.toContain("```");
  });

  it("falls back to generic tool icon for unknown tool", () => {
    const result = formatToolCall({
      id: "1",
      name: "mystery_tool",
      status: "unknown",
    });
    expect(result).toContain("🔧");
    expect(result).toContain("mystery_tool");
  });
});

describe("formatPlan", () => {
  it("formats plan entries with status icons (high)", () => {
    const entries: PlanEntry[] = [
      { content: "First step", status: "completed", priority: "high" },
      { content: "Second step", status: "in_progress", priority: "medium" },
      { content: "Third step", status: "pending", priority: "low" },
    ];
    const result = formatPlan(entries, "high");
    expect(result).toContain("**Plan:**");
    expect(result).toContain("✅ 1. First step");
    expect(result).toContain("🔄 2. Second step");
    expect(result).toContain("⏳ 3. Third step");
  });

  it("uses Discord bold markdown (high)", () => {
    const entries: PlanEntry[] = [
      { content: "Do something", status: "pending", priority: "high" },
    ];
    const result = formatPlan(entries, "high");
    expect(result).toContain("**Plan:**");
    expect(result).not.toContain("<b>");
  });

  it("handles empty plan (high)", () => {
    const result = formatPlan([], "high");
    expect(result).toBe("**Plan:**\n");
  });

  it("uses fallback icon for unknown status (high)", () => {
    const entries = [
      {
        content: "Unknown",
        status: "unknown" as PlanEntry["status"],
        priority: "low" as PlanEntry["priority"],
      },
    ];
    const result = formatPlan(entries, "high");
    expect(result).toContain("⬜ 1. Unknown");
  });
});

describe("displayKind icon resolution", () => {
  it("uses displayKind icon when no status icon", () => {
    const result = formatToolCall({
      id: "1",
      name: "custom",
      status: "",
      displayKind: "read",
    });
    expect(result).toContain("📖");
  });

  it("status icon takes precedence", () => {
    const result = formatToolCall({
      id: "1",
      name: "tool",
      status: "completed",
      displayKind: "read",
    });
    expect(result).toContain("✅");
  });
});

describe("high verbosity rawInput", () => {
  it("shows rawInput + content on high", () => {
    const result = formatToolCall(
      {
        id: "1",
        name: "Read",
        status: "completed",
        rawInput: { file_path: "src/main.ts" },
        content: "const x = 1;",
      },
      "high",
    );
    expect(result).toContain("**Input:**");
    expect(result).toContain("**Output:**");
  });

  it("medium does NOT show content", () => {
    const result = formatToolCall(
      { id: "1", name: "Read", status: "completed", content: "file content" },
      "medium",
    );
    expect(result).not.toContain("```");
  });
});

describe("formatPlan verbosity", () => {
  const entries: PlanEntry[] = [
    { content: "Step 1", status: "completed", priority: "high" },
    { content: "Step 2", status: "pending", priority: "low" },
  ];

  it("medium shows summary", () => {
    const result = formatPlan(entries, "medium");
    expect(result).toContain("1/2 steps completed");
    expect(result).not.toContain("Step 1");
  });

  it("high shows full entries", () => {
    const result = formatPlan(entries, "high");
    expect(result).toContain("Step 1");
  });
});

describe("formatUsage verbosity", () => {
  it("medium shows compact", () => {
    const result = formatUsage(
      { tokensUsed: 5000, contextSize: 200000 },
      "medium",
    );
    expect(result).toBe("📊 5k tokens");
  });

  it("high shows progress bar + cost", () => {
    const result = formatUsage(
      { tokensUsed: 28000, contextSize: 200000, cost: 0.25 },
      "high",
    );
    expect(result).toContain("▓");
    expect(result).toContain("💰 $0.25");
  });
});
