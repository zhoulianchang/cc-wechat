# cc-wechat: Claude CLI 重构设计

> 将 Claude 集成从 `@anthropic-ai/claude-agent-sdk` 改为 `claude` CLI 子进程调用。
> 微信协议层、路由层、守护进程等模块不变。

## 1. 目标

- 移除 `@anthropic-ai/claude-agent-sdk` 依赖
- 改用 `child_process.spawn('claude', ...)` 调用本地 Claude CLI
- 使用 `--output-format stream-json` 解析流式输出
- 使用 `--resume <sessionId>` 维持多轮对话
- 简化权限控制（CLI `--permission-mode` 参数，不再微信端审批）

## 2. 改造范围

### 不变的模块

- `src/wechat/` — 整个微信协议层（types, api, auth, cdn, media）
- `src/utils/` — 日志和重试工具
- `src/daemon/` — 守护进程管理
- `src/setup.ts` — 设置入口
- `src/index.ts` — 主消息循环

### 变更的模块

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `package.json` | 修改 | 移除 `@anthropic-ai/claude-agent-sdk` |
| `src/claude/cli.ts` | 新增 | CLI 子进程管理 + stream-json 解析 |
| `src/claude/bridge.ts` | 重写 | 简化会话管理，调用 cli.ts |
| `src/claude/events.ts` | 修改 | 适配 CLI 输出格式 |
| `src/claude/events.test.ts` | 修改 | 更新测试 |
| `src/router/session.ts` | 微调 | 移除 y/n 审批分支 |
| `src/router/commands.ts` | 微调 | `/permission` 行为调整 |

## 3. 新增模块：CLI 集成（`src/claude/cli.ts`）

### 3.1 接口定义

```typescript
export interface CliRunOptions {
  prompt: string;
  cwd: string;
  model: string;
  permissionMode: PermissionMode;
  sessionId?: string;       // --resume
  systemPrompt?: string;    // --system-prompt
  abortSignal?: AbortSignal;
}

export interface CliRunResult {
  sessionId: string;
  finalText: string;
}
```

### 3.2 核心函数：runClaudeCli

```
runClaudeCli(opts, onEvent) → Promise<CliRunResult>

1. 构造 CLI 参数：
   claude -p <prompt> --output-format stream-json --verbose
         --include-partial-messages
         --model <model> --cwd <cwd>
         --permission-mode <mode>
         [--resume <sessionId>]
         [--append-system-prompt <text>]

2. spawn('claude', args) 启动子进程

3. 逐行读取 stdout，解析每行 JSON：
   - system/init → 提取 session_id（忽略 hook_started/hook_response）
   - assistant → 包含完整 message.content 数组
   - content_block_start (tool_use) → 推送工具开始事件
   - content_block_delta (text_delta/thinking_delta) → 推送增量事件
   - result → 提取最终结果文本和 session_id

4. 过滤不需要的事件：
   - 忽略 system/hook_started 和 system/hook_response（hook 系统事件）
   - 只处理 init、assistant、content_block_*、result 类型

5. abortSignal 触发时 → childProcess.kill('SIGTERM')
   5s 后未退出 → SIGKILL 兜底

6. 等待子进程退出，返回 CliRunResult
```

### 3.3 CLI 参数映射

| 配置项 | CLI 参数 |
|--------|---------|
| prompt | `-p <text>` |
| model | `--model <name>` |
| cwd | `--cwd <path>` |
| permissionMode (auto) | `--permission-mode bypassPermissions --dangerously-skip-permissions` |
| permissionMode (其他) | `--permission-mode <mode>` |
| sessionId | `--resume <id>` |
| systemPrompt | `--append-system-prompt <text>` |
| output format | `--output-format stream-json` |
| 必需 | `--verbose --include-partial-messages` |

### 3.4 stream-json 实际输出格式

经 `claude -p "say hi" --output-format stream-json --verbose --include-partial-messages` 实测验证：

**必须参数**：`--verbose`（stream-json 模式必须加）和 `--include-partial-messages`（获取流式 content_block 事件）

```json
// Hook 系统事件（忽略）
{"type":"system","subtype":"hook_started","hook_id":"...","hook_name":"SessionStart:startup",...}
{"type":"system","subtype":"hook_response","hook_id":"...","output":"...",...}

// 初始化事件（提取 session_id）
{"type":"system","subtype":"init","session_id":"abc123","tools":["Bash","Read",...],"model":"claude-sonnet-4-6","permissionMode":"default"}

// 助手完整消息
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}]},"session_id":"abc123"}

// 流式内容块（需 --include-partial-messages）
{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"Bash","input":{}}}
{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"..."}}
{"type":"content_block_stop","index":0}

// 最终结果
{"type":"result","subtype":"success","result":"最终回复文本","session_id":"abc123","duration_ms":12345,"total_cost_usd":0.01,...}
```

## 4. 重写模块：会话管理（`src/claude/bridge.ts`）

### 4.1 简化的 ClaudeSession

```typescript
export interface ClaudeSession {
  sessionId: string;
  cliSessionId: string;         // CLI session_id（用于 --resume）
  config: ClaudeSessionConfig;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  childProcess: ChildProcess | null;   // 当前运行的 claude 子进程
}
```

移除：
- `pendingApproval` — 不再需要权限审批
- `abortController` — 改为 `childProcess` 直接管理

### 4.2 runClaudeQuery 变化

```
旧: import { query } from '@anthropic-ai/claude-agent-sdk'
新: import { runClaudeCli } from './cli.js'

旧: for await (const message of query(queryOpts))
新: const result = await runClaudeCli(cliOpts, onEvent)
```

### 4.3 中断机制

```
旧: session.abortController.abort()
新: childProcess.kill('SIGTERM') + 5s SIGKILL 超时
```

## 5. 修改模块：事件处理（`src/claude/events.ts`）

### 5.1 不变的部分

- `splitMessage()` — 消息分片
- `formatToolSummary()` — 工具摘要格式化
- `sendFinalReply()` — 最终回复发送
- `createEventHandler()` 的整体结构

### 5.2 变化的部分

事件格式适配：

```
旧（SDK 格式）：
  event.type === 'stream_event'
  event.event.type === 'content_block_start'

新（CLI stream-json 格式）：
  event.type === 'content_block_start'     // 直接是 CLI 事件类型
  event.content_block.type === 'tool_use'
```

移除 `permission_request` 事件处理（不再微信端审批）。

## 6. 权限控制变化

### 6.1 移除

- `ApprovalRequest` 接口
- `resolveApproval()` 函数
- 微信端 y/n 审批推送
- `session.pendingApproval` 状态
- `routeMessage()` 中的 y/n 分支

### 6.2 替代

- CLI `--permission-mode` 参数直接控制
- `/permission` 命令设置 session config，下次调用时传入

## 7. 前置要求

- 用户需安装 `claude` CLI：`npm install -g @anthropic-ai/claude-code`
- CLI 已配置认证（`claude` 可正常使用）
- 无需 `ANTHROPIC_API_KEY` 环境变量（CLI 自管理认证）

## 8. 文件结构（变更后）

```
src/claude/
├── cli.ts         # 新增：CLI 子进程管理 + stream-json 解析 (~150 行)
├── bridge.ts      # 重写：简化会话管理 (~120 行)
└── events.ts      # 修改：适配 CLI 事件格式 (~130 行)
```

总计约 400 行核心改动，其余模块零改动。
