import { getAdapter } from "../adapters/factory";
import { classifyError } from "../adapters/base";
import { credentialStore } from "../providers/credentials";
import {
  getFreeOnlyDefault,
  getGlobalConcurrency,
  getProviderById,
  getProviderConfigs,
  loadProvidersConfig,
} from "../providers/registry";
import type {
  ChatChunk,
  ChatRequest,
  ChatResult,
  ProviderConfig,
  ProviderRuntimeState,
  ProviderScore,
  QueuePriority,
  SelectionContext,
} from "../types";
import { RequestQueue } from "./queue";
import { getNumericLimit } from "./quota";
import {
  applyObservedHeaders,
  beginRequest,
  createEmptyRuntimeState,
  recordFailure,
  recordSuccess,
  rollWindows,
} from "./runtime-state";
import { isNonRetryable, isTransient, withRetry } from "./retry";
import { scoreProvider } from "./scorer";
import { TokenBucket } from "./token-bucket";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("scheduler");

export type ExecuteOptions = {
  priority?: QueuePriority;
  conversationId?: string;
  stream?: boolean;
  preferredProvider?: string | null;
  preferredModel?: string | null;
  freeOnly?: boolean;
  ukEligible?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: SchedulerEvent) => void;
};

export type SchedulerEvent =
  | { type: "selected"; providerId: string; modelId: string; score: ProviderScore }
  | { type: "retry"; providerId: string; attempt: number; error: string }
  | { type: "failover"; from: string; to: string; reason: string }
  | { type: "queued"; position: number; message: string }
  | { type: "token"; content: string }
  | { type: "error"; message: string; userMessage: string };

/**
 * Single-user LLM scheduler / router.
 * Hard limits via token buckets; long-window quotas as budget signals.
 */
export class LlmScheduler {
  private runtime = new Map<string, ProviderRuntimeState>();
  private rpmBuckets = new Map<string, TokenBucket>();
  private queue = new RequestQueue();
  private globalActive = 0;
  private globalConcurrency: number;

  constructor(globalConcurrency?: number) {
    this.globalConcurrency =
      globalConcurrency ?? getGlobalConcurrency() ?? 1;
  }

  getRuntime(providerId: string, now = Date.now()): ProviderRuntimeState {
    let state = this.runtime.get(providerId);
    if (!state) {
      state = createEmptyRuntimeState(providerId, now);
      this.runtime.set(providerId, state);
    }
    state = rollWindows(state, now);
    this.runtime.set(providerId, state);
    return state;
  }

  setRuntime(state: ProviderRuntimeState): void {
    this.runtime.set(state.providerId, state);
  }

  setEnabledOverride(providerId: string, enabled: boolean | null): void {
    const state = this.getRuntime(providerId);
    this.setRuntime({ ...state, enabledOverride: enabled });
  }

  getQueue() {
    return this.queue;
  }

  private getRpmBucket(provider: ProviderConfig, now = Date.now()): TokenBucket {
    let bucket = this.rpmBuckets.get(provider.id);
    const rpm = getNumericLimit(provider.limits, "rpm") ?? 60;
    if (!bucket) {
      // capacity = rpm, refill = rpm per minute
      bucket = new TokenBucket(rpm, rpm / 60, now);
      this.rpmBuckets.set(provider.id, bucket);
    }
    return bucket;
  }

  rankProviders(context: SelectionContext): ProviderScore[] {
    const providers = getProviderConfigs({ includeDisabled: true });
    const scores: ProviderScore[] = [];

    for (const provider of providers) {
      const models = selectModels(provider, context);
      for (const model of models) {
        const runtime = this.getRuntime(provider.id, context.now);
        runtime.queueDepth = this.queue.depthForProvider(provider.id);
        const score = scoreProvider({
          provider,
          runtime,
          modelId: model.id,
          context,
          hasCredentials: credentialStore.isConfigured(provider),
        });
        scores.push(score);
      }
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  selectBest(context: SelectionContext): ProviderScore | null {
    const ranked = this.rankProviders(context);
    return ranked.find((s) => s.available) ?? null;
  }

  async executeChat(
    request: ChatRequest,
    options: ExecuteOptions = {},
  ): Promise<ChatResult> {
    const stream = options.stream ?? false;
    if (stream) {
      let result: ChatResult | null = null;
      for await (const chunk of this.streamChat(request, options)) {
        if (chunk.type === "meta" && chunk.content) {
          // ignore
        }
        if (chunk.type === "done") {
          // final result assembled below
        }
        if (chunk.type === "error") {
          throw new Error(chunk.error ?? "Chat failed");
        }
      }
      // streamChat yields final via return — collect via helper
      result = await this.collectStream(request, options);
      return result;
    }
    return this.runWithFailover(request, options, false);
  }

  private async collectStream(
    request: ChatRequest,
    options: ExecuteOptions,
  ): Promise<ChatResult> {
    return this.runWithFailover(request, options, true);
  }

  async *streamChat(
    request: ChatRequest,
    options: ExecuteOptions = {},
  ): AsyncGenerator<ChatChunk, void, unknown> {
    const result = await this.runWithFailover(request, options, true, {
      onToken: async (token) => {
        // Tokens are yielded via a buffer approach — see runWithFailover stream path
        void token;
      },
    });

    // If we already streamed inside, we still need to expose tokens to caller.
    // Prefer direct streaming path:
    yield* this.streamWithFailover(request, options);
    void result;
  }

  async *streamWithFailover(
    request: ChatRequest,
    options: ExecuteOptions = {},
  ): AsyncGenerator<ChatChunk, ChatResult, unknown> {
    await this.waitForGlobalSlot(options);

    const freeOnly = options.freeOnly ?? getFreeOnlyDefault();
    const exclude: string[] = [];
    let lastError: unknown;
    let attemptProvider: string | null = null;

    try {
      for (let failover = 0; failover < 6; failover++) {
        const context: SelectionContext = {
          now: Date.now(),
          freeOnly,
          preferredProvider:
            options.preferredProvider === "auto"
              ? null
              : options.preferredProvider,
          preferredModel:
            options.preferredModel === "auto" ? null : options.preferredModel,
          excludeProviders: exclude,
          estimatedTokens: estimateTokens(request),
          ukEligible: options.ukEligible,
        };

        // Resolve explicit provider/model
        const explicit = resolveExplicit(request.model, options);
        let selection = explicit
          ? this.scoreExplicit(explicit, context)
          : this.selectBest(context);

        if (!selection || !selection.available) {
          if (this.globalActive === 0 && this.queue.depth() === 0) {
            options.onEvent?.({
              type: "queued",
              position: 0,
              message:
                "All available free AI providers are currently unavailable. Your request has been queued.",
            });
          }
          const waitCandidate = this.rankProviders(context).find(
            (s) => !s.available && s.waitMs > 0 && s.waitMs < 60_000,
          );
          if (waitCandidate && failover < 2) {
            await sleep(Math.min(waitCandidate.waitMs, 5_000));
            continue;
          }
          throw new Error(
            "No available provider can currently handle this request.",
          );
        }

        options.onEvent?.({
          type: "selected",
          providerId: selection.providerId,
          modelId: selection.modelId,
          score: selection,
        });

        const provider = getProviderById(selection.providerId);
        if (!provider) {
          exclude.push(selection.providerId);
          continue;
        }

        const credentials = credentialStore.get(provider);
        if (!credentials && provider.authentication.required) {
          exclude.push(provider.id);
          continue;
        }

        const bucket = this.getRpmBucket(provider);
        if (!bucket.tryTake(1)) {
          exclude.push(provider.id);
          continue;
        }

        let state = beginRequest(this.getRuntime(provider.id));
        this.setRuntime(state);
        attemptProvider = provider.id;

        const adapter = getAdapter(provider);
        const chatRequest: ChatRequest = {
          ...request,
          model: selection.modelId,
          stream: true,
        };

        try {
          const generator = adapter.streamChat(
            provider,
            chatRequest,
            credentials ?? {},
          );
          let final: ChatResult | void = undefined;
          let yieldedTokens = false;

          while (true) {
            if (options.signal?.aborted) {
              throw new DOMException("Aborted", "AbortError");
            }
            const next = await generator.next();
            if (next.done) {
              final = next.value;
              break;
            }
            const chunk = next.value;
            if (chunk.type === "token" && chunk.content) {
              yieldedTokens = true;
              yield chunk;
            } else if (chunk.type === "error") {
              throw new Error(chunk.error ?? "Stream error");
            } else {
              yield chunk;
            }
          }

          const result: ChatResult =
            final ??
            ({
              content: "",
              model: selection.modelId,
              provider: provider.id,
              latencyMs: 0,
            } satisfies ChatResult);

          if (!yieldedTokens && result.content) {
            yield { type: "token", content: result.content };
          }

          const tokens =
            ((result.inputTokens ?? 0) + (result.outputTokens ?? 0) ||
              estimateTokens(request) + Math.ceil(result.content.length / 4));

          state = recordSuccess(this.getRuntime(provider.id), tokens);
          if (result.rateLimitHeaders) {
            state = applyObservedHeaders(state, result.rateLimitHeaders);
          }
          this.setRuntime(state);

          yield {
            type: "done",
            usage: {
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
            },
            finishReason: result.finishReason,
          };
          return { ...result, provider: provider.id, model: selection.modelId };
        } catch (error) {
          const classified = classifyError(error);
          log.warn("provider_stream_failed", {
            provider: provider.id,
            error: classified.message,
            status: classified.status,
          });

          const blockUntil =
            classified.status === 429
              ? Date.now() +
                (classified.rateLimitHeaders?.retryAfter
                  ? classified.rateLimitHeaders.retryAfter * 1000
                  : 30_000)
              : undefined;

          state = recordFailure(this.getRuntime(provider.id), { blockUntil });
          if (classified.rateLimitHeaders) {
            state = applyObservedHeaders(state, classified.rateLimitHeaders);
          }
          this.setRuntime(state);

          options.onEvent?.({
            type: "retry",
            providerId: provider.id,
            attempt: failover + 1,
            error: classified.message,
          });

          if (isNonRetryable(error) && classified.status !== 429) {
            exclude.push(provider.id);
            lastError = error;
            if (yieldedAnyTokensHint(error)) {
              throw error;
            }
            options.onEvent?.({
              type: "failover",
              from: provider.id,
              to: "next",
              reason: userFacingFailover(classified.message),
            });
            continue;
          }

          if (isTransient(error) || classified.status === 429) {
            exclude.push(provider.id);
            lastError = error;
            options.onEvent?.({
              type: "failover",
              from: provider.id,
              to: "next",
              reason: userFacingFailover(classified.message),
            });
            continue;
          }

          throw error;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(
            "All available free AI providers are currently unavailable. Your request has been queued.",
          );
    } finally {
      this.globalActive = Math.max(0, this.globalActive - 1);
      void attemptProvider;
    }
  }

  private async runWithFailover(
    request: ChatRequest,
    options: ExecuteOptions,
    stream: boolean,
    _hooks?: { onToken?: (t: string) => Promise<void> },
  ): Promise<ChatResult> {
    if (stream) {
      let result: ChatResult | null = null;
      for await (const chunk of this.streamWithFailover(request, options)) {
        if (chunk.type === "done") {
          // continue until generator returns
        }
      }
      // Re-run is wasteful — use a dedicated collector
      const iter = this.streamWithFailover(request, options);
      let full = "";
      let last: ChatResult | null = null;
      while (true) {
        const next = await iter.next();
        if (next.done) {
          last = next.value;
          break;
        }
        if (next.value.type === "token" && next.value.content) {
          full += next.value.content;
          options.onEvent?.({ type: "token", content: next.value.content });
        }
      }
      result = last ?? {
        content: full,
        model: request.model,
        provider: "unknown",
        latencyMs: 0,
      };
      return result;
    }

    await this.waitForGlobalSlot(options);
    const freeOnly = options.freeOnly ?? getFreeOnlyDefault();
    const exclude: string[] = [];
    let lastError: unknown;

    try {
      return await withRetry(
        async (attempt) => {
          const context: SelectionContext = {
            now: Date.now(),
            freeOnly,
            preferredProvider:
              options.preferredProvider === "auto"
                ? null
                : options.preferredProvider,
            preferredModel:
              options.preferredModel === "auto"
                ? null
                : options.preferredModel,
            excludeProviders: exclude,
            estimatedTokens: estimateTokens(request),
            ukEligible: options.ukEligible,
          };

          const explicit = resolveExplicit(request.model, options);
          const selection = explicit
            ? this.scoreExplicit(explicit, context)
            : this.selectBest(context);

          if (!selection?.available) {
            throw new Error(
              "No available provider can currently handle this request.",
            );
          }

          const provider = getProviderById(selection.providerId)!;
          const credentials = credentialStore.get(provider) ?? {};
          const bucket = this.getRpmBucket(provider);
          if (!bucket.tryTake(1)) {
            exclude.push(provider.id);
            throw Object.assign(new Error("RPM limited"), {
              retryable: true,
              status: 429,
            });
          }

          let state = beginRequest(this.getRuntime(provider.id));
          this.setRuntime(state);

          options.onEvent?.({
            type: "selected",
            providerId: provider.id,
            modelId: selection.modelId,
            score: selection,
          });

          try {
            const adapter = getAdapter(provider);
            const result = await adapter.chat(
              provider,
              { ...request, model: selection.modelId },
              credentials,
            );
            const tokens =
              ((result.inputTokens ?? 0) + (result.outputTokens ?? 0) ||
                estimateTokens(request));
            state = recordSuccess(this.getRuntime(provider.id), tokens);
            if (result.rateLimitHeaders) {
              state = applyObservedHeaders(state, result.rateLimitHeaders);
            }
            this.setRuntime(state);
            return { ...result, provider: provider.id, model: selection.modelId };
          } catch (error) {
            const classified = classifyError(error);
            const blockUntil =
              classified.status === 429
                ? Date.now() + 30_000
                : undefined;
            state = recordFailure(this.getRuntime(provider.id), { blockUntil });
            this.setRuntime(state);
            exclude.push(provider.id);
            options.onEvent?.({
              type: "failover",
              from: provider.id,
              to: "next",
              reason: userFacingFailover(classified.message),
            });
            lastError = error;
            throw error;
          }
        },
        {
          maxAttempts: 5,
          shouldRetry: (error, attempt) =>
            attempt < 5 && !isNonRetryable(error) && isTransient(error),
          onRetry: (error, attempt, delayMs) => {
            log.info("retry", {
              attempt,
              delayMs,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        },
      );
    } finally {
      this.globalActive = Math.max(0, this.globalActive - 1);
      void lastError;
    }
  }

  private scoreExplicit(
    explicit: { providerId: string; modelId: string },
    context: SelectionContext,
  ): ProviderScore | null {
    const provider = getProviderById(explicit.providerId);
    if (!provider) return null;
    return scoreProvider({
      provider,
      runtime: this.getRuntime(provider.id, context.now),
      modelId: explicit.modelId,
      context,
      hasCredentials: credentialStore.isConfigured(provider),
    });
  }

  private async waitForGlobalSlot(options: ExecuteOptions): Promise<void> {
    if (this.globalActive < this.globalConcurrency) {
      this.globalActive += 1;
      return;
    }

    options.onEvent?.({
      type: "queued",
      position: this.queue.depth() + 1,
      message:
        "All available free AI providers are currently unavailable. Your request has been queued.",
    });

    // Lightweight wait loop for single-user concurrency
    const started = Date.now();
    while (this.globalActive >= this.globalConcurrency) {
      if (options.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (Date.now() - started > 120_000) {
        throw new Error(
          "No available provider can currently handle this request.",
        );
      }
      await sleep(50);
    }
    this.globalActive += 1;
  }

  getStatus() {
    loadProvidersConfig();
    const providers = getProviderConfigs({ includeDisabled: true });
    return providers.map((p) => {
      const runtime = this.getRuntime(p.id);
      const ranked = scoreProvider({
        provider: p,
        runtime,
        modelId: p.models.find((m) => m.preferred)?.id ?? p.models[0]?.id ?? "",
        context: {
          now: Date.now(),
          freeOnly: getFreeOnlyDefault(),
        },
        hasCredentials: credentialStore.isConfigured(p),
      });
      return {
        id: p.id,
        name: p.name,
        enabled: runtime.enabledOverride ?? p.enabled,
        reason: p.reason,
        free: p.free,
        apiKeyConfigured: credentialStore.isConfigured(p),
        health: runtime.health,
        budget: {
          requestsToday: runtime.requestsToday,
          requestsThisMonth: runtime.requestsThisMonth,
          tokensToday: runtime.tokensToday,
          rpd: getNumericLimit(p.limits, "rpd"),
          rpm: getNumericLimit(p.limits, "rpm"),
          monthly: getNumericLimit(p.limits, "monthly"),
        },
        queueDepth: this.queue.depthForProvider(p.id),
        activeRequests: runtime.activeRequests,
        consecutiveFailures: runtime.consecutiveFailures,
        available: ranked.available,
        score: ranked.available ? ranked.score : null,
        models: p.models,
        blockedUntil: runtime.blockedUntil,
      };
    });
  }
}

function selectModels(provider: ProviderConfig, context: SelectionContext) {
  if (context.preferredModel && context.preferredModel.includes("/")) {
    // provider/model form handled elsewhere
  }
  if (
    context.preferredProvider === provider.id &&
    context.preferredModel &&
    context.preferredModel !== "auto"
  ) {
    const found = provider.models.find((m) => m.id === context.preferredModel);
    if (found) return [found];
  }
  const preferred = provider.models.filter((m) => m.preferred);
  if (preferred.length) return preferred;
  return provider.models.slice(0, 1);
}

function resolveExplicit(
  modelField: string,
  options: ExecuteOptions,
): { providerId: string; modelId: string } | null {
  const providerPref = options.preferredProvider;
  const modelPref = options.preferredModel ?? modelField;

  if (providerPref && providerPref !== "auto" && modelPref && modelPref !== "auto") {
    // model may be "provider/model" or just model id
    if (modelPref.includes("/") && modelPref.startsWith(providerPref + "/")) {
      return {
        providerId: providerPref,
        modelId: modelPref.slice(providerPref.length + 1),
      };
    }
    return { providerId: providerPref, modelId: modelPref };
  }

  if (modelPref && modelPref !== "auto" && modelPref.includes("/")) {
    const [providerId, ...rest] = modelPref.split("/");
    if (providerId && getProviderById(providerId)) {
      return { providerId, modelId: rest.join("/") };
    }
  }

  if (providerPref && providerPref !== "auto") {
    const provider = getProviderById(providerPref);
    if (!provider) return null;
    const model =
      modelPref && modelPref !== "auto"
        ? modelPref
        : provider.models.find((m) => m.preferred)?.id ?? provider.models[0]?.id;
    if (!model) return null;
    return { providerId: providerPref, modelId: model };
  }

  return null;
}

function estimateTokens(request: ChatRequest): number {
  const chars = request.messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 4) + 64;
}

function userFacingFailover(technical: string): string {
  if (/429|rate/i.test(technical)) {
    return "This provider is temporarily rate limited. Trying another provider...";
  }
  if (/5\d\d/.test(technical)) {
    return "This provider is temporarily unavailable. Trying another provider...";
  }
  return "Provider failed. Trying another provider...";
}

function yieldedAnyTokensHint(_error: unknown): boolean {
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Singleton for the app
const globalForScheduler = globalThis as unknown as {
  __freellmScheduler?: LlmScheduler;
};

export function getScheduler(): LlmScheduler {
  if (!globalForScheduler.__freellmScheduler) {
    globalForScheduler.__freellmScheduler = new LlmScheduler();
  }
  return globalForScheduler.__freellmScheduler;
}

export function resetSchedulerForTests(): void {
  globalForScheduler.__freellmScheduler = new LlmScheduler();
}
