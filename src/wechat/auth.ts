import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";
import type { AccountData, QRCodeResponse, QRStatusResponse } from "./types.js";

const DATA_DIR = process.env.CC_WECHAT_DATA_DIR?.trim() || `${process.env.HOME}/.cc-wechat`;
const ACCOUNTS_DIR = path.join(DATA_DIR, "accounts");
const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";
const BOT_TYPE = "3";
const QR_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESH = 3;

function ensureAccountsDir(): void {
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
  }
}

function accountPath(accountId: string): string {
  return path.join(ACCOUNTS_DIR, `${accountId}.json`);
}

export function loadAccount(accountId: string): AccountData | null {
  try {
    const filePath = accountPath(accountId);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as AccountData;
  } catch {
    return null;
  }
}

export function saveAccount(accountId: string, data: AccountData): void {
  ensureAccountsDir();
  const existing = loadAccount(accountId) ?? {};
  const merged: AccountData = {
    ...existing,
    ...data,
    savedAt: new Date().toISOString(),
  };
  const filePath = accountPath(accountId);
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
  logger.info(`Account saved: ${accountId}`);
}

export function listAccountIds(): string[] {
  ensureAccountsDir();
  try {
    return fs
      .readdirSync(ACCOUNTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

export function removeAccount(accountId: string): void {
  try {
    fs.unlinkSync(accountPath(accountId));
  } catch {
    // ignore
  }
}

async function fetchQRCode(baseUrl: string): Promise<QRCodeResponse> {
  const url = new URL(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`,
    `${baseUrl}/`,
  );
  logger.info(`Fetching QR code from ${url.origin}`);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`fetchQRCode ${res.status}: ${await res.text()}`);
  return (await res.json()) as QRCodeResponse;
}

async function pollQRStatus(
  baseUrl: string,
  qrcode: string,
): Promise<QRStatusResponse> {
  const url = new URL(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    `${baseUrl}/`,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`pollQRStatus ${res.status}`);
    return (await res.json()) as QRStatusResponse;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "wait" };
    }
    throw err;
  }
}

export interface LoginResult {
  success: boolean;
  accountId?: string;
  message: string;
}

export async function loginWithQRCode(opts?: {
  timeoutMs?: number;
}): Promise<LoginResult> {
  const timeoutMs = opts?.timeoutMs ?? 480_000;
  const deadline = Date.now() + timeoutMs;
  let currentBaseUrl = FIXED_BASE_URL;
  let qrRefreshCount = 0;

  logger.info("Starting QR code login...");

  let qrResponse = await fetchQRCode(currentBaseUrl);
  renderQRCode(qrResponse.qrcode_img_content);

  while (Date.now() < deadline) {
    const statusResp = await pollQRStatus(currentBaseUrl, qrResponse.qrcode);
    logger.debug(`QR status: ${statusResp.status}`);

    switch (statusResp.status) {
      case "wait":
        break;

      case "scaned":
        process.stdout.write("\n已扫码，在微信确认...");
        break;

      case "expired": {
        qrRefreshCount++;
        if (qrRefreshCount >= MAX_QR_REFRESH) {
          return { success: false, message: "二维码多次过期，请重试" };
        }
        process.stdout.write("\n二维码过期，刷新中...");
        qrResponse = await fetchQRCode(currentBaseUrl);
        renderQRCode(qrResponse.qrcode_img_content);
        break;
      }

      case "scaned_but_redirect": {
        if (statusResp.redirect_host) {
          currentBaseUrl = `https://${statusResp.redirect_host}`;
          logger.info(`IDC redirect to ${currentBaseUrl}`);
        }
        break;
      }

      case "confirmed": {
        if (!statusResp.ilink_bot_id || !statusResp.bot_token) {
          return { success: false, message: "登录失败：服务器未返回凭证" };
        }
        const accountId = statusResp.ilink_bot_id;
        saveAccount(accountId, {
          token: statusResp.bot_token,
          baseUrl: statusResp.baseurl || FIXED_BASE_URL,
          userId: statusResp.ilink_user_id,
        });
        logger.info(`Login confirmed: accountId=${accountId}`);
        return {
          success: true,
          accountId,
          message: "微信连接成功！",
        };
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  return { success: false, message: "登录超时，请重试" };
}

function renderQRCode(url: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const qrterm = require("qrcode-terminal") as { generate: (text: string, opts: { small: boolean }) => void };
    qrterm.generate(url, { small: true });
  } catch {
    // fallback: just print URL
  }
  process.stdout.write(`\n如果二维码显示不正常，用浏览器打开:\n${url}\n\n`);
}