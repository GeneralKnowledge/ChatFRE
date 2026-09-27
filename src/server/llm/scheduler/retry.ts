export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  const spread = ms * 0.25;
  return Math.round(ms - spread + Math.random() * spread * 2);
}

/**
 * Exponential backoff: 1s, 2s, 4s, 8s … with jitter.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 8000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retry =
        options.shouldRetry?.(error, attempt) ??
        (attempt < maxAttempts && isTransient(error));
      if (!retry || attempt >= maxAttempts) throw error;
      const delay = jitter(
        Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)),
      );
      options.onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

export function isTransient(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    retryable?: boolean;
    status?: number;
    message?: string;
  };
  if (e.retryable === false) return false;
  if (e.retryable === true) return true;
  if (e.status === 429 || e.status === 408) return true;
  if (typeof e.status === "number" && e.status >= 500 && e.status < 600) {
    return true;
  }
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset")
  );
}

export function isNonRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; message?: string };
  if (e.status === 401 || e.status === 403 || e.status === 400 || e.status === 404) {
    return true;
  }
  if (e.status === 402) return true; // payment required
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("invalid api key") ||
    msg.includes("unauthorized") ||
    msg.includes("payment") ||
    msg.includes("unsupported model") ||
    msg.includes("malformed")
  );
}
