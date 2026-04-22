import { describe, it, expect } from "vitest";
import { buildCliArgs, type CliRunOptions, type PermissionMode } from "./cli.js";

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
