import { describe, it, expect } from "vitest";
import { parseCommand } from "./commands.js";

describe("parseCommand", () => {
  it("parses command without args", () => {
    const result = parseCommand("/help");
    expect(result).toEqual({ command: "help", args: "" });
  });

  it("parses command with args", () => {
    const result = parseCommand("/model opus");
    expect(result).toEqual({ command: "model", args: "opus" });
  });

  it("parses command with multi-word args", () => {
    const result = parseCommand("/prompt use Chinese");
    expect(result).toEqual({ command: "prompt", args: "use Chinese" });
  });

  it("returns null for non-command text", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });

  it("normalizes command to lowercase", () => {
    const result = parseCommand("/HELP");
    expect(result?.command).toBe("help");
  });
});