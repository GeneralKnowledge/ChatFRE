import { z } from "zod";

export const LimitValueSchema = z.object({
  value: z.number().optional(),
  official: z.boolean().optional(),
  safetyMultiplier: z.number().optional(),
  unit: z.string().optional(),
  notes: z.string().optional(),
});

export const ModelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number().optional(),
  maxOutput: z.number().optional(),
  capabilities: z.array(z.string()).default([]),
  preferred: z.boolean().optional(),
});

export const ProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  reason: z.string().nullable(),
  ukStatus: z.enum(["available", "restricted", "unknown"]).default("unknown"),
  free: z.boolean().default(true),
  baseUrl: z.string(),
  apiStyle: z.enum([
    "openai_chat",
    "gemini_native_or_openai_compat",
    "cloudflare_native",
  ]),
  authentication: z.object({
    type: z.string(),
    envVar: z.string(),
    required: z.boolean(),
    extraEnvVars: z.array(z.string()).optional(),
  }),
  routes: z.object({
    chat: z.string(),
    models: z.string(),
    health: z.string(),
    run: z.string().optional(),
    generateContent: z.string().optional(),
  }),
  models: z.array(ModelConfigSchema),
  limits: z.record(z.string(), z.union([LimitValueSchema, z.string()])),
  scheduler: z.object({
    priority: z.number(),
    supportsStreaming: z.boolean(),
    reserveDailyFraction: z.number().default(0.05),
  }),
  notes: z.string().optional(),
  sources: z.array(z.string()).optional(),
});

export const ProvidersFileSchema = z.object({
  version: z.string(),
  freeOnlyDefault: z.boolean(),
  globalConcurrency: z.number(),
  sources: z.array(z.string()).optional(),
  providers: z.array(ProviderConfigSchema),
});

export type LimitValue = z.infer<typeof LimitValueSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;

export type MessageRole = "system" | "user" | "assistant" | "tool";
export type MessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export type ChatMessage = {
  role: MessageRole;
  content: string;
  name?: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  model: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
};

export type ChatChunk = {
  type: "token" | "done" | "error" | "meta";
  content?: string;
  error?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  finishReason?: string;
};

export type ChatResult = {
  content: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  finishReason?: string;
  rateLimitHeaders?: ObservedRateLimitHeaders;
};

export type ObservedRateLimitHeaders = {
  remaining?: number;
  limit?: number;
  reset?: number;
  retryAfter?: number;
  raw: Record<string, string>;
};

export type HealthStatus = {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: number;
};

export type QueuePriority = "interactive" | "normal" | "background";
export type QueueEntryStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type QueueEntry = {
  id: string;
  createdAt: number;
  priority: QueuePriority;
  request: ChatRequest;
  deadline?: number;
  candidateProviders: string[];
  status: QueueEntryStatus;
  conversationId?: string;
  resolve?: (value: unknown) => void;
  reject?: (reason?: unknown) => void;
};

export type ProviderRuntimeState = {
  providerId: string;
  requestsThisMinute: number;
  requestsThisHour: number;
  requestsToday: number;
  requestsThisMonth: number;
  tokensThisMinute: number;
  tokensToday: number;
  tokensThisMonth: number;
  queueDepth: number;
  activeRequests: number;
  consecutiveFailures: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  blockedUntil: number | null;
  observedRateLimits: ObservedRateLimitHeaders | null;
  lastRateLimitHeaders: ObservedRateLimitHeaders | null;
  health: HealthStatus | null;
  enabledOverride: boolean | null;
  minuteWindowStart: number;
  hourWindowStart: number;
  dayWindowStart: number;
  monthWindowStart: number;
};

export type SelectionContext = {
  now: number;
  freeOnly: boolean;
  preferredProvider?: string | null;
  preferredModel?: string | null;
  excludeProviders?: string[];
  estimatedTokens?: number;
  ukEligible?: boolean;
};

export type ProviderScore = {
  providerId: string;
  modelId: string;
  score: number;
  reasons: string[];
  available: boolean;
  waitMs: number;
  longWindowBinding: {
    daily: boolean;
    monthly: boolean;
    hourly: boolean;
  };
};

export type AdapterCredentials = {
  apiKey?: string;
  accountId?: string;
  extra?: Record<string, string>;
};
