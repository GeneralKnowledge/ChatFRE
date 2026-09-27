import type {
  ProviderConfig,
  ProviderRuntimeState,
  ProviderScore,
  SelectionContext,
} from "../types";
import {
  getNumericLimit,
  isLongWindowBinding,
  minutesUntil,
  remainingInWindow,
} from "./quota";
import { windowResets } from "./runtime-state";

export type ScoreInput = {
  provider: ProviderConfig;
  runtime: ProviderRuntimeState;
  modelId: string;
  context: SelectionContext;
  hasCredentials: boolean;
};

export function scoreProvider(input: ScoreInput): ProviderScore {
  const { provider, runtime, modelId, context, hasCredentials } = input;
  const reasons: string[] = [];
  const now = context.now;
  const resets = windowResets(now);

  const enabled =
    runtime.enabledOverride !== null
      ? runtime.enabledOverride
      : provider.enabled;

  if (!enabled) {
    return unavailable(provider.id, modelId, "Provider disabled");
  }
  if (context.freeOnly && !provider.free) {
    return unavailable(provider.id, modelId, "Paid provider excluded (free_only)");
  }
  if (provider.authentication.required && !hasCredentials) {
    return unavailable(provider.id, modelId, "API key not configured");
  }
  if (
    context.ukEligible === false &&
    provider.ukStatus === "restricted"
  ) {
    return unavailable(provider.id, modelId, "UK eligibility restricted");
  }
  if (context.excludeProviders?.includes(provider.id)) {
    return unavailable(provider.id, modelId, "Excluded after failure");
  }
  if (runtime.blockedUntil && runtime.blockedUntil > now) {
    return unavailable(
      provider.id,
      modelId,
      `Blocked until ${new Date(runtime.blockedUntil).toISOString()}`,
      runtime.blockedUntil - now,
    );
  }
  if (runtime.health && !runtime.health.healthy) {
    reasons.push("Recently unhealthy");
  }

  const burstRPM =
    getObservedRpm(runtime) ??
    getNumericLimit(provider.limits, "rpm") ??
    (getNumericLimit(provider.limits, "rps")
      ? getNumericLimit(provider.limits, "rps")! * 60
      : null) ??
    10;

  const rpmLimit =
    getObservedRpmLimit(runtime) ?? getNumericLimit(provider.limits, "rpm");
  const rpdLimit = getNumericLimit(provider.limits, "rpd");
  const monthlyLimit = getNumericLimit(provider.limits, "monthly");
  const rphLimit = getNumericLimit(provider.limits, "rph");
  const tpmLimit = getNumericLimit(provider.limits, "tpm");
  const tpdLimit = getNumericLimit(provider.limits, "tpd");
  const concurrencyLimit =
    getNumericLimit(provider.limits, "concurrency") ?? Number.POSITIVE_INFINITY;

  if (runtime.activeRequests >= concurrencyLimit) {
    return unavailable(
      provider.id,
      modelId,
      "Concurrency limit reached",
      1_000,
    );
  }

  if (rpmLimit !== null && runtime.requestsThisMinute >= rpmLimit) {
    return unavailable(
      provider.id,
      modelId,
      "RPM hard limit reached",
      resets.minute - now,
    );
  }

  if (
    tpmLimit !== null &&
    context.estimatedTokens &&
    runtime.tokensThisMinute + context.estimatedTokens > tpmLimit
  ) {
    return unavailable(
      provider.id,
      modelId,
      "TPM hard limit would be exceeded",
      resets.minute - now,
    );
  }

  const reserve = provider.scheduler.reserveDailyFraction ?? 0.05;
  const remainingDaily = remainingInWindow(
    runtime.requestsToday,
    rpdLimit,
    reserve,
  );
  const remainingMonthly = remainingInWindow(
    runtime.requestsThisMonth,
    monthlyLimit,
    reserve,
  );
  const remainingHourly = remainingInWindow(
    runtime.requestsThisHour,
    rphLimit,
    0,
  );

  if (rpdLimit !== null && remainingDaily <= 0) {
    return unavailable(
      provider.id,
      modelId,
      "Daily quota exhausted",
      resets.day - now,
    );
  }
  if (monthlyLimit !== null && remainingMonthly <= 0) {
    return unavailable(
      provider.id,
      modelId,
      "Monthly quota exhausted",
      resets.month - now,
    );
  }
  if (rphLimit !== null && remainingHourly <= 0) {
    return unavailable(
      provider.id,
      modelId,
      "Hourly quota exhausted",
      resets.hour - now,
    );
  }
  if (
    tpdLimit !== null &&
    context.estimatedTokens &&
    runtime.tokensToday + context.estimatedTokens > tpdLimit
  ) {
    return unavailable(
      provider.id,
      modelId,
      "Daily token quota would be exceeded",
      resets.day - now,
    );
  }

  const dailyBinding =
    rpdLimit !== null &&
    isLongWindowBinding({
      remainingQuota: remainingDaily,
      remainingMinutes: minutesUntil(resets.day, now),
      burstRPM,
    });
  const monthlyBinding =
    monthlyLimit !== null &&
    isLongWindowBinding({
      remainingQuota: remainingMonthly,
      remainingMinutes: minutesUntil(resets.month, now),
      burstRPM,
    });
  const hourlyBinding =
    rphLimit !== null &&
    isLongWindowBinding({
      remainingQuota: remainingHourly,
      remainingMinutes: minutesUntil(resets.hour, now),
      burstRPM,
    });

  if (dailyBinding) reasons.push("Daily quota becoming binding");
  if (monthlyBinding) reasons.push("Monthly quota becoming binding");
  if (hourlyBinding) reasons.push("Hourly quota becoming binding");

  // Score: higher is better. Prefer priority, remaining budget, low failures.
  let score = provider.scheduler.priority;

  // Preference boost
  if (context.preferredProvider === provider.id) {
    score += 50;
    reasons.push("User preferred provider");
  }
  if (context.preferredModel && modelId === context.preferredModel) {
    score += 25;
    reasons.push("User preferred model");
  }

  // Budget scoring — prefer providers with more remaining relative budget
  // without converting long-window quotas into artificial RPM.
  if (rpdLimit !== null) {
    const fraction = remainingDaily / rpdLimit;
    score += fraction * 30;
    if (dailyBinding) {
      // Soft deprioritize when binding, hard block only near exhaustion
      score -= (1 - fraction) * 40;
    }
  } else {
    score += 15; // no daily cap is fine for single-user
  }

  if (monthlyLimit !== null) {
    const fraction = remainingMonthly / monthlyLimit;
    score += fraction * 20;
    if (monthlyBinding) score -= (1 - fraction) * 30;
  }

  if (rphLimit !== null) {
    const fraction = remainingHourly / Math.max(1, rphLimit);
    score += fraction * 10;
    if (hourlyBinding) score -= (1 - fraction) * 20;
  }

  // Prefer higher short-window capacity for interactive feel, lightly
  score += Math.min(20, burstRPM);

  // Penalize failures and queue depth
  score -= runtime.consecutiveFailures * 15;
  score -= runtime.queueDepth * 5;
  score -= runtime.activeRequests * 10;

  if (runtime.consecutiveFailures > 0) {
    reasons.push(`${runtime.consecutiveFailures} consecutive failures`);
  }

  // Observed remaining from headers
  if (
    runtime.observedRateLimits?.remaining !== undefined &&
    runtime.observedRateLimits.remaining < 3
  ) {
    score -= 25;
    reasons.push("Observed remaining requests low");
  }

  reasons.push(`Base priority ${provider.scheduler.priority}`);

  return {
    providerId: provider.id,
    modelId,
    score,
    reasons,
    available: true,
    waitMs: 0,
    longWindowBinding: {
      daily: dailyBinding,
      monthly: monthlyBinding,
      hourly: hourlyBinding,
    },
  };
}

function unavailable(
  providerId: string,
  modelId: string,
  reason: string,
  waitMs = 0,
): ProviderScore {
  return {
    providerId,
    modelId,
    score: Number.NEGATIVE_INFINITY,
    reasons: [reason],
    available: false,
    waitMs,
    longWindowBinding: { daily: false, monthly: false, hourly: false },
  };
}

function getObservedRpm(runtime: ProviderRuntimeState): number | null {
  const headers = runtime.observedRateLimits;
  if (!headers?.limit || !headers.reset) return null;
  // If reset is in seconds from now or absolute — treat as RPM estimate when limit looks per-minute
  if (headers.limit > 0 && headers.limit <= 120) return headers.limit;
  return null;
}

function getObservedRpmLimit(runtime: ProviderRuntimeState): number | null {
  return getObservedRpm(runtime);
}
