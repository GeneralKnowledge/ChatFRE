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

export type ObservedRateLimitHeaders = {
  remaining?: number;
  limit?: number;
  reset?: number;
  retryAfter?: number;
  raw: Record<string, string>;
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
  /** FreeLLMAPI X-Routed-Via header, e.g. "groq/llama-3.3-70b" */
  routedVia?: string;
};

export type HealthStatus = {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: number;
};

export type ModelConfig = {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutput?: number;
  capabilities?: string[];
  preferred?: boolean;
};
