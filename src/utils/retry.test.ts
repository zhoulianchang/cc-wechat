import { describe, it, expect } from "vitest";
import { withRetry, isRateLimitError } from "./retry.js";

describe("withRetry", () => {
  it("returns result on first successful attempt", async () => {
    const result = await withRetry(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("retries on failure and succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) return Promise.reject(new Error("fail"));
        return Promise.resolve("ok");
      },
      { maxAttempts: 5, initialDelayMs: 10, maxDelayMs: 100 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("throws after max attempts exhausted", async () => {
    await expect(
      withRetry(() => Promise.reject(new Error("always fail")), {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      }),
    ).rejects.toThrow("always fail");
  });

  it("stops early if shouldRetry returns false", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          return Promise.reject(new Error("no retry"));
        },
        {
          maxAttempts: 5,
          initialDelayMs: 10,
          maxDelayMs: 100,
          shouldRetry: () => false,
        },
      ),
    ).rejects.toThrow("no retry");
    expect(attempts).toBe(1);
  });
});

describe("isRateLimitError", () => {
  it("detects 429 errors", () => {
    expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("something else"))).toBe(false);
    expect(isRateLimitError("not an error")).toBe(false);
  });
});