import { describe, it, expect } from "vitest";
import { parseCommand } from "./router/commands.js";
import { splitMessage, formatToolSummary } from "./claude/events.js";
import { aesEcbEncrypt, aesEcbDecrypt } from "./wechat/cdn.js";

describe("End-to-end data flow", () => {
  it("command -> parse -> route", () => {
    const parsed = parseCommand("/model opus");
    expect(parsed).toEqual({ command: "model", args: "opus" });

    const nonCommand = parseCommand("hello world");
    expect(nonCommand).toBeNull();
  });

  it("Claude reply -> split -> send", () => {
    const longReply = "Line\n".repeat(2000);
    const chunks = splitMessage(longReply);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4001);
    }
  });

  it("tool event -> format -> push", () => {
    expect(
      formatToolSummary("Bash", { command: "npm test" }),
    ).toContain("npm test");
    expect(
      formatToolSummary("Read", { file_path: "/src/main.ts" }),
    ).toContain("/src/main.ts");
  });

  it("CDN encrypt -> decrypt roundtrip", () => {
    const key = Buffer.alloc(16, 0xab);
    const data = Buffer.from("test image data for e2e");
    const encrypted = aesEcbEncrypt(data, key);
    const decrypted = aesEcbDecrypt(encrypted, key);
    expect(decrypted.toString()).toBe("test image data for e2e");
  });
});
