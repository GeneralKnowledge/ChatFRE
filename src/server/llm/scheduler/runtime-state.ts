import type {
  ObservedRateLimitHeaders,
  ProviderRuntimeState,
} from "../types";
import {
  endOfUtcDay,
  endOfUtcHour,
  endOfUtcMonth,
  startOfUtcDay,
  startOfUtcHour,
  startOfUtcMinute,
  startOfUtcMonth,
} from "./quota";

export function createEmptyRuntimeState(
  providerId: string,
  now = Date.now(),
): ProviderRuntimeState {
  return {
    providerId,
    requestsThisMinute: 0,
    requestsThisHour: 0,
    requestsToday: 0,
    requestsThisMonth: 0,
    tokensThisMinute: 0,
    tokensToday: 0,
    tokensThisMonth: 0,
    queueDepth: 0,
    activeRequests: 0,
    consecutiveFailures: 0,
    lastSuccess: null,
    lastFailure: null,
    blockedUntil: null,
    observedRateLimits: null,
    lastRateLimitHeaders: null,
    health: null,
    enabledOverride: null,
    minuteWindowStart: startOfUtcMinute(now),
    hourWindowStart: startOfUtcHour(now),
    dayWindowStart: startOfUtcDay(now),
    monthWindowStart: startOfUtcMonth(now),
  };
}

export function rollWindows(
  state: ProviderRuntimeState,
  now = Date.now(),
): ProviderRuntimeState {
  const next = { ...state };
  const minuteStart = startOfUtcMinute(now);
  const hourStart = startOfUtcHour(now);
  const dayStart = startOfUtcDay(now);
  const monthStart = startOfUtcMonth(now);

  if (minuteStart !== next.minuteWindowStart) {
    next.requestsThisMinute = 0;
    next.tokensThisMinute = 0;
    next.minuteWindowStart = minuteStart;
  }
  if (hourStart !== next.hourWindowStart) {
    next.requestsThisHour = 0;
    next.hourWindowStart = hourStart;
  }
  if (dayStart !== next.dayWindowStart) {
    next.requestsToday = 0;
    next.tokensToday = 0;
    next.dayWindowStart = dayStart;
  }
  if (monthStart !== next.monthWindowStart) {
    next.requestsThisMonth = 0;
    next.tokensThisMonth = 0;
    next.monthWindowStart = monthStart;
  }
  return next;
}

export function recordSuccess(
  state: ProviderRuntimeState,
  tokens: number,
  now = Date.now(),
): ProviderRuntimeState {
  const rolled = rollWindows(state, now);
  return {
    ...rolled,
    requestsThisMinute: rolled.requestsThisMinute + 1,
    requestsThisHour: rolled.requestsThisHour + 1,
    requestsToday: rolled.requestsToday + 1,
    requestsThisMonth: rolled.requestsThisMonth + 1,
    tokensThisMinute: rolled.tokensThisMinute + tokens,
    tokensToday: rolled.tokensToday + tokens,
    tokensThisMonth: rolled.tokensThisMonth + tokens,
    consecutiveFailures: 0,
    lastSuccess: now,
    activeRequests: Math.max(0, rolled.activeRequests - 1),
  };
}

export function recordFailure(
  state: ProviderRuntimeState,
  opts?: { blockUntil?: number; now?: number },
): ProviderRuntimeState {
  const now = opts?.now ?? Date.now();
  const rolled = rollWindows(state, now);
  return {
    ...rolled,
    consecutiveFailures: rolled.consecutiveFailures + 1,
    lastFailure: now,
    blockedUntil: opts?.blockUntil ?? rolled.blockedUntil,
    activeRequests: Math.max(0, rolled.activeRequests - 1),
  };
}

export function beginRequest(
  state: ProviderRuntimeState,
  now = Date.now(),
): ProviderRuntimeState {
  const rolled = rollWindows(state, now);
  return {
    ...rolled,
    activeRequests: rolled.activeRequests + 1,
  };
}

export function applyObservedHeaders(
  state: ProviderRuntimeState,
  headers: ObservedRateLimitHeaders,
): ProviderRuntimeState {
  return {
    ...state,
    lastRateLimitHeaders: headers,
    observedRateLimits: headers,
  };
}

export function windowResets(now: number): {
  minute: number;
  hour: number;
  day: number;
  month: number;
} {
  return {
    minute: startOfUtcMinute(now) + 60_000,
    hour: endOfUtcHour(now),
    day: endOfUtcDay(now),
    month: endOfUtcMonth(now),
  };
}
