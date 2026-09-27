import type {
  AdapterCredentials,
  ChatChunk,
  ChatRequest,
  ChatResult,
  HealthStatus,
  ModelConfig,
  ProviderConfig,
} from "../types";
import {
  authHeaders,
  buildUrl,
  parseRateLimitHeaders,
  ProviderHttpError,
  type ProviderAdapter,
} from "./base";

export class OpenAIChatAdapter implements ProviderAdapter {
  readonly style = "openai_chat" as const;

  async chat(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
  ): Promise<ChatResult> {
    const started = Date.now();
    const url = buildUrl(provider, "chat", {
      account_id: credentials.accountId ?? "",
    });

    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(provider, credentials),
      body: JSON.stringify(toOpenAIBody(provider, request, false)),
      signal: AbortSignal.timeout(120_000),
    });

    const rateLimitHeaders = parseRateLimitHeaders(response.headers);
    const text = await response.text();

    if (!response.ok) {
      throw new ProviderHttpError(
        `Provider ${provider.id} error ${response.status}: ${text.slice(0, 400)}`,
        response.status,
        { rateLimitHeaders, body: text },
      );
    }

    const data = JSON.parse(text) as OpenAIChatResponse;
    const content =
      data.choices?.[0]?.message?.content ??
      data.message?.content ??
      data.text ??
      "";

    return {
      content: typeof content === "string" ? content : JSON.stringify(content),
      model: data.model ?? request.model,
      provider: provider.id,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - started,
      finishReason: data.choices?.[0]?.finish_reason,
      rateLimitHeaders,
    };
  }

  async *streamChat(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
  ): AsyncGenerator<ChatChunk, ChatResult | void, unknown> {
    if (!provider.scheduler.supportsStreaming) {
      const result = await this.chat(provider, request, credentials);
      if (result.content) yield { type: "token", content: result.content };
      yield {
        type: "done",
        usage: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      };
      return result;
    }

    const started = Date.now();
    const url = buildUrl(provider, "chat", {
      account_id: credentials.accountId ?? "",
    });

    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(provider, credentials),
      body: JSON.stringify(toOpenAIBody(provider, request, true)),
      signal: AbortSignal.timeout(180_000),
    });

    const rateLimitHeaders = parseRateLimitHeaders(response.headers);

    if (!response.ok) {
      const text = await response.text();
      throw new ProviderHttpError(
        `Provider ${provider.id} error ${response.status}: ${text.slice(0, 400)}`,
        response.status,
        { rateLimitHeaders, body: text },
      );
    }

    // Some providers ignore stream and return JSON
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json") && response.body) {
      const text = await response.text();
      const data = JSON.parse(text) as OpenAIChatResponse;
      const content =
        data.choices?.[0]?.message?.content ??
        data.message?.content ??
        data.text ??
        "";
      const str =
        typeof content === "string" ? content : JSON.stringify(content);
      if (str) yield { type: "token", content: str };
      const result: ChatResult = {
        content: str,
        model: data.model ?? request.model,
        provider: provider.id,
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        latencyMs: Date.now() - started,
        finishReason: data.choices?.[0]?.finish_reason,
        rateLimitHeaders,
      };
      yield {
        type: "done",
        usage: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      };
      return result;
    }

    if (!response.body) {
      throw new ProviderHttpError("No response body", 502, { retryable: true });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let model = request.model;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let finishReason: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as OpenAIStreamChunk;
          const delta =
            json.choices?.[0]?.delta?.content ??
            json.choices?.[0]?.message?.content ??
            "";
          if (delta) {
            full += delta;
            yield { type: "token", content: delta };
          }
          if (json.model) model = json.model;
          if (json.usage?.prompt_tokens !== undefined) {
            inputTokens = json.usage.prompt_tokens;
          }
          if (json.usage?.completion_tokens !== undefined) {
            outputTokens = json.usage.completion_tokens;
          }
          if (json.choices?.[0]?.finish_reason) {
            finishReason = json.choices[0].finish_reason;
          }
        } catch {
          // ignore malformed SSE lines
        }
      }
    }

    const result: ChatResult = {
      content: full,
      model,
      provider: provider.id,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      finishReason,
      rateLimitHeaders,
    };
    yield {
      type: "done",
      usage: { inputTokens, outputTokens },
      finishReason,
    };
    return result;
  }

  async listModels(
    provider: ProviderConfig,
    credentials: AdapterCredentials,
  ): Promise<ModelConfig[]> {
    try {
      const url = buildUrl(provider, "models", {
        account_id: credentials.accountId ?? "",
      });
      const response = await fetch(url, {
        headers: authHeaders(provider, credentials),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return provider.models;
      const data = (await response.json()) as {
        data?: Array<{ id: string; name?: string }>;
      };
      if (!data.data?.length) return provider.models;
      return data.data.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        capabilities: ["chat"],
      }));
    } catch {
      return provider.models;
    }
  }

  async healthCheck(
    provider: ProviderConfig,
    credentials: AdapterCredentials,
  ): Promise<HealthStatus> {
    const started = Date.now();
    try {
      const url = buildUrl(provider, "health", {
        account_id: credentials.accountId ?? "",
      });
      const response = await fetch(url, {
        headers: authHeaders(provider, credentials),
        signal: AbortSignal.timeout(10_000),
      });
      return {
        healthy: response.ok,
        latencyMs: Date.now() - started,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        checkedAt: Date.now(),
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now(),
      };
    }
  }
}

function toOpenAIBody(
  provider: ProviderConfig,
  request: ChatRequest,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role === "tool" ? "assistant" : m.role,
      content: m.content,
    })),
    stream,
  };

  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;

  // Cohere v2 chat uses a slightly different shape when hitting /chat —
  // but many Cohere deployments also accept OpenAI-compat gateways.
  // Keep OpenAI shape; Cohere Chat API v2 expects `messages` similarly.
  void provider;
  return body;
}

type OpenAIChatResponse = {
  model?: string;
  choices?: Array<{
    message?: { content?: string | unknown };
    finish_reason?: string;
  }>;
  message?: { content?: string };
  text?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type OpenAIStreamChunk = {
  model?: string;
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};
