import { describe, it, expect } from "vitest";
import { splitMessage, formatToolSummary } from "./events.js";

describe("splitMessage", () => {
  it("returns single chunk for short text", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("returns empty array for empty text", () => {
    expect(splitMessage("")).toEqual([]);
  });

  it("splits at newlines when possible", () => {
    const text = "a".repeat(3000) + "\n" + "b".repeat(2000);
    const chunks = splitMessage(text, 4000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].startsWith("a")).toBe(true);
    expect(chunks[1].startsWith("b")).toBe(true);
  });

  it("splits at max length when no newlines", () => {
    const text = "x".repeat(10000);
    const chunks = splitMessage(text, 4000);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(4000);
  });
});

describe("formatToolSummary", () => {
  it("formats Bash command", () => {
    const summary = formatToolSummary("Bash", { command: "npm test" });
    expect(summary).toContain("🔧");
    expect(summary).toContain("npm test");
  });

  it("formats Read file path", () => {
    const summary = formatToolSummary("Read", { file_path: "/src/index.ts" });
    expect(summary).toContain("📖");
    expect(summary).toContain("/src/index.ts");
  });

  it("formats unknown tool", () => {
    const summary = formatToolSummary("CustomTool", {});
    expect(summary).toContain("🔧");
    expect(summary).toContain("CustomTool");
  });
});