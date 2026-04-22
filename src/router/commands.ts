import {
  clearSession,
  getSession,
  updateSessionConfig,
  sessionKey,
  type PermissionMode,
} from "../claude/bridge.js";
import {
  loadGlobalConfig,
  saveGlobalConfig,
} from "./session.js";

export interface CommandContext {
  accountId: string;
  userId: string;
  apiOpts: import("../wechat/api.js").WechatApiOptions;
  contextToken?: string;
  args: string;
}

type CommandHandler = (ctx: CommandContext) => Promise<string>;

const commands = new Map<string, CommandHandler>();

function register(name: string, handler: CommandHandler): void {
  commands.set(name, handler);
}

register("help", async () => {
  return [
    "可用命令：",
    "/help — 显示帮助",
    "/clear — 清除当前会话",
    "/reset — 完全重置（会话+配置）",
    "/model <name> — 切换模型 (opus/sonnet/haiku)",
    "/permission <mode> — 切换权限模式 (default/acceptEdits/plan/auto)",
    "/prompt [text] — 查看/设置系统提示词",
    "/status — 当前会话状态",
    "/cwd [path] — 查看/切换工作目录",
    "/compact — 压缩上下文",
    "/history [n] — 查看最近 n 条对话",
  ].join("\n");
});

register("clear", async (ctx) => {
  const key = sessionKey(ctx.accountId, ctx.userId);
  clearSession(key);
  return "✅ 会话已清除";
});

register("reset", async (ctx) => {
  const key = sessionKey(ctx.accountId, ctx.userId);
  clearSession(key);
  saveGlobalConfig({});
  return "✅ 已完全重置";
});

register("model", async (ctx) => {
  const modelArg = ctx.args.trim();
  if (!modelArg) {
    const config = loadGlobalConfig();
    return `当前模型: ${config.model || "claude-sonnet-4-6"}`;
  }
  const modelMap: Record<string, string> = {
    opus: "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
  };
  const resolved = modelMap[modelArg.toLowerCase()] || modelArg;
  const global = loadGlobalConfig();
  global.model = resolved;
  saveGlobalConfig(global);

  const key = sessionKey(ctx.accountId, ctx.userId);
  updateSessionConfig(key, { model: resolved });
  return `✅ 模型切换为: ${resolved}`;
});

register("permission", async (ctx) => {
  const mode = ctx.args.trim().toLowerCase() as PermissionMode;
  const validModes: PermissionMode[] = ["default", "acceptEdits", "plan", "auto"];
  if (!mode || !validModes.includes(mode)) {
    const config = loadGlobalConfig();
    return `当前权限模式: ${config.permissionMode || "default"}\n可选: ${validModes.join(", ")}`;
  }
  const global = loadGlobalConfig();
  global.permissionMode = mode;
  saveGlobalConfig(global);

  const key = sessionKey(ctx.accountId, ctx.userId);
  updateSessionConfig(key, { permissionMode: mode });
  return `✅ 权限模式切换为: ${mode}`;
});

register("prompt", async (ctx) => {
  const text = ctx.args.trim();
  if (!text) {
    const config = loadGlobalConfig();
    return config.systemPrompt
      ? `当前提示词:\n${config.systemPrompt}`
      : "未设置系统提示词";
  }
  const global = loadGlobalConfig();
  global.systemPrompt = text;
  saveGlobalConfig(global);

  const key = sessionKey(ctx.accountId, ctx.userId);
  updateSessionConfig(key, { systemPrompt: text });
  return `✅ 系统提示词已设置`;
});

register("status", async (ctx) => {
  const key = sessionKey(ctx.accountId, ctx.userId);
  const session = getSession(key);
  const config = loadGlobalConfig();
  const lines = [
    `会话: ${session ? "活跃" : "无"}`,
    `模型: ${config.model || "claude-sonnet-4-6"}`,
    `权限: ${config.permissionMode || "default"}`,
    `工作目录: ${config.workingDir || process.cwd()}`,
    `对话轮数: ${session?.history.length ?? 0}`,
    `提示词: ${config.systemPrompt ? "已设置" : "无"}`,
  ];
  return lines.join("\n");
});

register("cwd", async (ctx) => {
  const newPath = ctx.args.trim();
  if (!newPath) {
    const config = loadGlobalConfig();
    return `当前工作目录: ${config.workingDir || process.cwd()}`;
  }
  const global = loadGlobalConfig();
  global.workingDir = newPath;
  saveGlobalConfig(global);

  const key = sessionKey(ctx.accountId, ctx.userId);
  updateSessionConfig(key, { workingDir: newPath });
  return `✅ 工作目录切换为: ${newPath}`;
});

register("history", async (ctx) => {
  const key = sessionKey(ctx.accountId, ctx.userId);
  const session = getSession(key);
  if (!session || session.history.length === 0) return "暂无对话历史";

  const n = Math.min(parseInt(ctx.args) || 5, 20);
  const recent = session.history.slice(-n * 2);
  return recent
    .map((h) => `${h.role === "user" ? "👤" : "🤖"} ${h.text.slice(0, 100)}`)
    .join("\n");
});

register("compact", async (ctx) => {
  const key = sessionKey(ctx.accountId, ctx.userId);
  clearSession(key);
  return "✅ 上下文已压缩（新会话，历史保留在日志中）";
});

export function parseCommand(
  text: string,
): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: "" };
  }
  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1),
  };
}

export async function handleCommand(
  ctx: CommandContext,
): Promise<string | null> {
  const parsed = parseCommand(ctx.args);
  if (!parsed) return null;

  const handler = commands.get(parsed.command);
  if (!handler)
    return `未知命令: /${parsed.command}\n输入 /help 查看可用命令`;

  return await handler({ ...ctx, args: parsed.args });
}