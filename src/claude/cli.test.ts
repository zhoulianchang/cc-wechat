import { describe, it, expect } from "vitest";
import { buildCliArgs, parseStreamLine, type CliRunOptions, type PermissionMode } from "./cli.js";

describe("buildCliArgs", () => {
  const baseOpts: CliRunOptions = {
    prompt: "hello",
    cwd: "/tmp/project",
    model: "claude-sonnet-4-6",
    permissionMode: "default" as PermissionMode,
  };

  it("constructs basic args", () => {
    const args = buildCliArgs(baseOpts);
    expect(args).toContain("-p");
    expect(args).toContain("hello");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--include-partial-messages");
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-6");
    expect(args).toContain("--cwd");
    expect(args).toContain("/tmp/project");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("default");
  });

  it("includes resume when sessionId provided", () => {
    const args = buildCliArgs({ ...baseOpts, sessionId: "sess-123" });
    expect(args).toContain("--resume");
    expect(args).toContain("sess-123");
  });

  it("includes append-system-prompt when systemPrompt provided", () => {
    const args = buildCliArgs({ ...baseOpts, systemPrompt: "use Chinese" });
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("use Chinese");
  });

  it("maps auto permission to bypassPermissions + dangerously-skip-permissions", () => {
    const args = buildCliArgs({ ...baseOpts, permissionMode: "auto" });
    expect(args).toContain("--permission-mode");
    expect(args).toContain("bypassPermissions");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("does not add resume/session/prompt flags when not provided", () => {
    const args = buildCliArgs(baseOpts);
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--append-system-prompt");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
});

describe("parseStreamLine", () => {
  it("extracts session_id from system/init", () => {
    const events = parseStreamLine('{"type":"system","subtype":"init","session_id":"abc123","tools":[]}');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "init",
      sessionId: "abc123",
    });
  });

  it("ignores hook_started and hook_response events", () => {
    expect(parseStreamLine('{"type":"system","subtype":"hook_started","hook_id":"x"}')).toEqual([]);
    expect(parseStreamLine('{"type":"system","subtype":"hook_response","hook_id":"x"}')).toEqual([]);
  });

  it("extracts tool_use from content_block_start", () => {
    const events = parseStreamLine(
      '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"ls"}}}'
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool_use_start",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });
  });

  it("extracts text_delta from content_block_delta", () => {
    const events = parseStreamLine(
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}'
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "text_delta",
      text: "Hello",
    });
  });

  it("extracts thinking_delta from content_block_delta", () => {
    const events = parseStreamLine(
      '{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}'
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "thinking_delta",
      thinking: "Let me think...",
    });
  });

  it("extracts text from assistant message", () => {
    const events = parseStreamLine(
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Final answer"}]},"session_id":"abc"}'
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "assistant_text",
      text: "Final answer",
    });
  });

  it("extracts result from success result", () => {
    const events = parseStreamLine(
      '{"type":"result","subtype":"success","result":"Done!","session_id":"abc","duration_ms":1000}'
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "result",
      subtype: "success",
      result: "Done!",
      sessionId: "abc",
    });
  });

  it("extracts result from error result", () => {
    const events = parseStreamLine(
      '{"type":"result","subtype":"error","result":"Something failed","session_id":"abc","duration_ms":500}'
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "result",
      subtype: "error",
      result: "Something failed",
      sessionId: "abc",
    });
  });

  it("returns empty for unknown lines", () => {
    expect(parseStreamLine("not json")).toEqual([]);
    expect(parseStreamLine('{"type":"unknown"}')).toEqual([]);
    expect(parseStreamLine("")).toEqual([]);
  });
});
