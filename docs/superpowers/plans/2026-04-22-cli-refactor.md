# Claude CLI 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 cc-wechat 的 Claude 集成从 `@anthropic-ai/claude-agent-sdk` 改为 `claude` CLI 子进程调用（stream-json 流式输出 + resume 会话）。

**Architecture:** 每次收到微信消息时启动 `claude -p <msg> --output-format stream-json --verbose --include-partial-messages` 子进程，解析 NDJSON 流实时推送回微信，用 `--resume <sessionId>` 维持多轮对话。移除 SDK 依赖和微信端权限审批。

**Tech Stack:** TypeScript, Node.js >= 18, `child_process.spawn`（内置）, `claude` CLI（需预装）

**设计文档:** `docs/superpowers/specs/2026-04-22-cli-refactor-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/claude/cli.ts` | 新增 | CLI 子进程管理 + stream-json NDJSON 解析 + 中断 |
| `src/claude/cli.test.ts` | 新增 | cli.ts 单元测试 |
| `src/claude/bridge.ts` | 重写 | 简化会话管理（移除 SDK/审批），调用 cli.ts |
| `src/claude/events.ts` | 修改 | 适配 CLI 事件格式，移除 permission_request |
| `src/claude/events.test.ts` | 不变 | splitMessage/formatToolSummary 测试不变 |
| `src/router/session.ts` | 修改 | 移除 y/n 审批分支 |
| `src/router/commands.ts` | 修改 | `/permission` 行为简化 |
| `src/e2e.test.ts` | 修改 | 适配新接口 |
| `package.json` | 修改 | 移除 `@anthropic-ai/claude-agent-sdk` |

---

## Phase 1: CLI 集成核心

### Task 1: CLI 参数构造与子进程管理

**Files:**
- Create: `src/claude/cli.ts`
- Create: `src/claude/cli.test.ts`

- [ ] **Step 1: 编写 cli.ts 的参数构造测试**

创建 `src/claude/cli.test.ts`：

```typescript
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/claude/cli.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 创建 `src/claude/cli.ts` 的参数构造部分**

创建完整文件 `src/claude/cli.ts`（import 包含后续 Task 2/3 需要的 `spawn` 和 `createInterface`）：

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/claude/cli.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: 提交**

```bash
git add src/claude/cli.ts src/claude/cli.test.ts
git commit -m "feat(claude): add CLI argument builder for claude subprocess"
```

---

### Task 2: stream-json 解析与事件分发

**Files:**
- Modify: `src/claude/cli.ts`
- Modify: `src/claude/cli.test.ts`

- [ ] **Step 1: 编写 stream-json 解析测试**

在 `src/claude/cli.test.ts` 中追加：

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { parseStreamLine, type StreamEvent } from "./cli.js";

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/claude/cli.test.ts`
Expected: parseStreamLine tests FAIL — function not defined

- [ ] **Step 3: 实现 parseStreamLine**

在 `src/claude/cli.ts` 中追加：

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/claude/cli.test.ts`
Expected: 所有测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src/claude/cli.ts src/claude/cli.test.ts
git commit -m "feat(claude): add stream-json NDJSON line parser with event extraction"
```

---

### Task 3: runClaudeCli 完整实现

**Files:**
- Modify: `src/claude/cli.ts`
- Modify: `src/claude/cli.test.ts`

- [ ] **Step 1: 编写 runClaudeCli 集成测试（mock child_process）**

在 `src/claude/cli.test.ts` 中追加：

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClaudeCli } from "./cli.js";

// Mock child_process.spawn
const mockChild = {
  stdout: new EventEmitter(),
  stderr: new EventEmitter(),
  killed: false,
  killSignal: "",
  kill: vi.fn(function (this: { killed: boolean; killSignal: string }, sig: string) {
    this.killSignal = sig;
    this.killed = true;
    return true;
  }),
  on: vi.fn(function (this: any, event: string, handler: (...args: any[]) => void) {
    if (event === "close") this._closeHandler = handler;
    if (event === "error") this._errorHandler = handler;
  }),
  _closeHandler: null as ((code: number | null) => void) | null,
  _errorHandler: null as ((err: Error) => void) | null,
};

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => mockChild),
}));

beforeEach(() => {
  mockChild.stdout.removeAllListeners();
  mockChild.stderr.removeAllListeners();
  mockChild.killed = false;
  mockChild.killSignal = "";
  mockChild.kill.mockClear();
  mockChild.on.mockClear();
  mockChild._closeHandler = null;
  mockChild._errorHandler = null;
});

describe("runClaudeCli", () => {
  it("spawns claude process with correct args", async () => {
    const runPromise = runClaudeCli({
      prompt: "hello",
      cwd: "/tmp",
      model: "sonnet",
      permissionMode: "default",
    });

    // 模拟 CLI 输出
    process.nextTick(() => {
      mockChild.stdout.emit("data", Buffer.from('{"type":"system","subtype":"init","session_id":"s1","tools":[]}\n'));
      mockChild.stdout.emit("data", Buffer.from('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}\n'));
      mockChild.stdout.emit("data", Buffer.from('{"type":"result","subtype":"success","result":"hi","session_id":"s1"}\n'));
      mockChild._closeHandler?.(0);
    });

    const result = await runPromise;
    expect(result.sessionId).toBe("s1");
    expect(result.finalText).toBe("hi");
  });

  it("captures tool_use events via onEvent callback", async () => {
    const events: StreamEvent[] = [];
    const runPromise = runClaudeCli(
      { prompt: "test", cwd: "/tmp", model: "sonnet", permissionMode: "default" },
      (evt) => { events.push(evt); },
    );

    process.nextTick(() => {
      mockChild.stdout.emit("data", Buffer.from('{"type":"system","subtype":"init","session_id":"s1","tools":[]}\n'));
      mockChild.stdout.emit("data", Buffer.from('{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"Bash","input":{"command":"ls"}}}\n'));
      mockChild.stdout.emit("data", Buffer.from('{"type":"result","subtype":"success","result":"done","session_id":"s1"}\n'));
      mockChild._closeHandler?.(0);
    });

    const result = await runPromise;
    expect(events).toHaveLength(2); // init + tool_use_start
    expect(events[0].type).toBe("init");
    expect(events[1].type).toBe("tool_use_start");
  });

  it("kills process on abort signal", async () => {
    const controller = new AbortController();
    const runPromise = runClaudeCli({
      prompt: "long task",
      cwd: "/tmp",
      model: "sonnet",
      permissionMode: "default",
      abortSignal: controller.signal,
    });

    process.nextTick(() => {
      mockChild.stdout.emit("data", Buffer.from('{"type":"system","subtype":"init","session_id":"s1","tools":[]}\n'));
      controller.abort();
    });

    await runPromise;
    expect(mockChild.killed).toBe(true);
    expect(mockChild.killSignal).toBe("SIGTERM");
  });

  it("returns error text on non-zero exit", async () => {
    const runPromise = runClaudeCli({
      prompt: "error test",
      cwd: "/tmp",
      model: "sonnet",
      permissionMode: "default",
    });

    process.nextTick(() => {
      mockChild.stderr.emit("data", Buffer.from("CLI error occurred"));
      mockChild._closeHandler?.(1);
    });

    const result = await runPromise;
    expect(result.finalText).toContain("CLI error occurred");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/claude/cli.test.ts`
Expected: runClaudeCli tests FAIL — function not defined

- [ ] **Step 3: 实现 runClaudeCli**

在 `src/claude/cli.ts` 中追加（文件顶部已有 `import { spawn } from "node:child_process"` 和 `import { createInterface } from "node:readline"`，确保这两个 import 在 Task 1 的代码中已加入）：

```typescript
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

  // 读取 stderr
  const stderrRl = createInterface({ input: child.stderr! });
  stderrRl.on("line", (line) => {
    stderrText += line + "\n";
    logger.debug(`claude stderr: ${line}`);
  });

  // 读取 stdout，逐行解析
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

  // 处理 abort signal
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/claude/cli.test.ts`
Expected: 所有测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src/claude/cli.ts src/claude/cli.test.ts
git commit -m "feat(claude): add runClaudeCli with stream-json parsing and abort support"
```

---

## Phase 2: 会话管理重写

### Task 4: 重写 bridge.ts

**Files:**
- Rewrite: `src/claude/bridge.ts`

- [ ] **Step 1: 重写 `src/claude/bridge.ts`**

完全替换文件内容：

```typescript
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { logger } from "../utils/logger.js";
import { runClaudeCli, type PermissionMode, type StreamEvent } from "./cli.js";

export type { PermissionMode } from "./cli.js";

export interface ClaudeSessionConfig {
  workingDir: string;
  model: string;
  permissionMode: PermissionMode;
  systemPrompt?: string;
}

export interface ClaudeSession {
  sessionId: string;
  cliSessionId: string;
  config: ClaudeSessionConfig;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  childProcess: ChildProcess | null;
}

const sessions = new Map<string, ClaudeSession>();

export function sessionKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

export function getOrCreateSession(
  key: string,
  defaults: ClaudeSessionConfig,
): ClaudeSession {
  const existing = sessions.get(key);
  if (existing) return existing;

  const session: ClaudeSession = {
    sessionId: randomUUID(),
    cliSessionId: "",
    config: { ...defaults },
    history: [],
    childProcess: null,
  };
  sessions.set(key, session);
  logger.info(`Session created: ${key}`);
  return session;
}

export function getSession(key: string): ClaudeSession | undefined {
  return sessions.get(key);
}

export function clearSession(key: string): void {
  const session = sessions.get(key);
  if (session?.childProcess) {
    session.childProcess.kill("SIGTERM");
  }
  sessions.delete(key);
  logger.info(`Session cleared: ${key}`);
}

export function updateSessionConfig(
  key: string,
  updates: Partial<ClaudeSessionConfig>,
): void {
  const session = sessions.get(key);
  if (!session) return;
  session.config = { ...session.config, ...updates };
}

export async function runClaudeQuery(
  session: ClaudeSession,
  userMessage: string,
  onEvent: (event: unknown) => Promise<void>,
): Promise<string> {
  session.history.push({ role: "user", text: userMessage });

  const result = await runClaudeCli(
    {
      prompt: userMessage,
      cwd: session.config.workingDir,
      model: session.config.model,
      permissionMode: session.config.permissionMode,
      sessionId: session.cliSessionId || undefined,
      systemPrompt: session.config.systemPrompt || undefined,
    },
    (evt: StreamEvent) => {
      // 传递 CLI 事件给事件处理器
      onEvent(evt).catch((err) => {
        logger.error(`Event handler error: ${String(err)}`);
      });
    },
  );

  if (result.sessionId) {
    session.cliSessionId = result.sessionId;
  }

  if (result.finalText) {
    session.history.push({ role: "assistant", text: result.finalText });
  }

  return result.finalText;
}

export function abortSession(key: string): boolean {
  const session = sessions.get(key);
  if (!session?.childProcess) return false;
  session.childProcess.kill("SIGTERM");
  session.childProcess = null;
  return true;
}
```

- [ ] **Step 2: 运行 TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/claude/bridge.ts
git commit -m "refactor(claude): rewrite bridge.ts to use CLI subprocess instead of SDK"
```

---

## Phase 3: 事件处理适配

### Task 5: 修改 events.ts 适配 CLI 事件格式

**Files:**
- Modify: `src/claude/events.ts`

- [ ] **Step 1: 重写 `src/claude/events.ts` 的 createEventHandler**

替换 `createEventHandler` 函数，适配 CLI StreamEvent 格式。移除 `permission_request` 处理。保留 `splitMessage`、`formatToolSummary`、`sendFinalReply` 不变。

新文件完整内容：

```typescript
import type { WechatApiOptions } from "../wechat/api.js";
import { sendTextMessage, sendTyping } from "../wechat/api.js";
import { logger } from "../utils/logger.js";
import { TypingStatus } from "../wechat/types.js";
import type { StreamEvent } from "./cli.js";

const MAX_MESSAGE_LENGTH = 4000;
const THINKING_PREVIEW_LENGTH = 300;

export function splitMessage(
  text: string,
  maxLength: number = MAX_MESSAGE_LENGTH,
): string[] {
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

const TOOL_EMOJI: Record<string, string> = {
  Bash: "🔧",
  Read: "📖",
  Write: "✏️",
  Edit: "📝",
  Glob: "🔍",
  Grep: "🔎",
  WebSearch: "🌐",
  WebFetch: "🌐",
};

function toolDisplay(name: string): string {
  return `${TOOL_EMOJI[name] ?? "🔧"} ${name}`;
}

export function formatToolSummary(
  toolName: string,
  input: Record<string, unknown>,
): string {
  switch (toolName) {
    case "Bash": {
      const cmd = String(input.command ?? "").slice(0, 100);
      return `${toolDisplay("Bash")} ${cmd}`;
    }
    case "Read":
      return `${toolDisplay("Read")} ${String(input.file_path ?? "")}`;
    case "Write":
      return `${toolDisplay("Write")} ${String(input.file_path ?? "")}`;
    case "Edit":
      return `${toolDisplay("Edit")} ${String(input.file_path ?? "")}`;
    case "Glob":
      return `${toolDisplay("Glob")} ${String(input.pattern ?? "")}`;
    case "Grep":
      return `${toolDisplay("Grep")} ${String(input.pattern ?? "")}`;
    default:
      return `${toolDisplay(toolName)}`;
  }
}

export function createEventHandler(
  apiOpts: WechatApiOptions,
  toUserId: string,
  contextToken: string | undefined,
  typingTicket: string | undefined,
) {
  return async (event: StreamEvent): Promise<void> => {
    try {
      if (event.type === "tool_use_start") {
        if (typingTicket) {
          await sendTyping({
            ...apiOpts,
            body: {
              ilink_user_id: toUserId,
              typing_ticket: typingTicket,
              status: TypingStatus.TYPING,
            },
          });
        }

        await sendTextMessage({
          ...apiOpts,
          toUserId,
          text: formatToolSummary(event.toolName, event.toolInput),
          contextToken,
        });
      }

      if (event.type === "thinking_delta") {
        const thinking = event.thinking.slice(0, THINKING_PREVIEW_LENGTH);
        if (thinking) {
          await sendTextMessage({
            ...apiOpts,
            toUserId,
            text: `💭 ${thinking}...`,
            contextToken,
          });
        }
      }
    } catch (err) {
      logger.error(`Event handler error: ${String(err)}`);
    }
  };
}

export async function sendFinalReply(
  apiOpts: WechatApiOptions,
  toUserId: string,
  text: string,
  contextToken?: string,
): Promise<void> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await sendTextMessage({
      ...apiOpts,
      toUserId,
      text: chunk,
      contextToken,
    });
  }
}
```

- [ ] **Step 2: 运行 events.test.ts 确认已有测试通过**

Run: `npx vitest run src/claude/events.test.ts`
Expected: 6 tests PASS（splitMessage 和 formatToolSummary 测试不受影响）

- [ ] **Step 3: 提交**

```bash
git add src/claude/events.ts
git commit -m "refactor(claude): adapt events.ts to CLI StreamEvent format, remove permission_request"
```

---

## Phase 4: 路由层适配

### Task 6: 修改 session.ts — 移除审批分支

**Files:**
- Modify: `src/router/session.ts`

- [ ] **Step 1: 移除 y/n 审批分支和 simplify routeMessage**

替换 `routeMessage` 函数，移除审批相关逻辑。同时更新 import（移除 `resolveApproval`）。

新 `src/router/session.ts` 完整内容：

```typescript
import fs from "node:fs";
import path from "node:path";
import {
  sessionKey,
  getOrCreateSession,
  getSession,
  clearSession,
  updateSessionConfig,
  runClaudeQuery,
  abortSession,
  type ClaudeSessionConfig,
} from "../claude/bridge.js";
import { createEventHandler, sendFinalReply } from "../claude/events.js";
import { getConfig, type WechatApiOptions } from "../wechat/api.js";
import type { WeixinMessage } from "../wechat/types.js";
import { loadAccount } from "../wechat/auth.js";
import { logger } from "../utils/logger.js";

const DATA_DIR =
  process.env.CC_WECHAT_DATA_DIR?.trim() || `${process.env.HOME}/.cc-wechat`;
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

export interface GlobalConfig {
  workingDir?: string;
  model?: string;
  permissionMode?: string;
  systemPrompt?: string;
}

export function loadGlobalConfig(): GlobalConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as GlobalConfig;
  } catch {
    return {};
  }
}

export function saveGlobalConfig(config: GlobalConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function defaultSessionConfig(): ClaudeSessionConfig {
  const global = loadGlobalConfig();
  return {
    workingDir: global.workingDir || process.cwd(),
    model: global.model || "sonnet",
    permissionMode:
      (global.permissionMode as ClaudeSessionConfig["permissionMode"]) ||
      "default",
    systemPrompt: global.systemPrompt,
  };
}

export async function routeMessage(
  msg: WeixinMessage,
  accountId: string,
): Promise<void> {
  if (msg.message_type !== 1) return;
  if (!msg.from_user_id) return;

  const accountData = loadAccount(accountId);
  if (!accountData?.token || !accountData?.baseUrl) {
    logger.error(`Account ${accountId} not configured`);
    return;
  }

  const apiOpts: WechatApiOptions = {
    baseUrl: accountData.baseUrl,
    token: accountData.token,
  };

  const userId = msg.from_user_id;
  const key = sessionKey(accountId, userId);
  const session = getOrCreateSession(key, defaultSessionConfig());

  const textItems =
    msg.item_list?.filter(
      (i) => i.type === 1 && i.text_item?.text,
    ) ?? [];
  const userText = textItems.map((i) => i.text_item!.text!).join("").trim();

  if (!userText) return;

  let typingTicket: string | undefined;
  try {
    const configResp = await getConfig({
      ...apiOpts,
      ilinkUserId: userId,
      contextToken: msg.context_token,
    });
    typingTicket = configResp.typing_ticket;
  } catch {
    // best-effort
  }

  const onEvent = createEventHandler(
    apiOpts,
    userId,
    msg.context_token,
    typingTicket,
  ) as (event: unknown) => Promise<void>;

  if (session.childProcess) {
    abortSession(key);
    await sendFinalReply(
      apiOpts,
      userId,
      "⚠️ 已中断上一条任务，正在处理新消息...",
      msg.context_token,
    );
  }

  logger.info(`Routing message from ${userId}: ${userText.slice(0, 100)}`);
  const reply = await runClaudeQuery(session, userText, onEvent);

  if (reply) {
    await sendFinalReply(apiOpts, userId, reply, msg.context_token);
  }
}
```

- [ ] **Step 2: 运行 TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/router/session.ts
git commit -m "refactor(router): remove y/n approval branches, adapt to CLI subprocess session"
```

---

### Task 7: 修改 commands.ts — 简化 /permission

**Files:**
- Modify: `src/router/commands.ts`

- [ ] **Step 1: 更新 import 和 /permission 命令**

修改 `src/router/commands.ts`：

1. 移除 `resolveApproval` 的 import
2. 更新 `/permission` 命令帮助文本，说明不再支持微信端审批
3. 更新 `/help` 中 `/permission` 的描述

变更点：

```typescript
// import 变更：移除 resolveApproval
import { clearSession, getSession, updateSessionConfig, sessionKey, type PermissionMode } from "../claude/bridge.js";
```

```typescript
// /help 命令中 /permission 描述变更
"/permission <mode> — 切换权限模式 (default/acceptEdits/plan/auto)，直接控制 CLI 行为",
```

- [ ] **Step 2: 运行 commands.test.ts 确认通过**

Run: `npx vitest run src/router/commands.test.ts`
Expected: 5 tests PASS（parseCommand 测试不受影响）

- [ ] **Step 3: 提交**

```bash
git add src/router/commands.ts
git commit -m "refactor(commands): update /permission for CLI-based permission mode"
```

---

## Phase 5: 清理与验证

### Task 8: 移除 SDK 依赖，更新 package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 从 package.json 移除 SDK 依赖**

移除 `dependencies` 中的 `"@anthropic-ai/claude-agent-sdk": "^0.2.100"` 行。

- [ ] **Step 2: 重新安装依赖**

Run: `npm install`
Expected: package-lock.json 更新，SDK 被移除

- [ ] **Step 3: 运行完整编译**

Run: `npx tsc`
Expected: 编译成功，dist/ 生成

- [ ] **Step 4: 运行全部测试**

Run: `npx vitest run`
Expected: 所有测试 PASS

- [ ] **Step 5: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: remove @anthropic-ai/claude-agent-sdk dependency, use claude CLI"
```

---

### Task 9: 更新 e2e 测试和 README

**Files:**
- Modify: `src/e2e.test.ts`
- Modify: `README.md`

- [ ] **Step 1: 更新 `src/e2e.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { parseCommand } from "./router/commands.js";
import { splitMessage, formatToolSummary } from "./claude/events.js";
import { aesEcbEncrypt, aesEcbDecrypt } from "./wechat/cdn.js";
import { parseStreamLine, buildCliArgs } from "./claude/cli.js";

describe("End-to-end data flow", () => {
  it("command → parse → route", () => {
    const parsed = parseCommand("/model opus");
    expect(parsed).toEqual({ command: "model", args: "opus" });

    const nonCommand = parseCommand("hello world");
    expect(nonCommand).toBeNull();
  });

  it("Claude reply → split → send", () => {
    const longReply = "Line\n".repeat(2000);
    const chunks = splitMessage(longReply);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4001);
    }
  });

  it("tool event → format → push", () => {
    expect(formatToolSummary("Bash", { command: "npm test" })).toContain("npm test");
    expect(formatToolSummary("Read", { file_path: "/src/main.ts" })).toContain("/src/main.ts");
  });

  it("CDN encrypt → decrypt roundtrip", () => {
    const key = Buffer.alloc(16, 0xab);
    const data = Buffer.from("test image data for e2e");
    const encrypted = aesEcbEncrypt(data, key);
    const decrypted = aesEcbDecrypt(encrypted, key);
    expect(decrypted.toString()).toBe("test image data for e2e");
  });

  it("CLI args construction → stream parsing", () => {
    const args = buildCliArgs({
      prompt: "hello",
      cwd: "/tmp",
      model: "sonnet",
      permissionMode: "default",
      sessionId: "sess-abc",
    });
    expect(args).toContain("--resume");
    expect(args).toContain("sess-abc");

    const events = parseStreamLine(
      '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}}'
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use_start");
  });
});
```

- [ ] **Step 2: 更新 README.md 技术栈描述**

将：
```
- **@anthropic-ai/claude-agent-sdk** — Claude Code SDK
```
改为：
```
- **Claude CLI** — 通过子进程调用本地 `claude` 命令行工具
```

将：
```
微信（手机） ←→ ilink bot API ←→ Node.js 守护进程 ←→ Claude Agent SDK（本地）
```
改为：
```
微信（手机） ←→ ilink bot API ←→ Node.js 守护进程 ←→ Claude CLI 子进程（本地）
```

- [ ] **Step 3: 运行全部测试**

Run: `npx vitest run`
Expected: 所有测试 PASS

- [ ] **Step 4: 提交**

```bash
git add src/e2e.test.ts README.md
git commit -m "test: update e2e tests for CLI integration, update README"
```

---

## Self-Review

- **Spec 覆盖**: cli.ts (T1-T3) ✅, bridge.ts 重写 (T4) ✅, events.ts 适配 (T5) ✅, session.ts 移除审批 (T6) ✅, commands.ts 简化 (T7) ✅, package.json 清理 (T8) ✅, e2e + README (T9) ✅
- **占位符扫描**: 无 TBD/TODO，所有步骤包含完整代码
- **类型一致性**: `PermissionMode` 从 `cli.ts` 导出，bridge.ts 重新导出；`StreamEvent` 类型贯穿 cli.ts → events.ts；`CliRunOptions` / `CliRunResult` 接口一致
- **测试覆盖**: cli.test.ts 覆盖参数构造(5) + 流解析(9) + 集成(4) = 18 新测试，events.test.ts 原有 6 测试不变
