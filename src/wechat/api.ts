import crypto from "node:crypto";
import { logger } from "../utils/logger.js";
import { withRetry, isRateLimitError } from "../utils/retry.js";
import type {
  GetUpdatesReq,
  GetUpdatesResp,
  SendMessageReq,
  GetUploadUrlReq,
  GetUploadUrlResp,
  GetConfigResp,
  SendTypingReq,
  SendTypingResp,
} from "./types.js";

export interface WechatApiOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  longPollTimeoutMs?: number;
}

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildHeaders(token: string, bodyLength: number): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "Content-Length": String(bodyLength),
    "X-WECHAT-UIN": randomWechatUin(),
  };
}

async function apiPost<T>(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token: string;
  timeoutMs: number;
  label: string;
}): Promise<T> {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl));
  const headers = buildHeaders(params.token, Buffer.byteLength(params.body, "utf-8"));
  logger.debug(`POST ${url.pathname}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await res.text();
    logger.debug(`${params.label} status=${res.status}`);
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return JSON.parse(rawText) as T;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export async function getUpdates(
  opts: WechatApiOptions & GetUpdatesReq,
): Promise<GetUpdatesResp> {
  const timeout = opts.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    return await apiPost<GetUpdatesResp>({
      baseUrl: opts.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({ get_updates_buf: opts.get_updates_buf ?? "" }),
      token: opts.token,
      timeoutMs: timeout,
      label: "getUpdates",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.debug("getUpdates: long-poll timeout, returning empty response");
      return { ret: 0, msgs: [], get_updates_buf: opts.get_updates_buf };
    }
    throw err;
  }
}

export async function sendMessage(
  opts: WechatApiOptions & { body: SendMessageReq },
): Promise<void> {
  await apiPost<void>({
    baseUrl: opts.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify(opts.body),
    token: opts.token,
    timeoutMs: opts.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: "sendMessage",
  });
}

export async function sendTextMessage(
  opts: WechatApiOptions & {
    toUserId: string;
    text: string;
    contextToken?: string;
  },
): Promise<void> {
  await sendMessage({
    ...opts,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: opts.toUserId,
        client_id: `bot-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
        message_type: 2,
        message_state: 2,
        context_token: opts.contextToken,
        item_list: [{ type: 1, text_item: { text: opts.text } }],
      },
      base_info: { channel_version: "1.0.3" },
    },
  });
}

export async function getUploadUrl(
  opts: WechatApiOptions & GetUploadUrlReq,
): Promise<GetUploadUrlResp> {
  return await apiPost<GetUploadUrlResp>({
    baseUrl: opts.baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body: JSON.stringify({
      filekey: opts.filekey,
      media_type: opts.media_type,
      to_user_id: opts.to_user_id,
      rawsize: opts.rawsize,
      rawfilemd5: opts.rawfilemd5,
      filesize: opts.filesize,
      thumb_rawsize: opts.thumb_rawsize,
      thumb_rawfilemd5: opts.thumb_rawfilemd5,
      thumb_filesize: opts.thumb_filesize,
      no_need_thumb: opts.no_need_thumb,
      aeskey: opts.aeskey,
    }),
    token: opts.token,
    timeoutMs: opts.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: "getUploadUrl",
  });
}

export async function getConfig(
  opts: WechatApiOptions & { ilinkUserId: string; contextToken?: string },
): Promise<GetConfigResp> {
  return await apiPost<GetConfigResp>({
    baseUrl: opts.baseUrl,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: opts.ilinkUserId,
      context_token: opts.contextToken,
    }),
    token: opts.token,
    timeoutMs: opts.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "getConfig",
  });
}

export async function sendTyping(
  opts: WechatApiOptions & { body: SendTypingReq },
): Promise<SendTypingResp> {
  return await apiPost<SendTypingResp>({
    baseUrl: opts.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify(opts.body),
    token: opts.token,
    timeoutMs: opts.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "sendTyping",
  });
}

export async function sendTextMessageWithRetry(
  opts: WechatApiOptions & {
    toUserId: string;
    text: string;
    contextToken?: string;
  },
): Promise<void> {
  await withRetry(
    () => sendTextMessage(opts),
    {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      shouldRetry: (err) => isRateLimitError(err),
    },
  );
}