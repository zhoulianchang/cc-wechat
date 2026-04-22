import crypto from "node:crypto";

const AES_ALGORITHM = "aes-128-ecb";
const BLOCK_SIZE = 16;

export function aesEcbEncrypt(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export function aesEcbDecrypt(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function decodeAesKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 16) {
    throw new Error(`Invalid AES key length: ${key.length}, expected 16`);
  }
  return key;
}

export function md5Hex(data: Buffer): string {
  return crypto.createHash("md5").update(data).digest("hex");
}

export function encryptedSize(plainSize: number): number {
  return plainSize + (BLOCK_SIZE - (plainSize % BLOCK_SIZE));
}

export function generateAesKey(): Buffer {
  return crypto.randomBytes(16);
}