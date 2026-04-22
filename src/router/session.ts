import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";
import {
  sessionKey,
  getOrCreateSession,
  clearSession,
  runClaudeQuery,
  abortSession,
  type ClaudeSessionConfig,
} from "../claude/bridge.js";
import { createEventHandler, sendFinalReply } from "../claude/events.js";
import { getConfig, type WechatApiOptions } from "../wechat/api.js";
import type { WeixinMessage } from "../wechat/types.js";
import { loadAccount } from "../wechat/auth.js";

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
    model: global.model || "claude-sonnet-4-6",
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
