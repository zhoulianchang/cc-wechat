import { getUpdates, type WechatApiOptions } from "./wechat/api.js";
import { loadAccount, listAccountIds } from "./wechat/auth.js";
import { routeMessage } from "./router/session.js";
import { handleCommand, type CommandContext } from "./router/commands.js";
import { sendFinalReply } from "./claude/events.js";
import { logger } from "./utils/logger.js";
import type { WeixinMessage } from "./wechat/types.js";

const syncBufs = new Map<string, string>();

let running = false;

export async function start(): Promise<void> {
  const accountIds = listAccountIds();
  if (accountIds.length === 0) {
    logger.error("没有已绑定的微信账号，请先运行: npm run setup");
    process.exit(1);
  }

  running = true;
  logger.info(`启动消息循环，监听 ${accountIds.length} 个账号`);

  const loops = accountIds.map((id) => messageLoop(id));
  await Promise.all(loops);
}

async function messageLoop(accountId: string): Promise<void> {
  const account = loadAccount(accountId);
  if (!account?.token || !account?.baseUrl) {
    logger.error(`账号 ${accountId} 凭证无效，跳过`);
    return;
  }

  const apiOpts: WechatApiOptions = {
    baseUrl: account.baseUrl,
    token: account.token,
  };

  logger.info(`账号 ${accountId} 开始消息循环`);

  while (running) {
    try {
      const buf = syncBufs.get(accountId) ?? "";
      const resp = await getUpdates({
        ...apiOpts,
        get_updates_buf: buf,
      });

      if (resp.errcode === -14) {
        logger.warn(`账号 ${accountId} 会话超时，需要重新登录`);
        break;
      }

      if (resp.ret !== 0 && resp.ret !== undefined) {
        logger.warn(
          `getUpdates 返回错误: ret=${resp.ret} ${resp.errmsg ?? ""}`,
        );
        await sleep(5000);
        continue;
      }

      if (resp.get_updates_buf) {
        syncBufs.set(accountId, resp.get_updates_buf);
      }

      if (resp.msgs && resp.msgs.length > 0) {
        for (const msg of resp.msgs) {
          await processMessage(msg, accountId, apiOpts);
        }
      }
    } catch (err) {
      logger.error(`消息循环错误: ${String(err)}`);
      await sleep(5000);
    }
  }
}

async function processMessage(
  msg: WeixinMessage,
  accountId: string,
  apiOpts: WechatApiOptions,
): Promise<void> {
  if (msg.message_type !== 1) return;
  if (!msg.from_user_id) return;

  const text = msg.item_list
    ?.filter((i) => i.type === 1 && i.text_item?.text)
    ?.map((i) => i.text_item!.text!)
    ?.join("")
    ?.trim();

  if (!text) return;

  const cmdCtx: CommandContext = {
    accountId,
    userId: msg.from_user_id,
    apiOpts,
    contextToken: msg.context_token,
    args: text,
  };

  const cmdResult = await handleCommand(cmdCtx);
  if (cmdResult !== null) {
    await sendFinalReply(
      apiOpts,
      msg.from_user_id,
      cmdResult,
      msg.context_token,
    );
    return;
  }

  await routeMessage(msg, accountId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

process.on("SIGINT", () => {
  logger.info("收到 SIGINT，正在停止...");
  running = false;
});
process.on("SIGTERM", () => {
  logger.info("收到 SIGTERM，正在停止...");
  running = false;
});

if (
  process.argv[1]?.endsWith("index.js") ||
  process.argv[1]?.endsWith("index.ts")
) {
  start().catch((err) => {
    logger.error(`启动失败: ${String(err)}`);
    process.exit(1);
  });
}
