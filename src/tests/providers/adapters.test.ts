import { describe, expect, it } from "vitest";
import { buildUrl, parseRateLimitHeaders, authHeaders } from "@/server/llm/adapters/base";
import type { ProviderConfig } from "@/server/llm/types";

const provider: ProviderConfig = {
  id: "groq",
  name: "Groq",
  enabled: true,
  reason: null,
  ukStatus: "available",
  free: true,
  baseUrl: "https://api.groq.com/openai/v1",
  apiStyle: "openai_chat",
  authentication: { type: "bearer", envVar: "GROQ_API_KEY", required: true },
  routes: {
    chat: "/chat/completions",
    models: "/models",
    health: "/models",
  },
  models: [],
  limits: {},
  scheduler: { priority: 1, supportsStreaming: true, reserveDailyFraction: 0.05 },
};

describe("buildUrl", () => {
  it("joins baseUrl and route without scattering construction", () => {
    expect(buildUrl(provider, "chat")).toBe(
      "https://api.groq.com/openai/v1/chat/completions",
    );
  });

  it("substitutes account_id and model placeholders", () => {
    const cf: ProviderConfig = {
      ...provider,
      id: "cloudflare",
      baseUrl:
        "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai",
      routes: {
        chat: "/v1/chat/completions",
        models: "/models",
        health: "/models",
        run: "/run/{model}",
      },
    };
    expect(
      buildUrl(cf, "run", {
        account_id: "abc",
        model: "@cf/meta/llama",
      }),
    ).toBe(
      "https://api.cloudflare.com/client/v4/accounts/abc/ai/run/%40cf%2Fmeta%2Fllama",
    );
  });
});

describe("parseRateLimitHeaders", () => {
  it("captures remaining/limit/reset/retry-after", () => {
    const headers = new Headers({
      "x-ratelimit-remaining-requests": "12",
      "x-ratelimit-limit-requests": "30",
      "x-ratelimit-reset-requests": "45",
      "retry-after": "10",
    });
    const parsed = parseRateLimitHeaders(headers);
    expect(parsed.remaining).toBe(12);
    expect(parsed.limit).toBe(30);
    expect(parsed.reset).toBe(45);
    expect(parsed.retryAfter).toBe(10);
  });
});

describe("authHeaders", () => {
  it("sets bearer token and never leaks into accidental fields", () => {
    const headers = authHeaders(provider, { apiKey: "secret-key" });
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
