import { aesEcbDecrypt, decodeAesKey } from "./cdn.js";
import type { CDNMedia, ImageItem } from "./types.js";

export async function downloadAndDecryptMedia(
  media: CDNMedia,
): Promise<Buffer> {
  if (!media.encrypt_query_param && !media.full_url) {
    throw new Error("CDN media has no download reference");
  }
  if (!media.aes_key) {
    throw new Error("CDN media has no AES key");
  }

  const downloadUrl = media.full_url
    ? media.full_url
    : `https://novac2c.cdn.weixin.qq.com/c2c/${media.encrypt_query_param}`;

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`CDN download failed: ${response.status}`);
  }

  const encrypted = Buffer.from(await response.arrayBuffer());
  const key = decodeAesKey(media.aes_key);
  return aesEcbDecrypt(encrypted, key);
}

export async function downloadImage(imageItem: ImageItem): Promise<Buffer> {
  if (imageItem.media) {
    return downloadAndDecryptMedia(imageItem.media);
  }
  if (imageItem.url) {
    const resp = await fetch(imageItem.url);
    if (!resp.ok) throw new Error(`Image download failed: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }
  throw new Error("ImageItem has no downloadable reference");
}

export function extractTextFromMessage(
  itemList?: { type?: number; text_item?: { text?: string } }[],
): string {
  if (!itemList) return "";
  return itemList
    .filter((item) => item.type === 1 && item.text_item?.text)
    .map((item) => item.text_item!.text!)
    .join("");
}