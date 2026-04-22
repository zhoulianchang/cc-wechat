import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.CC_WECHAT_DATA_DIR?.trim() || `${process.env.HOME}/.cc-wechat`;
const LOGS_DIR = path.join(DATA_DIR, "logs");
const MAX_AGE_DAYS = 30;

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `cc-wechat-${date}.log`);
}

function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function purgeOldLogs(): void {
  try {
    const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith(".log")).sort();
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const dateStr = file.replace("cc-wechat-", "").replace(".log", "");
      const fileTime = new Date(dateStr).getTime();
      if (fileTime < cutoff) {
        fs.unlinkSync(path.join(LOGS_DIR, file));
      }
    }
  } catch {
    // best-effort
  }
}

function redactToken(text: string): string {
  return text
    .replace(/Bearer\s+\S+/g, "Bearer ***")
    .replace(/"token"\s*:\s*"[^"]+"/g, '"token":"***"');
}

function formatMessage(level: string, msg: string): string {
  const ts = new Date().toISOString();
  return `${ts} [${level}] ${redactToken(msg)}\n`;
}

function writeToFile(line: string): void {
  try {
    ensureLogsDir();
    fs.appendFileSync(getLogFilePath(), line, "utf-8");
  } catch {
    // best-effort
  }
}

export const logger = {
  info(msg: string): void {
    const line = formatMessage("INFO", msg);
    process.stderr.write(line);
    writeToFile(line);
  },
  warn(msg: string): void {
    const line = formatMessage("WARN", msg);
    process.stderr.write(line);
    writeToFile(line);
  },
  error(msg: string): void {
    const line = formatMessage("ERROR", msg);
    process.stderr.write(line);
    writeToFile(line);
  },
  debug(msg: string): void {
    if (process.env.CC_WECHAT_DEBUG?.trim() === "1") {
      const line = formatMessage("DEBUG", msg);
      process.stderr.write(line);
      writeToFile(line);
    }
  },
};

purgeOldLogs();

export { redactToken };