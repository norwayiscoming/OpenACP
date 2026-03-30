import { describe, expect, it } from "vitest";
import { SlackFormatter, markdownToMrkdwn } from "../formatter.js";
// Import OutgoingMessage type from core

const fmt = new SlackFormatter();

describe("SlackFormatter.formatOutgoing", () => {
  it("text message returns section blocks", () => {
    const blocks = fmt.formatOutgoing({ type: "text", text: "Hello" } as any);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("section");
  });

  it("thought message returns context block", () => {
    const blocks = fmt.formatOutgoing({ type: "thought", text: "thinking..." } as any);
    expect(blocks[0].type).toBe("context");
  });

  it("long text (>3000 chars) is split into multiple sections", () => {
    const long = "x".repeat(4000);
    const blocks = fmt.formatOutgoing({ type: "text", text: long } as any);
    expect(blocks.length).toBeGreaterThan(1);
    blocks.forEach(b => expect(b.type).toBe("section"));
  });

  it("unknown type returns empty array", () => {
    const blocks = fmt.formatOutgoing({ type: "unknown_xyz" } as any);
    expect(blocks).toEqual([]);
  });

  it("session_end returns divider + context", () => {
    const blocks = fmt.formatSessionEnd("timeout");
    expect(blocks[0].type).toBe("divider");
    expect(blocks[1].type).toBe("context");
  });
});

describe("markdownToMrkdwn", () => {
  it("converts bold without turning it into italic", () => {
    expect(markdownToMrkdwn("**bold text**")).toBe("*bold text*");
  });

  it("converts italic correctly", () => {
    expect(markdownToMrkdwn("*italic text*")).toBe("_italic text_");
  });

  it("bold and italic in same string stay separate", () => {
    expect(markdownToMrkdwn("**bold** and *italic*")).toBe("*bold* and _italic_");
  });

  it("converts headers to bold", () => {
    expect(markdownToMrkdwn("## Hello")).toBe("*Hello*");
  });

  it("converts links", () => {
    expect(markdownToMrkdwn("[text](https://example.com)")).toBe("<https://example.com|text>");
  });

  it("converts strikethrough", () => {
    expect(markdownToMrkdwn("~~strike~~")).toBe("~strike~");
  });

  it("converts list items", () => {
    expect(markdownToMrkdwn("- item")).toBe("• item");
  });
});

describe("SlackFormatter.formatPermissionRequest", () => {
  it("returns section + actions with correct button values", () => {
    const req = {
      id: "req1",
      description: "Allow tool X?",
      options: [
        { id: "allow", label: "Allow", isAllow: true },
        { id: "deny",  label: "Deny",  isAllow: false },
      ],
    } as any;
    const blocks = fmt.formatPermissionRequest(req);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("actions");
    const actions = blocks[1] as any;
    expect(actions.elements[0].value).toBe("req1:allow");
    expect(actions.elements[1].value).toBe("req1:deny");
    expect(actions.elements[0].style).toBe("primary");
    expect(actions.elements[1].style).toBe("danger");
  });
});
