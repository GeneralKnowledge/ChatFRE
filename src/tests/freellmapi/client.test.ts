import { describe, expect, it, vi, afterEach } from "vitest";
import {
  parseRoutedProvider,
  streamFreeLlmChat,
  FreeLlmApiError,
} from "@/server/llm/freellmapi/client";
import {
  resolveFreeLlmModel,
  getFreeLlmApiConfig,
  ROUTING_STRATEGIES,
} from "@/server/llm/freellmapi/config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveFreeLlmModel", () => {
  it("uses explicit model when not auto", () => {
    expect(
      resolveFreeLlmModel({ provider: "auto:fast", model: "gemini-2.5-flash" }),
    ).toBe("gemini-2.5-flash");
  });

  it("maps routing strategy from provider when model is auto", () => {
    expect(resolveFreeLlmModel({ provider: "auto:smart", model: "auto" })).toBe(
      "auto:smart",
    );
    expect(resolveFreeLlmModel({ provider: "auto", model: "auto" })).toBe("auto");
    expect(
      resolveFreeLlmModel({ provider: "freellmapi", model: "auto" }),
    ).toBe("auto");
  });

  it("falls back to auto for legacy provider ids", () => {
    expect(resolveFreeLlmModel({ provider: "groq", model: "auto" })).toBe("auto");
  });
});

describe("parseRoutedProvider", () => {
  it("extracts provider from X-Routed-Via", () => {
    expect(parseRoutedProvider("groq/llama-3.3-70b")).toBe("groq");
    expect(parseRoutedProvider("openrouter/free")).toBe("openrouter");
    expect(parseRoutedProvider("solo")).toBe("solo");
    expect(parseRoutedProvider(null)).toBeNull();
  });
});

describe("getFreeLlmApiConfig", () => {
  it("defaults base URL and reports unconfigured without key", () => {
    vi.stubEnv("FREELLMAPI_BASE_URL", "");
    vi.stubEnv("FREELLMAPI_API_KEY", "");
    const config = getFreeLlmApiConfig();
    expect(config.baseUrl).toBe("http://127.0.0.1:3001/v1");
    expect(config.configured).toBe(false);
    expect(config.dashboardUrl).toBe("http://127.0.0.1:3001");
  });

  it("strips trailing slash from base URL", () => {
    vi.stubEnv("FREELLMAPI_BASE_URL", "http://localhost:3001/v1/");
    vi.stubEnv("FREELLMAPI_API_KEY", "freellmapi-test");
    const config = getFreeLlmApiConfig();
    expect(config.baseUrl).toBe("http://localhost:3001/v1");
    expect(config.configured).toBe(true);
  });
});

describe("ROUTING_STRATEGIES", () => {
  it("includes core auto strategies", () => {
    const ids = ROUTING_STRATEGIES.map((s) => s.id);
    expect(ids).toContain("auto");
    expect(ids).toContain("auto:fast");
    expect(ids).toContain("auto:smart");
  });
});

describe("streamFreeLlmChat", () => {
  it("throws when API key is missing", async () => {
    vi.stubEnv("FREELLMAPI_API_KEY", "");
    const gen = streamFreeLlmChat({
      messages: [{ role: "user", content: "hi" }],
      model: "auto",
    });
    await expect(gen.next()).rejects.toBeInstanceOf(FreeLlmApiError);
  });

  it("streams SSE tokens and returns routed provider", async () => {
    vi.stubEnv("FREELLMAPI_API_KEY", "freellmapi-test");
    vi.stubEnv("FREELLMAPI_BASE_URL", "http://127.0.0.1:3001/v1");

    const sse = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"model":"llama-test"}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(sse, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "X-Routed-Via": "groq/llama-test",
          },
        });
      }),
    );

    const tokens: string[] = [];
    const iter = streamFreeLlmChat({
      messages: [{ role: "user", content: "hi" }],
      provider: "auto:fast",
      model: "auto",
    });

    let result;
    while (true) {
      const next = await iter.next();
      if (next.done) {
        result = next.value;
        break;
      }
      if (next.value.type === "token" && next.value.content) {
        tokens.push(next.value.content);
      }
    }

    expect(tokens.join("")).toBe("Hello world");
    expect(result?.content).toBe("Hello world");
    expect(result?.provider).toBe("groq");
    expect(result?.routedVia).toBe("groq/llama-test");
    expect(result?.model).toBe("llama-test");

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe("http://127.0.0.1:3001/v1/chat/completions");
    const body = JSON.parse(call?.[1]?.body as string) as { model: string };
    expect(body.model).toBe("auto:fast");
  });

  it("handles non-streaming JSON responses", async () => {
    vi.stubEnv("FREELLMAPI_API_KEY", "freellmapi-test");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            model: "mistral-small",
            choices: [{ message: { content: "Bonjour" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 3, completion_tokens: 1 },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Routed-Via": "mistral/mistral-small",
            },
          },
        );
      }),
    );

    const iter = streamFreeLlmChat({
      messages: [{ role: "user", content: "hi" }],
      model: "mistral-small",
    });
    const tokens: string[] = [];
    let result;
    while (true) {
      const next = await iter.next();
      if (next.done) {
        result = next.value;
        break;
      }
      if (next.value.type === "token" && next.value.content) {
        tokens.push(next.value.content);
      }
    }

    expect(tokens).toEqual(["Bonjour"]);
    expect(result?.provider).toBe("mistral");
    expect(result?.inputTokens).toBe(3);
  });
});
