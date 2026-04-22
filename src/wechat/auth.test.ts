import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveAccount, loadAccount, listAccountIds, removeAccount } from "./auth.js";

const TEST_DIR = path.join(os.tmpdir(), `cc-wechat-test-${Date.now()}`);

beforeEach(() => {
  process.env.CC_WECHAT_DATA_DIR = TEST_DIR;
  fs.mkdirSync(path.join(TEST_DIR, "accounts"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.CC_WECHAT_DATA_DIR;
});

describe("account storage", () => {
  it("saves and loads account data", () => {
    saveAccount("bot-123", { token: "test-token", baseUrl: "https://example.com" });
    const data = loadAccount("bot-123");
    expect(data).not.toBeNull();
    expect(data?.token).toBe("test-token");
    expect(data?.baseUrl).toBe("https://example.com");
    expect(data?.savedAt).toBeDefined();
  });

  it("returns null for non-existent account", () => {
    expect(loadAccount("nonexistent")).toBeNull();
  });

  it("lists account IDs", () => {
    saveAccount("bot-1", { token: "t1" });
    saveAccount("bot-2", { token: "t2" });
    const ids = listAccountIds();
    expect(ids).toContain("bot-1");
    expect(ids).toContain("bot-2");
  });

  it("removes account", () => {
    saveAccount("bot-rm", { token: "rm" });
    removeAccount("bot-rm");
    expect(loadAccount("bot-rm")).toBeNull();
  });

  it("merges on subsequent saves", () => {
    saveAccount("bot-merge", { token: "t1" });
    saveAccount("bot-merge", { baseUrl: "https://new.url" });
    const data = loadAccount("bot-merge");
    expect(data?.token).toBe("t1");
    expect(data?.baseUrl).toBe("https://new.url");
  });
});