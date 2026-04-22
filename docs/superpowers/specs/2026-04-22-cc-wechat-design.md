# cc-wechat: Claude Code 微信桥接工具

> 独立 Node.js 守护进程，通过微信 ilink bot API 将个人微信桥接到本地 Claude Code（Claude Agent SDK）。
> 不依赖 OpenClaw 框架，完全自研协议实现。

## 1. 目标

- 在微信中与 Claude Code 实时对话：文本、图片、权限审批、斜杠命令
- 实时推送工具调用进度和思维链预览
- 支持中断当前任务
- 跨平台守护进程管理（macOS launchd / Linux systemd）

## 2. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    cc-wechat 守护进程                  │
│                                                     │
│  ┌──────────┐   ┌───────────┐   ┌────────────────┐  │
│  │ 微信 API  │   │  消息路由   │   │ Claude Agent   │  │
│  │  客户端   │──▶│  + 会话管理 │──▶│     SDK        │  │
│  │          │◀──│           │◀──│                │  │
│  └──────────┘   └───────────┘   └────────────────┘  │
│       ▲              │                    │          │
│       │         ┌────┴────┐         ┌────┴────┐     │
│       │         │命令处理器│         │事件推送  │     │
│       │         │/help等  │         │工具/思维 │     │
│       │         └─────────┘         └─────────┘     │
│       │                                             │
│  ┌────┴─────────┐                                   │
│  │ 登录/凭证管理 │                                   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
   ilink bot API              Claude Agent SDK
   (微信服务器)               (本地进程)
```

## 3. 模块设计

### 3.1 微信协议层 (`src/wechat/`)

#### 3.1.1 类型定义 (`types.ts`)

完整实现微信 ilink bot API 的 TypeScript 类型定义，包含：

- `WeixinMessage` — 统一消息（seq, from_user_id, item_list, context_token 等）
- `MessageItem` — 消息内容（text/image/voice/file/video）
- `CDNMedia` — CDN 媒体引用（encrypt_query_param, aes_key）
- `GetUpdatesReq/Resp` — 长轮询请求/响应
- `SendMessageReq/Resp` — 发送消息
- `GetUploadUrlReq/Resp` — CDN 上传预签名
- `SendTypingReq/Resp` — 输入状态
- 常量：`MessageType`（USER=1, BOT=2）、`MessageItemType`（TEXT=1, IMAGE=2, ...）、`MessageState`（NEW=0, GENERATING=1, FINISH=2）

#### 3.1.2 API 客户端 (`api.ts`)

HTTP 客户端，实现 5 个 API 端点（全部 POST，JSON）：

| 端点 | 路径 | 说明 | 默认超时 |
|------|------|------|---------|
| getUpdates | `ilink/bot/getupdates` | 长轮询新消息 | 35s |
| sendMessage | `ilink/bot/sendmessage` | 发送文本/图片/文件 | 15s |
| getUploadUrl | `ilink/bot/getuploadurl` | CDN 上传预签名 | 15s |
| getConfig | `ilink/bot/getconfig` | 获取 typing ticket | 10s |
| sendTyping | `ilink/bot/sendtyping` | 输入状态指示 | 10s |

通用请求头：

```
Content-Type: application/json
AuthorizationType: ilink_bot_token
Authorization: Bearer <token>
X-WECHAT-UIN: <base64(random_uint32)>
```

消息循环主逻辑：

```
while (running) {
  resp = await getUpdates({ get_updates_buf })
  if (resp.errcode === -14) → refreshToken(), continue
  for msg of resp.msgs → routeMessage(msg)
  get_updates_buf = resp.get_updates_buf
}
```

限频保护：指数退避，初始 1s，最大 30s，收到 429 时触发。

#### 3.1.3 扫码登录 (`auth.ts`)

完全自研的扫码登录流程，不依赖 OpenClaw：

**登录协议：**

1. `GET https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3`
   → 返回 `{ qrcode, qrcode_img_content }`（二维码 URL + 轮询 token）

2. `GET https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=<qrcode>`
   → 长轮询 35s，状态流转：wait → scaned → confirmed / expired
   → confirmed 时返回 `{ bot_token, ilink_bot_id, baseurl, ilink_user_id }`

**凭证存储：**

```
~/.cc-wechat/accounts/<bot-id>.json
{ token, baseUrl, userId, savedAt }
```

**登录流程特性：**
- 二维码过期自动刷新（最多 3 次）
- `scaned_but_redirect` 状态 → 切换 IDC 节点继续轮询
- 终端直接渲染 QR（`qrcode-terminal`）
- `npm run setup` 一键扫码

#### 3.1.4 CDN 媒体 (`cdn.ts` + `media.ts`)

AES-128-ECB 加解密实现：

- **下载**：从 CDN 下载加密数据 → `aes_key` 解密 → 明文文件
- **上传**：明文 → 计算 MD5 + 密文大小 → `getUploadUrl` → AES 加密 → PUT 上传 → 构造 CDNMedia 引用

图片处理：缩略图生成（IMAGE/VIDEO 必须）。

### 3.2 Claude Agent SDK 集成 (`src/claude/`)

#### 3.2.1 会话管理 (`bridge.ts`)

每个（微信用户 + 账号）对应一个 Claude SDK 会话：

```typescript
interface ClaudeSession {
  sdkSession: ClaudeAgentSession
  sdkConversation: Conversation
  workingDir: string
  model: string
  permissionMode: PermissionMode
  systemPrompt?: string
  pendingApproval?: ApprovalRequest
}
```

通过 `@anthropic-ai/claude-agent-sdk` 创建和管理会话，支持：
- 会话创建/恢复/销毁
- 模型切换（opus/sonnet/haiku）
- 工作目录切换
- 系统提示词注入

#### 3.2.2 事件处理与推送 (`events.ts`)

监听 Claude Agent SDK 事件，实时推送回微信：

| SDK 事件 | 微信推送内容 |
|----------|-------------|
| `tool_use_start` | `🔧 正在执行: {tool_name}` + sendTyping |
| `tool_use_result` | 工具执行结果摘要 |
| `thinking` | `💭 {前 300 字思维摘要}` |
| `text_delta` | 累积到一定长度分块推送 |
| `permission_request` | `🔑 权限请求: {tool} {input摘要}` |
| `error` | 错误信息 |
| `complete` | 最终完整回复 |

#### 3.2.3 中断机制

微信端发送新消息时，如果 Claude 正在处理：
1. 检测 interrupt 信号
2. `sdkSession.abort()` 终止当前运行
3. 发送确认：`⚠️ 已中断上一条任务，正在处理新消息`
4. 以新消息重新启动 Claude

### 3.3 消息路由层 (`src/router/`)

#### 3.3.1 会话路由 (`session.ts`)

- 按（账号 + 对端用户 ID）隔离会话
- 每个会话独立的 Claude SDK 会话实例
- `context_token` 管理（微信对话上下文）

#### 3.3.2 斜杠命令 (`commands.ts`)

| 命令 | 说明 |
|------|------|
| `/help` | 显示所有命令 |
| `/clear` | 清除当前会话，新建对话 |
| `/reset` | 完全重置（会话 + 配置） |
| `/model <name>` | 切换模型（opus/sonnet/haiku） |
| `/permission <mode>` | 切换权限模式 |
| `/prompt [text]` | 查看/设置系统提示词 |
| `/status` | 当前会话状态 |
| `/cwd [path]` | 查看/切换工作目录 |
| `/skills` | 列出已安装的 Claude Code Skill |
| `/history [n]` | 查看最近 n 条对话 |
| `/compact` | 压缩上下文（新建 SDK 会话，保留历史） |
| `/undo [n]` | 撤销最近 n 条对话 |
| `/ [args]` | 触发已安装的 Skill |

#### 3.3.3 权限审批 (`permissions.ts`)

```
Claude 请求工具权限
  → 缓存 ApprovalRequest { toolName, input, timeout: 120s }
  → sendMessage 给微信: "🔑 权限请求: {tool} {input摘要}"
  → 微信端回复 y/n
  → y: approve → 继续执行
  → n: reject → Claude 收到拒绝
  → 120s 超时: auto-reject
```

权限模式：

| 模式 | 行为 |
|------|------|
| `default` | 每次工具调用需审批 |
| `acceptEdits` | 文件读写自动通过，其他需审批 |
| `plan` | 只读，禁止所有工具 |
| `auto` | 全部自动通过（危险） |

### 3.4 守护进程 (`src/daemon/`)

管理命令：

```bash
npm run setup          # 扫码绑定微信
npm run daemon start   # 启动守护进程
npm run daemon stop    # 停止
npm run daemon restart # 重启
npm run daemon status  # 状态
npm run daemon logs    # 日志
```

平台支持：
- **macOS**: launchd plist 注册到 `~/Library/LaunchAgents/`
- **Linux**: systemd user service 或 nohup 回退

### 3.5 工具函数 (`src/utils/`)

- `logger.ts` — 结构化日志（daily rotation, 30 天保留）
- `retry.ts` — 指数退避重试工具

## 4. 增强功能（超越 wechat-claude-code）

1. **工具执行摘要** — Bash 显示命令行 + 前 10 行输出，Read/Write 显示文件路径
2. **长消息分片** — 超过 4000 字符自动分段发送
3. **Markdown 格式化** — 代码块用围栏格式，微信自动渲染
4. **会话上下文压缩** — `/compact` 触发 SDK 压缩
5. **多工作目录** — `/cwd` 支持在多个项目间切换

## 5. 数据目录

```
~/.cc-wechat/
├── accounts/          # 微信凭证（每个账号一个 JSON）
├── config.json        # 全局配置（工作目录、模型、权限模式）
├── sessions/          # 会话数据（每个对端一个 JSON）
├── sync-bufs/         # getUpdates 游标
└── logs/              # 运行日志（每日轮转，30 天保留）
```

## 6. 文件结构

```
src/
├── wechat/
│   ├── api.ts          // HTTP 客户端 + 5 个 API 端点 (~250 行)
│   ├── types.ts        // 协议类型定义 (~200 行)
│   ├── auth.ts         // 扫码登录 + 凭证管理 (~150 行)
│   ├── cdn.ts          // AES-128-ECB CDN 加解密 (~200 行)
│   └── media.ts        // 图片下载/上传 + 缩略图 (~150 行)
├── claude/
│   ├── bridge.ts       // Claude Agent SDK 会话管理 (~300 行)
│   └── events.ts       // 事件处理与推送 (~200 行)
├── router/
│   ├── session.ts      // 会话路由 + 上下文隔离 (~150 行)
│   ├── commands.ts     // 斜杠命令处理 (~200 行)
│   └── permissions.ts  // 权限审批流程 (~100 行)
├── daemon/
│   ├── index.ts        // 守护进程入口 (~80 行)
│   ├── launchd.ts      // macOS launchd 管理 (~80 行)
│   └── systemd.ts      // Linux systemd 管理 (~80 行)
├── utils/
│   ├── logger.ts       // 日志 (~60 行)
│   └── retry.ts        // 重试工具 (~40 行)
├── index.ts            // 消息循环主逻辑 (~100 行)
└── setup.ts            // npm run setup 入口 (~60 行)
```

总计约 18 个文件，~2400 行核心代码。

## 7. 依赖

### 运行时

- `@anthropic-ai/claude-agent-sdk` — Claude Code SDK
- `qrcode-terminal` — 终端 QR 渲染
- Node.js >= 18（内置 `fetch`、`crypto`、`fs`）

### 开发时

- `typescript` — 类型检查 + 编译
- `vitest` — 单元测试

### 零外部 HTTP/Media 依赖

所有 HTTP 调用使用 Node.js 内置 `fetch`，加解密使用内置 `crypto`，图片缩略图使用 `sharp`（如果需要）。

## 8. 安全考量

- 凭证文件权限 `0o600`，仅当前用户可读
- Token 不写入日志（redact 处理）
- 权限审批默认开启（`default` 模式）
- 不暴露任何 HTTP 端口（纯出站连接）
- AES 密钥仅用于 CDN 媒体加解密，不持久化
