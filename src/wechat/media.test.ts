import { describe, it, expect } from "vitest";
import { extractTextFromMessage } from "./media.js";

describe("extractTextFromMessage", () => {
  it("extracts text from text items", () => {
    const items = [
      { type: 1, text_item: { text: "Hello " } },
      { type: 2, image_item: {} },
      { type: 1, text_item: { text: "World" } },
    ];
    expect(extractTextFromMessage(items as any)).toBe("Hello World");
  });

  it("returns empty string for empty item list", () => {
    expect(extractTextFromMessage([])).toBe("");
    expect(extractTextFromMessage(undefined)).toBe("");
  });

  it("ignores non-text items", () => {
    const items = [
      { type: 2, image_item: {} },
      { type: 3, voice_item: {} },
    ];
    expect(extractTextFromMessage(items as any)).toBe("");
  });
});