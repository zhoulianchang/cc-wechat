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

const SIGKILL_TIMEOUT_MS = 5_000;

export async function runClaudeCli(
  opts: CliRunOptions,
  onEvent?: (event: StreamEvent) => void,
): Promise<CliRunResult> {
  const args = buildCliArgs(opts);
  logger.info(`Spawning claude: claude ${args.slice(0, 6).join(" ")}...`);

  const child = spawn("claude", args, {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  let sessionId = "";
  let finalText = "";
  let stderrText = "";

  const stderrRl = createInterface({ input: child.stderr! });
  stderrRl.on("line", (line) => {
    stderrText += line + "\n";
    logger.debug(`claude stderr: ${line}`);
  });

  const stdoutRl = createInterface({ input: child.stdout! });
  stdoutRl.on("line", (line) => {
    const events = parseStreamLine(line);
    for (const evt of events) {
      if (evt.type === "init") {
        sessionId = evt.sessionId;
      }
      if (evt.type === "assistant_text" && evt.text) {
        finalText = evt.text;
      }
      if (evt.type === "result") {
        sessionId = evt.sessionId;
        if (evt.subtype === "success" && evt.result) {
          finalText = evt.result;
        }
      }
      onEvent?.(evt);
    }
  });

  // abort signal 处理
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  if (opts.abortSignal) {
    const onAbort = () => {
      logger.info("Abort signal received, killing claude process");
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!child.killed) {
          logger.warn("Claude process did not exit, sending SIGKILL");
          child.kill("SIGKILL");
        }
      }, SIGKILL_TIMEOUT_MS);
    };
    if (opts.abortSignal.aborted) {
      onAbort();
    } else {
      opts.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  // 等待子进程退出
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
    child.on("error", (err) => {
      logger.error(`Claude process error: ${String(err)}`);
      resolve(-1);
    });
  });

  if (killTimer) clearTimeout(killTimer);
  logger.info(`Claude process exited with code ${exitCode}, session=${sessionId}`);

  if (exitCode !== 0 && !finalText) {
    finalText = stderrText.trim() || `Claude 进程异常退出 (code=${exitCode})`;
  }

  return { sessionId, finalText };
}
