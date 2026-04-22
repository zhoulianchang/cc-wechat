import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { getUpdates, sendTextMessage } from "./api.js";

beforeEach(() => {
  mockFetch.mockReset();
});

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe("getUpdates", () => {
  it("returns messages on success", async () => {
    const respBody = {
      ret: 0,
      msgs: [{ from_user_id: "user1", message_type: 1, item_list: [] }],
      get_updates_buf: "new-buf",
    };
    mockFetch.mockReturnValue(mockResponse(200, respBody));

    const result = await getUpdates({
      baseUrl: "https://example.com",
      token: "test-token",
      get_updates_buf: "",
    });

    expect(result.ret).toBe(0);
    expect(result.msgs).toHaveLength(1);
    expect(result.get_updates_buf).toBe("new-buf");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const call = mockFetch.mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["AuthorizationType"]).toBe("ilink_bot_token");
  });

  it("returns empty response on timeout", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValue(abortError);

    const result = await getUpdates({
      baseUrl: "https://example.com",
      token: "test-token",
      get_updates_buf: "old-buf",
    });

    expect(result.ret).toBe(0);
    expect(result.msgs).toEqual([]);
    expect(result.get_updates_buf).toBe("old-buf");
  });
});

describe("sendTextMessage", () => {
  it("sends text with correct structure", async () => {
    mockFetch.mockReturnValue(mockResponse(200, {}));

    await sendTextMessage({
      baseUrl: "https://example.com",
      token: "test-token",
      toUserId: "user1",
      text: "Hello",
      contextToken: "ctx-123",
    });

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.msg.to_user_id).toBe("user1");
    expect(body.msg.context_token).toBe("ctx-123");
    expect(body.msg.item_list[0].type).toBe(1);
    expect(body.msg.item_list[0].text_item.text).toBe("Hello");
  });
});