import { describe, it, expect } from "vitest";
import {
  aesEcbEncrypt,
  aesEcbDecrypt,
  decodeAesKey,
  md5Hex,
  encryptedSize,
  generateAesKey,
} from "./cdn.js";

describe("CDN AES-128-ECB crypto", () => {
  it("encrypts and decrypts roundtrip", () => {
    const key = Buffer.alloc(16, 0x42);
    const plaintext = Buffer.from("Hello WeChat CDN!");
    const encrypted = aesEcbEncrypt(plaintext, key);
    const decrypted = aesEcbDecrypt(encrypted, key);
    expect(decrypted.toString()).toBe("Hello WeChat CDN!");
  });

  it("encrypted size is correctly padded", () => {
    expect(encryptedSize(0)).toBe(16);
    expect(encryptedSize(1)).toBe(16);
    expect(encryptedSize(15)).toBe(16);
    expect(encryptedSize(16)).toBe(32);
    expect(encryptedSize(100)).toBe(112);
  });

  it("decodeAesKey validates length", () => {
    const valid = Buffer.alloc(16).toString("base64");
    expect(decodeAesKey(valid)).toHaveLength(16);
    const invalid = Buffer.alloc(8).toString("base64");
    expect(() => decodeAesKey(invalid)).toThrow("Invalid AES key length: 8");
  });

  it("md5Hex produces correct hash", () => {
    const hash = md5Hex(Buffer.from("hello"));
    expect(hash).toBe("5d41402abc4b2a76b9719d911017c592");
  });

  it("generateAesKey produces 16-byte key", () => {
    const key = generateAesKey();
    expect(key).toHaveLength(16);
  });
});