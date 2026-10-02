import { createLogger } from "@/lib/logging/logger";
import {
  getFreeLlmApiConfig,
  resolveFreeLlmModel,
  ROUTING_STRATEGIES,
} from "./config";
import type { ChatChunk, ChatMessage, ChatResult } from "@/server/llm/types";

const log = createLogger("freellmapi");

export type FreeLlmModel = {
  id: string;
  name: string;
  ownedBy?: string;
  executionStatus?: "ready" | "needsKey" | "exhausted" | string;
  contextWindow?: number;
};

export type FreeLlmStatus = {
  ok: boolean;
  configured: boolean;
  baseUrl: string;
  dashboardUrl: string;
  latencyMs?: number;
  error?: string;
  modelCount?: number;
  readyCount?: number;
};

function authHeaders(apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export class FreeLlmApiError extends Error {
  status: number;
  retryable: boolean;
  body?: string;

  constructor(
    message: string,
    status: number,
    opts?: { retryable?: boolean; body?: string },
  ) {
    super(message);
    this.name = "FreeLlmApiError";
    this.status = status;
    this.retryable = opts?.retryable ?? (status === 429 || status >= 500);
    this.body = opts?.body;
  }
}

export async function getFreeLlmStatus(): Promise<FreeLlmStatus> {
  const config = getFreeLlmApiConfig();
  if (!config.configured) {
    return {
      ok: false,
      configured: false,
      baseUrl: config.baseUrl,
      dashboardUrl: config.dashboardUrl,
      error:
        "FREELLMAPI_API_KEY is not set. Start FreeLLMAPI and copy your unified key from its Keys page.",
    };
  }

  const started = Date.now();
  try {
    const response = await fetch(
      joinUrl(config.baseUrl, "/models?execution_status=ready"),
      {
        headers: authHeaders(config.apiKey),
        signal: AbortSignal.timeout(8_000),
      },
    );
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        configured: true,
        baseUrl: config.baseUrl,
        dashboardUrl: config.dashboardUrl,
        latencyMs,
        error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await response.json()) as { data?: unknown[] };
    const readyCount = Array.isArray(data.data) ? data.data.length : 0;

    // Also fetch full catalog size when possible
    let modelCount = readyCount;
    try {
      const all = await fetch(joinUrl(config.baseUrl, "/models"), {
        headers: authHeaders(config.apiKey),
        signal: AbortSignal.timeout(8_000),
      });
      if (all.ok) {
        const allData = (await all.json()) as { data?: unknown[] };
        if (Array.isArray(allData.data)) modelCount = allData.data.length;
      }
    } catch {
      // ignore secondary failure
    }

    return {
      ok: true,
      configured: true,
      baseUrl: config.baseUrl,
      dashboardUrl: config.dashboardUrl,
      latencyMs,
      modelCount,
      readyCount,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      baseUrl: config.baseUrl,
      dashboardUrl: config.dashboardUrl,
      latencyMs: Date.now() - started,
      error:
        error instanceof Error
          ? error.message
          : "Unable to reach FreeLLMAPI",
    };
  }
}

export async function listFreeLlmModels(opts?: {
  readyOnly?: boolean;
}): Promise<FreeLlmModel[]> {
  const config = getFreeLlmApiConfig();
  if (!config.configured) return [];

  const query = opts?.readyOnly ? "?execution_status=ready" : "";
  const response = await fetch(joinUrl(config.baseUrl, `/models${query}`), {
    headers: authHeaders(config.apiKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new FreeLlmApiError(
      `Failed to list models: HTTP ${response.status}`,
      response.status,
      { body: text },
    );
  }

  const data = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      owned_by?: string;
      execution_status?: string;
      context_window?: number;
      context_length?: number;
    }>;
  };

  const models = (data.data ?? [])
    .filter((m) => m.id && !m.id.startsWith("auto") && m.id !== "fusion")
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      ownedBy: m.owned_by,
      executionStatus: m.execution_status,
      contextWindow: m.context_window ?? m.context_length,
    }));

  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export function getRoutingStrategies() {
  return ROUTING_STRATEGIES.map((s) => ({ ...s }));
}

export type StreamChatOptions = {
  messages: ChatMessage[];
  model?: string | null;
  provider?: string | null;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

/**
 * Stream a chat completion from FreeLLMAPI.
 * Yields token chunks; returns the final ChatResult (including X-Routed-Via).
 */
export async function* streamFreeLlmChat(
  options: StreamChatOptions,
): AsyncGenerator<ChatChunk, ChatResult, unknown> {
  const config = getFreeLlmApiConfig();
  if (!config.configured) {
    throw new FreeLlmApiError(
      "FreeLLMAPI is not configured. Set FREELLMAPI_API_KEY and ensure FreeLLMAPI is running.",
      503,
      { retryable: false },
    );
  }

  const model = resolveFreeLlmModel({
    provider: options.provider,
    model: options.model,
  });
  const started = Date.now();
  const body: Record<string, unknown> = {
    model,
    messages: options.messages.map((m) => ({
      role: m.role === "tool" ? "assistant" : m.role,
      content: m.content,
    })),
    stream: true,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  const response = await fetch(joinUrl(config.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: authHeaders(config.apiKey),
    body: JSON.stringify(body),
    signal: options.signal ?? AbortSignal.timeout(180_000),
  });

  const routedVia =
    response.headers.get("x-routed-via") ??
    response.headers.get("X-Routed-Via") ??
    undefined;

  if (!response.ok) {
    const text = await response.text();
    log.warn("chat_failed", {
      status: response.status,
      model,
      error: text.slice(0, 300),
    });
    throw new FreeLlmApiError(
      `FreeLLMAPI error ${response.status}: ${text.slice(0, 400)}`,
      response.status,
      { body: text },
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && !contentType.includes("event")) {
    const text = await response.text();
    const data = JSON.parse(text) as OpenAIChatResponse;
    const content = extractContent(data);
    if (content) yield { type: "token", content };
    const result: ChatResult = {
      content,
      model: data.model ?? model,
      provider: parseRoutedProvider(routedVia) ?? "freellmapi",
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - started,
      finishReason: data.choices?.[0]?.finish_reason,
      routedVia,
    };
    yield {
      type: "done",
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      finishReason: result.finishReason,
    };
    return result;
  }

  if (!response.body) {
    throw new FreeLlmApiError("No response body from FreeLLMAPI", 502, {
      retryable: true,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let resolvedModel = model;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: string | undefined;
  let streamRoutedVia = routedVia;

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
        if (json.model) resolvedModel = json.model;
        if (json.usage?.prompt_tokens !== undefined) {
          inputTokens = json.usage.prompt_tokens;
        }
        if (json.usage?.completion_tokens !== undefined) {
          outputTokens = json.usage.completion_tokens;
        }
        if (json.choices?.[0]?.finish_reason) {
          finishReason = json.choices[0].finish_reason;
        }
        if (json.routed_via) streamRoutedVia = json.routed_via;
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  const result: ChatResult = {
    content: full,
    model: resolvedModel,
    provider: parseRoutedProvider(streamRoutedVia) ?? "freellmapi",
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
    finishReason,
    routedVia: streamRoutedVia,
  };

  yield {
    type: "done",
    usage: { inputTokens, outputTokens },
    finishReason,
  };
  return result;
}

function extractContent(data: OpenAIChatResponse): string {
  const content =
    data.choices?.[0]?.message?.content ??
    data.message?.content ??
    data.text ??
    "";
  return typeof content === "string" ? content : JSON.stringify(content);
}

/** Parse `provider/model` from FreeLLMAPI's X-Routed-Via header. */
export function parseRoutedProvider(routedVia?: string | null): string | null {
  if (!routedVia) return null;
  const trimmed = routedVia.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return trimmed;
  return trimmed.slice(0, slash);
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
  routed_via?: string;
};
