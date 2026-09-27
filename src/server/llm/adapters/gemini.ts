import type {
  AdapterCredentials,
  ChatChunk,
  ChatRequest,
  ChatResult,
  HealthStatus,
  ModelConfig,
  ProviderConfig,
} from "../types";
import { OpenAIChatAdapter } from "./openai-chat";
import {
  authHeaders,
  buildUrl,
  parseRateLimitHeaders,
  ProviderHttpError,
  type ProviderAdapter,
} from "./base";

/**
 * Gemini — tries OpenAI-compatible endpoint first, then native generateContent.
 */
export class GeminiAdapter implements ProviderAdapter {
  readonly style = "gemini_native_or_openai_compat" as const;
  private openai = new OpenAIChatAdapter();

  async chat(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
  ): Promise<ChatResult> {
    try {
      return await this.openai.chat(provider, request, credentials);
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status >= 400) {
        return this.nativeGenerate(provider, request, credentials);
      }
      throw error;
    }
  }

  async *streamChat(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
  ): AsyncGenerator<ChatChunk, ChatResult | void, unknown> {
    try {
      return yield* this.openai.streamChat(provider, request, credentials);
    } catch {
      const result = await this.nativeGenerate(provider, request, credentials);
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
  }

  private async nativeGenerate(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
  ): Promise<ChatResult> {
    const started = Date.now();
    let url = buildUrl(provider, "generateContent", { model: request.model });
    if (credentials.apiKey && !url.includes("key=")) {
      url += (url.includes("?") ? "&" : "?") + `key=${credentials.apiKey}`;
    }

    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const system = request.messages.find((m) => m.role === "system");

    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(provider, credentials),
      body: JSON.stringify({
        contents,
        ...(system
          ? { systemInstruction: { parts: [{ text: system.content }] } }
          : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const rateLimitHeaders = parseRateLimitHeaders(response.headers);
    const text = await response.text();
    if (!response.ok) {
      throw new ProviderHttpError(
        `Gemini error ${response.status}: ${text.slice(0, 400)}`,
        response.status,
        { rateLimitHeaders, body: text },
      );
    }

    const data = JSON.parse(text) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };

    const content =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      "";

    return {
      content,
      model: request.model,
      provider: provider.id,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      latencyMs: Date.now() - started,
      rateLimitHeaders,
    };
  }

  listModels(
    provider: ProviderConfig,
    credentials: AdapterCredentials,
  ): Promise<ModelConfig[]> {
    return this.openai.listModels(provider, credentials);
  }

  healthCheck(
    provider: ProviderConfig,
    credentials: AdapterCredentials,
  ): Promise<HealthStatus> {
    return this.openai.healthCheck(provider, credentials);
  }
}
