import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { logger } from "../utils/logger.js";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "auto";

export interface CliRunOptions {
  prompt: string;
  cwd: string;
  model: string;
  permissionMode: PermissionMode;
  sessionId?: string;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
}

export interface CliRunResult {
  sessionId: string;
  finalText: string;
}

export function buildCliArgs(opts: CliRunOptions): string[] {
  const args: string[] = [
    "-p", opts.prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", opts.model,
    "--cwd", opts.cwd,
  ];

  if (opts.permissionMode === "auto") {
    args.push("--permission-mode", "bypassPermissions");
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", opts.permissionMode);
  }

  if (opts.sessionId) {
    args.push("--resume", opts.sessionId);
  }

  if (opts.systemPrompt) {
    args.push("--append-system-prompt", opts.systemPrompt);
  }

  return args;
}
