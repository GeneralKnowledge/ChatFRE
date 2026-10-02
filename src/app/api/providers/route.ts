import { NextResponse } from "next/server";
import {
  getFreeLlmStatus,
  getRoutingStrategies,
  listFreeLlmModels,
} from "@/server/llm/freellmapi/client";
import { getFreeLlmApiConfig } from "@/server/llm/freellmapi/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Provider/model catalog for the UI.
 * Backed by FreeLLMAPI — ChatFRE no longer routes providers itself.
 */
export async function GET() {
  const config = getFreeLlmApiConfig();
  const status = await getFreeLlmStatus();
  const strategies = getRoutingStrategies();

  let models: Awaited<ReturnType<typeof listFreeLlmModels>> = [];
  let modelsError: string | undefined;
  if (config.configured) {
    try {
      models = await listFreeLlmModels({ readyOnly: false });
    } catch (error) {
      modelsError =
        error instanceof Error ? error.message : "Failed to list models";
    }
  }

  const readyModels = models.filter(
    (m) => !m.executionStatus || m.executionStatus === "ready",
  );

  // Present FreeLLMAPI as a single backend "provider" with routing strategies
  // as synthetic provider options for the chat picker.
  const providers = [
    {
      id: "freellmapi",
      name: "FreeLLMAPI",
      enabled: true,
      reason: null,
      free: true,
      apiKeyConfigured: config.configured,
      health: {
        healthy: status.ok,
        latencyMs: status.latencyMs,
        error: status.error,
        checkedAt: Date.now(),
      },
      budget: {
        requestsToday: 0,
        requestsThisMonth: 0,
        tokensToday: 0,
        rpd: null,
        rpm: null,
        monthly: null,
      },
      queueDepth: 0,
      activeRequests: 0,
      consecutiveFailures: 0,
      available: status.ok,
      score: status.ok ? 100 : null,
      models: readyModels.map((m) => ({
        id: m.id,
        name: m.name,
        capabilities: ["chat"],
      })),
      blockedUntil: null,
      baseUrl: config.baseUrl,
      dashboardUrl: config.dashboardUrl,
      modelCount: status.modelCount ?? models.length,
      readyCount: status.readyCount ?? readyModels.length,
    },
  ];

  const catalog = [
    {
      id: "freellmapi",
      name: "FreeLLMAPI",
      enabled: true,
      reason: null,
      free: true,
      apiStyle: "openai_chat",
      ukStatus: "unknown",
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        capabilities: ["chat"] as string[],
        executionStatus: m.executionStatus,
        ownedBy: m.ownedBy,
        contextWindow: m.contextWindow,
      })),
      limits: {},
      notes:
        "OpenAI-compatible gateway. Manage provider keys and fallback chain in the FreeLLMAPI dashboard.",
      apiKeyConfigured: config.configured,
      keyRequired: true,
      baseUrl: config.baseUrl,
      dashboardUrl: config.dashboardUrl,
    },
  ];

  return NextResponse.json({
    providers,
    config: catalog,
    routingStrategies: strategies,
    backend: {
      type: "freellmapi",
      ...status,
    },
    modelsError,
  });
}

export async function PATCH() {
  return NextResponse.json(
    {
      error:
        "Provider toggles are managed in the FreeLLMAPI dashboard, not in ChatFRE.",
    },
    { status: 400 },
  );
}
