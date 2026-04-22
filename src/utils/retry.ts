import { logger } from "./logger.js";

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (opts.shouldRetry && !opts.shouldRetry(error)) {
        throw error;
      }

      if (attempt >= opts.maxAttempts) {
        break;
      }

      const delay = Math.min(
        opts.initialDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs,
      );

      logger.warn(`Retry attempt ${attempt}/${opts.maxAttempts} after ${delay}ms: ${String(error)}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    return msg.includes("429") || msg.toLowerCase().includes("rate limit");
  }
  return false;
}