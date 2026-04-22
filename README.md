# cc-wechat

**简体中文** | [English](README_EN.md)

将个人微信桥接到本地 Claude Code 的命令行工具。通过微信与 Claude 实时对话，支持工具调用推送、思维链预览、权限审批、斜杠命令等。

## 功能特性

- 实时文本对话 — 通过微信发送消息，Claude 回复直接推送回微信
- 图片识别 — 发送照片让 Claude 分析
- 工具调用实时推送 — 实时查看 Claude 的工具执行（Bash、Read、Write 等）
- 思维预览 — 每次工具调用前展示 Claude 的推理摘要
- 中断支持 — Claude 处理中发送新消息可打断当前任务
- 权限审批 — 在微信中回复 y/n 控制工具执行
- 斜杠命令 — /help、/clear、/model、/status、/prompt 等
- 多账号 — 支持多个微信号同时在线
- 守护进程 — macOS launchd 自动启动和重启
- 完全自研 — 不依赖 OpenClaw 框架，直接实现微信 ilink bot API 协议

## 前置条件

- Node.js >= 18
- macOS 或 Linux
- 个人微信账号
- 已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)，并配置好 `ANTHROPIC_API_KEY`

## 安装

```bash
git clone https://github.com/your-username/cc-wechat.git
cd cc-wechat
npm install
npm run build
```

## 快速开始

### 1. 扫码绑定

```bash
npm run setup
```

终端会显示二维码，用微信扫码并确认。然后配置 Claude 的工作目录。

### 2. 启动服务

```bash
npm start
```

### 3. 在微信中聊天

直接在微信中发消息即可与 Claude Code 对话。

## 守护进程

```bash
npm run daemon -- start    # 安装并启动守护进程
npm run daemon -- stop     # 停止
npm run daemon -- restart  # 重启
npm run daemon -- status   # 查看状态
npm run daemon -- logs     # 查看日志路径
```

- **macOS**: 使用 launchd 注册开机自启和自动重启
- **Linux**: 需自行配置 systemd 或使用 nohup

## 微信端命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示所有命令 |
| `/clear` | 清除当前会话，新建对话 |
| `/reset` | 完全重置（会话 + 配置） |
| `/model <name>` | 切换模型（opus / sonnet / haiku） |
| `/permission <mode>` | 切换权限模式 |
| `/prompt [text]` | 查看或设置系统提示词 |
| `/status` | 查看当前会话状态 |
| `/cwd [path]` | 查看或切换工作目录 |
| `/history [n]` | 查看最近 n 条对话 |
| `/compact` | 压缩上下文，开始新会话 |

## 权限审批

当 Claude 请求执行工具时，微信会收到权限请求通知：

- 回复 `y` 或 `yes` 允许
- 回复 `n` 或 `no` 拒绝
- 120 秒未回复自动拒绝

通过 `/permission <mode>` 切换权限模式：

| 模式 | 说明 |
|------|------|
| `default` | 每次工具调用需手动审批 |
| `acceptEdits` | 文件读写自动通过，其他需审批 |
| `plan` | 只读模式，禁止所有工具 |
| `auto` | 自动通过所有工具（危险） |

## 工作原理

```
微信（手机） ←→ ilink bot API ←→ Node.js 守护进程 ←→ Claude CLI（本地）
```

1. 守护进程通过长轮询监听微信 ilink bot API 的新消息
2. 消息通过 Claude CLI 子进程转发给 Claude Code
3. 工具调用和思维摘要在 Claude 工作时实时推送回微信
4. 权限请求发送到微信，用户通过 y/n 审批
5. 回复分片发送回微信，自动处理限频

## 数据目录

所有数据存储在 `~/.cc-wechat/`：

```
~/.cc-wechat/
├── accounts/       # 微信账号凭证（每个账号一个 JSON，权限 0o600）
├── config.json     # 全局配置（工作目录、模型、权限模式、系统提示词）
├── sessions/       # 会话数据
├── sync-bufs/      # getUpdates 轮询游标
└── logs/           # 运行日志（每日轮转，保留 30 天）
```

## 开发

```bash
npm run dev         # 监听模式，TypeScript 文件变更时自动编译
npm run build       # 编译 TypeScript
npm run test        # 运行全部测试
npm run test:watch  # 测试监听模式
```

## 技术栈

- **TypeScript** — 类型安全
- **Node.js >= 18** — 内置 fetch、crypto，零外部 HTTP 依赖
- **Claude CLI** — 通过子进程调用本地 claude 命令行工具
- **Vitest** — 单元测试（42 个测试用例）

## 安全

- 凭证文件权限 `0o600`，仅当前用户可读
- Token 不写入日志（自动脱敏）
- 权限审批默认开启（default 模式）
- 不暴露任何 HTTP 端口（纯出站连接）
- AES 密钥仅用于 CDN 媒体加解密，不持久化

## License

MIT
