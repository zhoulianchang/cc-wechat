import { describe, it, expect } from "vitest";
import {
  MessageType,
  MessageItemType,
  MessageState,
  UploadMediaType,
  TypingStatus,
} from "./types.js";

describe("WeChat protocol constants", () => {
  it("MessageType has correct values", () => {
    expect(MessageType.NONE).toBe(0);
    expect(MessageType.USER).toBe(1);
    expect(MessageType.BOT).toBe(2);
  });

  it("MessageItemType has correct values", () => {
    expect(MessageItemType.TEXT).toBe(1);
    expect(MessageItemType.IMAGE).toBe(2);
    expect(MessageItemType.VOICE).toBe(3);
    expect(MessageItemType.FILE).toBe(4);
    expect(MessageItemType.VIDEO).toBe(5);
  });

  it("MessageState has correct values", () => {
    expect(MessageState.NEW).toBe(0);
    expect(MessageState.GENERATING).toBe(1);
    expect(MessageState.FINISH).toBe(2);
  });

  it("UploadMediaType has correct values", () => {
    expect(UploadMediaType.IMAGE).toBe(1);
    expect(UploadMediaType.VIDEO).toBe(2);
    expect(UploadMediaType.FILE).toBe(3);
  });

  it("TypingStatus has correct values", () => {
    expect(TypingStatus.TYPING).toBe(1);
    expect(TypingStatus.CANCEL).toBe(2);
  });
});