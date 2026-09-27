/**
 * Reusable token bucket for RPM / TPM style hard limits.
 */
export class TokenBucket {
  capacity: number;
  refillRate: number; // tokens per millisecond
  availableTokens: number;
  lastUpdated: number;

  constructor(capacity: number, refillPerSecond: number, now = Date.now()) {
    this.capacity = Math.max(0, capacity);
    this.refillRate = refillPerSecond / 1000;
    this.availableTokens = this.capacity;
    this.lastUpdated = now;
  }

  private refill(now: number): void {
    const elapsed = Math.max(0, now - this.lastUpdated);
    if (elapsed > 0 && this.refillRate > 0) {
      this.availableTokens = Math.min(
        this.capacity,
        this.availableTokens + elapsed * this.refillRate,
      );
      this.lastUpdated = now;
    } else if (elapsed > 0) {
      this.lastUpdated = now;
    }
  }

  tryTake(tokens = 1, now = Date.now()): boolean {
    this.refill(now);
    if (this.availableTokens >= tokens) {
      this.availableTokens -= tokens;
      return true;
    }
    return false;
  }

  take(tokens = 1, now = Date.now()): void {
    if (!this.tryTake(tokens, now)) {
      throw new Error("TokenBucket: insufficient tokens");
    }
  }

  /** Milliseconds until `tokens` become available */
  waitTimeMs(tokens = 1, now = Date.now()): number {
    this.refill(now);
    if (this.availableTokens >= tokens) return 0;
    if (this.refillRate <= 0) return Number.POSITIVE_INFINITY;
    const needed = tokens - this.availableTokens;
    return Math.ceil(needed / this.refillRate);
  }

  peek(now = Date.now()): number {
    this.refill(now);
    return this.availableTokens;
  }

  snapshot(now = Date.now()): {
    capacity: number;
    refillRate: number;
    availableTokens: number;
    lastUpdated: number;
  } {
    this.refill(now);
    return {
      capacity: this.capacity,
      refillRate: this.refillRate * 1000,
      availableTokens: this.availableTokens,
      lastUpdated: this.lastUpdated,
    };
  }
}
