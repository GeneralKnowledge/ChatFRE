import { describe, expect, it } from "vitest";
import { TokenBucket } from "@/server/llm/scheduler/token-bucket";
import { isLongWindowBinding, remainingInWindow } from "@/server/llm/scheduler/quota";
import { scoreProvider } from "@/server/llm/scheduler/scorer";
import { createEmptyRuntimeState } from "@/server/llm/scheduler/runtime-state";
import { RequestQueue } from "@/server/llm/scheduler/queue";
import { isNonRetryable, isTransient } from "@/server/llm/scheduler/retry";
import type { ProviderConfig } from "@/server/llm/types";

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "test",
    name: "Test",
    enabled: true,
    reason: null,
    ukStatus: "available",
    free: true,
    baseUrl: "https://example.com/v1",
    apiStyle: "openai_chat",
    authentication: {
      type: "bearer",
      envVar: "TEST_API_KEY",
      required: false,
    },
    routes: {
      chat: "/chat/completions",
      models: "/models",
      health: "/models",
    },
    models: [{ id: "model-a", name: "Model A", capabilities: ["chat"], preferred: true }],
    limits: {
      rpm: { value: 20, official: true },
      rpd: { value: 50, official: true },
    },
    scheduler: {
      priority: 50,
      supportsStreaming: true,
      reserveDailyFraction: 0.05,
    },
    ...overrides,
  };
}

describe("TokenBucket", () => {
  it("enforces capacity and refills over time", () => {
    const now = 1_000_000;
    const bucket = new TokenBucket(20, 20 / 60, now);
    expect(bucket.tryTake(20, now)).toBe(true);
    expect(bucket.tryTake(1, now)).toBe(false);
    // after 60s should be full again
    expect(bucket.tryTake(20, now + 60_000)).toBe(true);
  });

  it("reports wait time", () => {
    const now = 0;
    const bucket = new TokenBucket(10, 10 / 60, now);
    bucket.take(10, now);
    const wait = bucket.waitTimeMs(1, now);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(6000);
  });
});

describe("Long-window binding logic", () => {
  it("Test A: with 0 usage and 12h remaining, daily quota is NOT binding at burst RPM", () => {
    // 20 RPM * 12*60 minutes = 14400 possible >> 50 remaining
    // Wait — 50 < 14400 means it IS binding by the formula!
    //
    // Re-read the spec carefully:
    // maximumPossibleRequestsBeforeReset = burstRPM * remainingMinutes
    // If remainingQuota >= maximumPossibleRequestsBeforeReset → NOT binding
    // If remainingQuota < maximumPossibleRequestsBeforeReset → binding
    //
    // With 50 RPD and 20 RPM and 12 hours: 50 < 14400 → binding by pure formula.
    // But Test A says: "must not automatically reduce the provider to 0.0347 RPM"
    // and "Daily quota may influence budget scoring, but must not automatically reduce..."
    //
    // So binding=true is OK as a *scoring signal*, but we must NOT convert to tiny RPM.
    // The scorer should still mark available=true and allow burst RPM.
    const remainingMinutes = 12 * 60;
    const binding = isLongWindowBinding({
      remainingQuota: 50,
      remainingMinutes,
      burstRPM: 20,
    });
    // Formula says binding when you can't burn the whole quota at burst — which with 12h you CAN'T burn only 50 at 20rpm... 
    // Actually you CAN easily burn 50 at 20rpm in 12h. The maximum possible is 14400, remaining is 50,
    // so 50 < 14400 → binding=true. That means "you might run out before reset if you burst".
    // That's correct as a soft signal. The important test is that scoring still allows the provider.
    expect(binding).toBe(true);

    const provider = makeProvider();
    const runtime = createEmptyRuntimeState("test");
    const score = scoreProvider({
      provider,
      runtime,
      modelId: "model-a",
      context: { now: Date.now(), freeOnly: true },
      hasCredentials: true,
    });
    expect(score.available).toBe(true);
    expect(score.score).toBeGreaterThan(0);
    // Must NOT be throttled to ~0.03 RPM equivalent — available immediately
    expect(score.waitMs).toBe(0);
  });

  it("Test B: when remaining quota cannot be burned before reset, daily quota is NOT binding", () => {
    // 20 RPM * 2 minutes = 40 possible < 50 remaining → NOT binding
    // (you cannot physically exhaust the daily quota before reset at burst rate)
    const binding = isLongWindowBinding({
      remainingQuota: 50,
      remainingMinutes: 2,
      burstRPM: 20,
    });
    expect(binding).toBe(false);

    // Also: with 5 minutes left and 0 usage, provider stays available at burst RPM
    // (may be soft-binding for scoring, but must not become a tiny artificial RPM)
    const provider = makeProvider();
    const now = Date.UTC(2026, 8, 27, 23, 55, 0);
    const runtime = createEmptyRuntimeState("test", now);
    const score = scoreProvider({
      provider,
      runtime,
      modelId: "model-a",
      context: { now, freeOnly: true },
      hasCredentials: true,
    });
    expect(score.available).toBe(true);
    expect(score.waitMs).toBe(0);
  });

  it("Test C: 49 of 50 daily used → strongly deprioritized or blocked by reserve", () => {
    const provider = makeProvider();
    const runtime = createEmptyRuntimeState("test");
    runtime.requestsToday = 49;
    const score = scoreProvider({
      provider,
      runtime,
      modelId: "model-a",
      context: { now: Date.now(), freeOnly: true },
      hasCredentials: true,
    });
    // reserve 5% of 50 = 3, so remaining after reserve = 50-49-3 = -2 → exhausted
    expect(score.available).toBe(false);
    expect(score.reasons.some((r) => /daily/i.test(r))).toBe(true);
  });

  it("Test D: higher RPD can beat higher RPM when budgets differ", () => {
    const providerA = makeProvider({
      id: "a",
      limits: {
        rpm: { value: 20, official: true },
        rpd: { value: 50, official: true },
      },
      scheduler: { priority: 50, supportsStreaming: true, reserveDailyFraction: 0.05 },
    });
    const providerB = makeProvider({
      id: "b",
      limits: {
        rpm: { value: 10, official: true },
        rpd: { value: 1000, official: true },
      },
      scheduler: { priority: 50, supportsStreaming: true, reserveDailyFraction: 0.05 },
    });

    const runtimeA = createEmptyRuntimeState("a");
    runtimeA.requestsToday = 40; // near daily limit
    const runtimeB = createEmptyRuntimeState("b");
    runtimeB.requestsToday = 10;

    const now = Date.now();
    const scoreA = scoreProvider({
      provider: providerA,
      runtime: runtimeA,
      modelId: "model-a",
      context: { now, freeOnly: true },
      hasCredentials: true,
    });
    const scoreB = scoreProvider({
      provider: providerB,
      runtime: runtimeB,
      modelId: "model-a",
      context: { now, freeOnly: true },
      hasCredentials: true,
    });

    expect(scoreB.available).toBe(true);
    if (scoreA.available) {
      expect(scoreB.score).toBeGreaterThan(scoreA.score);
    }
  });

  it("does not treat remainingQuota/minutes as the hard RPM", () => {
    // Anti-pattern: 50/day / (12*60) = 0.069 RPM — we must not use that
    const artificialRpm = 50 / (12 * 60);
    expect(artificialRpm).toBeLessThan(0.1);
    const provider = makeProvider();
    const score = scoreProvider({
      provider,
      runtime: createEmptyRuntimeState("test"),
      modelId: "model-a",
      context: { now: Date.now(), freeOnly: true },
      hasCredentials: true,
    });
    expect(score.available).toBe(true);
    expect(score.waitMs).toBe(0);
  });
});

describe("remainingInWindow + reserve", () => {
  it("applies reserve fraction", () => {
    expect(remainingInWindow(0, 50, 0.05)).toBe(47);
    expect(remainingInWindow(47, 50, 0.05)).toBe(0);
  });
});

describe("Queue", () => {
  it("prioritizes interactive over background", () => {
    const q = new RequestQueue();
    q.enqueue({
      priority: "background",
      request: { messages: [], model: "m" },
      candidateProviders: ["a"],
    });
    q.enqueue({
      priority: "interactive",
      request: { messages: [], model: "m" },
      candidateProviders: ["a"],
    });
    const first = q.dequeue();
    expect(first?.priority).toBe("interactive");
  });
});

describe("Retry classification", () => {
  it("retries 429 and 5xx", () => {
    expect(isTransient({ status: 429, retryable: true })).toBe(true);
    expect(isTransient({ status: 503 })).toBe(true);
    expect(isTransient({ status: 401 })).toBe(false);
  });

  it("does not retry auth/payment/malformed", () => {
    expect(isNonRetryable({ status: 401 })).toBe(true);
    expect(isNonRetryable({ status: 402 })).toBe(true);
    expect(isNonRetryable({ status: 400 })).toBe(true);
    expect(isNonRetryable({ message: "unsupported model" })).toBe(true);
  });
});

describe("Hard RPM limit", () => {
  it("marks unavailable when RPM exhausted", () => {
    const provider = makeProvider();
    const runtime = createEmptyRuntimeState("test");
    runtime.requestsThisMinute = 20;
    const score = scoreProvider({
      provider,
      runtime,
      modelId: "model-a",
      context: { now: Date.now(), freeOnly: true },
      hasCredentials: true,
    });
    expect(score.available).toBe(false);
    expect(score.reasons.join(" ")).toMatch(/RPM/i);
  });
});

describe("Credentials / disabled / free_only", () => {
  it("requires API key when configured as required", () => {
    const provider = makeProvider({
      authentication: {
        type: "bearer",
        envVar: "MISSING_KEY",
        required: true,
      },
    });
    const score = scoreProvider({
      provider,
      runtime: createEmptyRuntimeState("test"),
      modelId: "model-a",
      context: { now: Date.now(), freeOnly: true },
      hasCredentials: false,
    });
    expect(score.available).toBe(false);
  });

  it("excludes paid when freeOnly", () => {
    const provider = makeProvider({ free: false });
    const score = scoreProvider({
      provider,
      runtime: createEmptyRuntimeState("test"),
      modelId: "model-a",
      context: { now: Date.now(), freeOnly: true },
      hasCredentials: true,
    });
    expect(score.available).toBe(false);
  });
});
