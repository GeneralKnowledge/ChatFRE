import { NextResponse } from "next/server";
import { getScheduler } from "@/server/llm/scheduler";
import { getProviderConfigs, loadProvidersConfig } from "@/server/llm/providers/registry";
import { credentialStore } from "@/server/llm/providers/credentials";
import { ProviderToggleSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  loadProvidersConfig();
  const scheduler = getScheduler();
  const status = scheduler.getStatus();
  const config = getProviderConfigs({ includeDisabled: true }).map((p) => ({
    id: p.id,
    name: p.name,
    enabled: p.enabled,
    reason: p.reason,
    free: p.free,
    apiStyle: p.apiStyle,
    ukStatus: p.ukStatus,
    models: p.models,
    limits: p.limits,
    notes: p.notes,
    apiKeyConfigured: credentialStore.isConfigured(p),
    keyRequired: p.authentication.required,
  }));

  return NextResponse.json({ providers: status, config });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const parsed = ProviderToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  getScheduler().setEnabledOverride(
    parsed.data.providerId,
    parsed.data.enabled,
  );
  return NextResponse.json({ ok: true });
}
