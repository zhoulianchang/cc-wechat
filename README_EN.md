# cc-wechat

[中文](README.md) | **English**

A CLI tool that bridges personal WeChat to your local Claude Code. Chat with Claude in real-time via WeChat, with tool call push notifications, thinking previews, permission approvals, slash commands, and more.

## Features

- Real-time text conversation — send messages via WeChat, Claude replies are pushed back directly
- Image recognition — send photos for Claude to analyze
- Tool call push — watch Claude's tool execution in real-time (Bash, Read, Write, etc.)
- Thinking preview — see Claude's reasoning summary before each tool call
- Interrupt support — send a new message to interrupt Claude while it's working
- Permission approval — reply y/n in WeChat to approve or deny tool execution
- Slash commands — /help, /clear, /model, /status, /prompt, and more
- Multi-account — multiple WeChat accounts online simultaneously
- Daemon process — macOS launchd auto-start and auto-restart
- Fully self-built — no dependency on OpenClaw framework, implements WeChat ilink bot API protocol directly

## Prerequisites

- Node.js >= 18
- macOS or Linux
- Personal WeChat account
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed with `ANTHROPIC_API_KEY` configured

## Installation

```bash
git clone https://github.com/your-username/cc-wechat.git
cd cc-wechat
npm install
npm run build
```

## Quick Start

### 1. Bind WeChat account

```bash
npm run setup
```

A QR code will appear in the terminal. Scan it with WeChat and confirm. Then configure Claude's working directory.

### 2. Start the service

```bash
npm start
```

### 3. Chat in WeChat

Send any message in WeChat to start chatting with Claude Code.

## Daemon

```bash
npm run daemon -- start    # Install and start daemon
npm run daemon -- stop     # Stop
npm run daemon -- restart  # Restart
npm run daemon -- status   # Check status
npm run daemon -- logs     # Show log file path
```

- **macOS**: Uses launchd for auto-start on login and automatic restart
- **Linux**: Configure systemd manually or use nohup

## WeChat Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/clear` | Clear current session, start fresh |
| `/reset` | Full reset (session + config) |
| `/model <name>` | Switch model (opus / sonnet / haiku) |
| `/permission <mode>` | Switch permission mode |
| `/prompt [text]` | View or set system prompt |
| `/status` | View current session state |
| `/cwd [path]` | View or switch working directory |
| `/history [n]` | View last n messages |
| `/compact` | Compact context, start new session |

## Permission Approval

When Claude requests to execute a tool, you'll receive a permission request in WeChat:

- Reply `y` or `yes` to allow
- Reply `n` or `no` to deny
- No response within 120 seconds = auto-deny

Switch permission mode with `/permission <mode>`:

| Mode | Description |
|------|-------------|
| `default` | Manual approval for each tool use |
| `acceptEdits` | Auto-approve file read/write, others need approval |
| `plan` | Read-only mode, all tools blocked |
| `auto` | Auto-approve everything (dangerous) |

## How It Works

```
WeChat (phone) <-> ilink bot API <-> Node.js daemon <-> Claude Agent SDK (local)
```

1. The daemon long-polls the WeChat ilink bot API for new messages
2. Messages are forwarded to Claude Code via `@anthropic-ai/claude-agent-sdk`
3. Tool calls and thinking summaries are pushed to WeChat in real-time as Claude works
4. Permission requests are sent to WeChat; users approve/deny with y/n
5. Replies are split and sent back to WeChat with automatic rate-limit handling

## Data Directory

All data is stored in `~/.cc-wechat/`:

```
~/.cc-wechat/
├── accounts/       # WeChat credentials (one JSON per account, permission 0o600)
├── config.json     # Global config (working directory, model, permission mode, system prompt)
├── sessions/       # Session data
├── sync-bufs/      # getUpdates polling cursors
└── logs/           # Logs (daily rotation, 30-day retention)
```

## Development

```bash
npm run dev         # Watch mode — auto-compile on TypeScript changes
npm run build       # Compile TypeScript
npm run test        # Run all tests
npm run test:watch  # Test watch mode
```

## Tech Stack

- **TypeScript** — Type safety
- **Node.js >= 18** — Built-in fetch, crypto; zero external HTTP dependencies
- **@anthropic-ai/claude-agent-sdk** — Claude Code SDK
- **Vitest** — Unit testing (42 test cases)

## Security

- Credential files have `0o600` permissions (owner read/write only)
- Tokens are never written to logs (auto-redacted)
- Permission approval is on by default (default mode)
- No inbound HTTP ports (outbound connections only)
- AES keys are used for CDN media encryption/decryption only and never persisted

## License

MIT
