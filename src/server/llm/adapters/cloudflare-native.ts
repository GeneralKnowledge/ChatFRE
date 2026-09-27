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
 * Cloudflare Workers AI — prefers OpenAI-compatible chat route when available,
 * falls back to native /run/{model}.
 */
export class CloudflareNativeAdapter implements ProviderAdapter {
  readonly style = "cloudflare_native" as const;
  private openai = new OpenAIChatAdapter();

  async chat(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
  ): Promise<ChatResult> {
    if (!credentials.accountId) {
      throw new ProviderHttpError(
        "CLOUDFLARE_ACCOUNT_ID is required",
        401,
        { retryable: false },
      );
    }

    try {
      return await this.openai.chat(provider, request, credentials);
    } catch (error) {
      if (
        error instanceof ProviderHttpError &&
        (error.status === 404 || error.status === 405)
      ) {
        return this.nativeRun(provider, request, credentials, false);
      }
      throw error;
    }
  }

  async *streamChat(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
  ): AsyncGenerator<ChatChunk, ChatResult | void, unknown> {
    if (!credentials.accountId) {
      throw new ProviderHttpError(
        "CLOUDFLARE_ACCOUNT_ID is required",
        401,
        { retryable: false },
      );
    }

    try {
      const result = yield* this.openai.streamChat(
        provider,
        request,
        credentials,
      );
      return result;
    } catch (error) {
      if (
        error instanceof ProviderHttpError &&
        (error.status === 404 || error.status === 405)
      ) {
        const result = await this.nativeRun(
          provider,
          request,
          credentials,
          false,
        );
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
      throw error;
    }
  }

  private async nativeRun(
    provider: ProviderConfig,
    request: ChatRequest,
    credentials: AdapterCredentials,
    _stream: boolean,
  ): Promise<ChatResult> {
    const started = Date.now();
    const url = buildUrl(provider, "run", {
      account_id: credentials.accountId!,
      model: request.model,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(provider, credentials),
      body: JSON.stringify({
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const rateLimitHeaders = parseRateLimitHeaders(response.headers);
    const text = await response.text();
    if (!response.ok) {
      throw new ProviderHttpError(
        `Cloudflare error ${response.status}: ${text.slice(0, 400)}`,
        response.status,
        { rateLimitHeaders, body: text },
      );
    }

    const data = JSON.parse(text) as {
      result?: { response?: string };
      response?: string;
    };
    const content = data.result?.response ?? data.response ?? "";

    return {
      content,
      model: request.model,
      provider: provider.id,
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
