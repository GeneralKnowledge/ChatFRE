import type { LimitValue, ProviderConfig } from "../types";

export function getNumericLimit(
  limits: ProviderConfig["limits"],
  key: string,
): number | null {
  const raw = limits[key];
  if (!raw || typeof raw === "string") return null;
  if (typeof raw.value !== "number") return null;
  const multiplier =
    raw.official === false && typeof raw.safetyMultiplier === "number"
      ? raw.safetyMultiplier
      : 1;
  return Math.floor(raw.value * multiplier);
}

export function getLimitMeta(
  limits: ProviderConfig["limits"],
  key: string,
): LimitValue | null {
  const raw = limits[key];
  if (!raw || typeof raw === "string") return null;
  return raw;
}

/**
 * Long-window binding logic for single-user scheduling.
 *
 * If remainingQuota >= burstRPM * remainingMinutes, the quota is NOT binding
 * and the provider may operate at its short-window burst limit.
 */
export function isLongWindowBinding(params: {
  remainingQuota: number;
  remainingMinutes: number;
  burstRPM: number;
}): boolean {
  const { remainingQuota, remainingMinutes, burstRPM } = params;
  if (remainingQuota <= 0) return true;
  if (burstRPM <= 0) return remainingQuota < Number.POSITIVE_INFINITY;
  if (remainingMinutes <= 0) return true;

  const maximumPossibleRequestsBeforeReset = burstRPM * remainingMinutes;
  return remainingQuota < maximumPossibleRequestsBeforeReset;
}

export function remainingInWindow(
  used: number,
  limit: number | null,
  reserveFraction = 0,
): number {
  if (limit === null) return Number.POSITIVE_INFINITY;
  const reserve = Math.ceil(limit * reserveFraction);
  return Math.max(0, limit - used - reserve);
}

export function minutesUntil(resetAt: number, now: number): number {
  return Math.max(0, (resetAt - now) / 60_000);
}

export function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function endOfUtcDay(now: number): number {
  return startOfUtcDay(now) + 24 * 60 * 60 * 1000;
}

export function startOfUtcMonth(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function endOfUtcMonth(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function startOfUtcHour(now: number): number {
  const d = new Date(now);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
  );
}

export function endOfUtcHour(now: number): number {
  return startOfUtcHour(now) + 60 * 60 * 1000;
}

export function startOfUtcMinute(now: number): number {
  return Math.floor(now / 60_000) * 60_000;
}
