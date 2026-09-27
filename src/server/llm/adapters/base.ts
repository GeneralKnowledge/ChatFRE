import type {
  AdapterCredentials,
  ChatChunk,
  ChatRequest,
  ChatResult,
  HealthStatus,
  ModelConfig,
  ObservedRateLimitHeaders,
  ProviderConfig,
} from "../types";

export interface ProviderAdapter {
  readonly style: ProviderConfig["apiStyle"];
  chat(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
  ): Promise<ChatResult>;
  streamChat(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
  ): AsyncGenerator<ChatChunk, ChatResult | void, unknown>;
  listModels(
    provider: ProviderConfig,
    credentials: AdapterCredentials,
  ): Promise<ModelConfig[]>;
  healthCheck(
    provider: ProviderConfig,
    credentials: AdapterCredentials,
  ): Promise<HealthStatus>;
}

export function buildUrl(
  provider: ProviderConfig,
  routeKey: keyof ProviderConfig["routes"],
  extras?: Record<string, string>,
): string {
  let route = provider.routes[routeKey];
  if (!route) {
    throw new Error(`Route ${String(routeKey)} not configured for ${provider.id}`);
  }

  let base = provider.baseUrl;
  if (extras?.account_id) {
    base = base.replace("{account_id}", extras.account_id);
  }
  if (extras?.model) {
    route = route.replace("{model}", encodeURIComponent(extras.model));
  }

  if (route.startsWith("http")) return route;
  return `${base.replace(/\/$/, "")}${route.startsWith("/") ? "" : "/"}${route}`;
}

export function parseRateLimitHeaders(
  headers: Headers,
): ObservedRateLimitHeaders {
  const raw: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower.includes("rate") ||
      lower.includes("retry") ||
      lower.includes("limit") ||
      lower.includes("remaining") ||
      lower.includes("reset")
    ) {
      raw[lower] = value;
    }
  });

  const num = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const v = raw[key];
      if (v !== undefined && v !== "") {
        const n = Number(v);
        if (!Number.isNaN(n)) return n;
      }
    }
    return undefined;
  };

  return {
    remaining: num([
      "x-ratelimit-remaining",
      "x-ratelimit-remaining-requests",
      "ratelimit-remaining",
    ]),
    limit: num([
      "x-ratelimit-limit",
      "x-ratelimit-limit-requests",
      "ratelimit-limit",
    ]),
    reset: num([
      "x-ratelimit-reset",
      "x-ratelimit-reset-requests",
      "ratelimit-reset",
    ]),
    retryAfter: num(["retry-after"]),
    raw,
  };
}

export function authHeaders(
  provider: ProviderConfig,
  credentials: AdapterCredentials,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (credentials.apiKey) {
    if (provider.authentication.type === "query_or_header") {
      headers["x-goog-api-key"] = credentials.apiKey;
    } else {
      headers.Authorization = `Bearer ${credentials.apiKey}`;
    }
  }

  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_HTTP_REFERER ?? "https://localhost";
    headers["X-Title"] = process.env.OPENROUTER_APP_TITLE ?? "FreeLLM Chat";
  }

  return headers;
}

export class ProviderHttpError extends Error {
  status: number;
  retryable: boolean;
  rateLimitHeaders?: ObservedRateLimitHeaders;
  body?: string;

  constructor(
    message: string,
    status: number,
    opts?: {
      retryable?: boolean;
      rateLimitHeaders?: ObservedRateLimitHeaders;
      body?: string;
    },
  ) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryable =
      opts?.retryable !== undefined
        ? opts.retryable
        : status === 429 || status === 408 || (status >= 500 && status < 600);
    this.rateLimitHeaders = opts?.rateLimitHeaders;
    this.body = opts?.body;
  }
}

export function classifyError(error: unknown): {
  retryable: boolean;
  status?: number;
  message: string;
  rateLimitHeaders?: ObservedRateLimitHeaders;
} {
  if (error instanceof ProviderHttpError) {
    return {
      retryable: error.retryable,
      status: error.status,
      message: error.message,
      rateLimitHeaders: error.rateLimitHeaders,
    };
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    const network =
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("enotfound");
    return { retryable: network, message: error.message };
  }
  return { retryable: false, message: String(error) };
}
