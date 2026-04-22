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

export type StreamEvent =
  | { type: "init"; sessionId: string }
  | { type: "tool_use_start"; toolName: string; toolInput: Record<string, unknown> }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "assistant_text"; text: string }
  | { type: "result"; subtype: string; result: string; sessionId: string };

export function parseStreamLine(line: string): StreamEvent[] {
  if (!line.trim()) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }

  const type = parsed.type as string;
  const subtype = parsed.subtype as string | undefined;

  // system/init → 提取 session_id
  if (type === "system" && subtype === "init") {
    return [{ type: "init", sessionId: parsed.session_id as string }];
  }

  // 忽略 hook 事件
  if (type === "system" && (subtype === "hook_started" || subtype === "hook_response")) {
    return [];
  }

  // content_block_start (tool_use)
  if (type === "content_block_start") {
    const block = parsed.content_block as Record<string, unknown> | undefined;
    if (block?.type === "tool_use") {
      return [{
        type: "tool_use_start",
        toolName: block.name as string,
        toolInput: (block.input ?? {}) as Record<string, unknown>,
      }];
    }
    return [];
  }

  // content_block_delta
  if (type === "content_block_delta") {
    const delta = parsed.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta") {
      return [{ type: "text_delta", text: delta.text as string }];
    }
    if (delta?.type === "thinking_delta") {
      return [{ type: "thinking_delta", thinking: delta.thinking as string }];
    }
    return [];
  }

  // assistant 完整消息
  if (type === "assistant") {
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = message?.content as Array<Record<string, unknown>> | undefined;
    if (content) {
      const text = content
        .filter((b) => b.type === "text")
        .map((b) => b.text as string)
        .join("");
      if (text) {
        return [{ type: "assistant_text", text }];
      }
    }
    return [];
  }

  // result
  if (type === "result") {
    return [{
      type: "result",
      subtype: subtype ?? "unknown",
      result: (parsed.result as string) ?? "",
      sessionId: (parsed.session_id as string) ?? "",
    }];
  }

  return [];
}
