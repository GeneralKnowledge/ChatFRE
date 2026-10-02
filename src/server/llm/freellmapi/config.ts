export type FreeLlmApiConfig = {
  baseUrl: string;
  apiKey: string;
  configured: boolean;
  dashboardUrl: string;
};

/**
 * FreeLLMAPI connection settings.
 * Point ChatFRE at a running FreeLLMAPI instance instead of routing providers itself.
 */
export function getFreeLlmApiConfig(): FreeLlmApiConfig {
  const rawBase =
    process.env.FREELLMAPI_BASE_URL?.trim() || "http://127.0.0.1:3001/v1";
  const baseUrl = rawBase.replace(/\/$/, "");
  const apiKey = process.env.FREELLMAPI_API_KEY?.trim() || "";

  const origin = baseUrl.replace(/\/v1$/, "");
  return {
    baseUrl,
    apiKey,
    configured: apiKey.length > 0,
    dashboardUrl: origin || "http://127.0.0.1:3001",
  };
}

/** Routing strategies FreeLLMAPI supports via the model field. */
export const ROUTING_STRATEGIES = [
  {
    id: "auto",
    name: "Auto (fallback chain)",
    description: "Follow your FreeLLMAPI fallback chain",
  },
  {
    id: "auto:smart",
    name: "Auto · Smart",
    description: "Favor highest-intelligence models",
  },
  {
    id: "auto:fast",
    name: "Auto · Fast",
    description: "Favor measured speed",
  },
  {
    id: "auto:reliable",
    name: "Auto · Reliable",
    description: "Favor recent success rate",
  },
  {
    id: "auto:balanced",
    name: "Auto · Balanced",
    description: "Blend reliability, speed, and intelligence",
  },
] as const;

export type RoutingStrategyId = (typeof ROUTING_STRATEGIES)[number]["id"];

export function resolveFreeLlmModel(opts: {
  provider?: string | null;
  model?: string | null;
}): string {
  const model = opts.model?.trim() || "auto";
  if (model !== "auto") return model;

  const provider = opts.provider?.trim() || "auto";
  if (provider === "auto" || provider === "freellmapi") return "auto";
  if (provider.startsWith("auto:")) return provider;
  // Legacy single-provider prefs from before migration → fall back to auto
  return "auto";
}
