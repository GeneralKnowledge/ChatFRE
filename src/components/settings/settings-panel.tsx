"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

type Settings = {
  defaultProvider: string;
  defaultModel: string;
  theme: string;
  freeOnly: boolean;
  autoProviderSelection: boolean;
};

type RoutingStrategy = { id: string; name: string; description?: string };

type BackendStatus = {
  ok: boolean;
  configured: boolean;
  baseUrl: string;
  dashboardUrl: string;
  latencyMs?: number;
  error?: string;
  modelCount?: number;
  readyCount?: number;
};

type ModelRow = {
  id: string;
  name: string;
  executionStatus?: string;
  ownedBy?: string;
};

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [backend, setBackend] = useState<BackendStatus | null>(null);
  const [strategies, setStrategies] = useState<RoutingStrategy[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const [s, p] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/providers").then((r) => r.json()),
    ]);
    setSettings(s.settings as Settings);
    setBackend((p.backend as BackendStatus) ?? null);
    setStrategies((p.routingStrategies as RoutingStrategy[]) ?? []);
    setModels((p.config?.[0]?.models as ModelRow[]) ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (patch: Partial<Settings>) => {
    if (!settings) return;
    setSaving(true);
    const next = { ...settings, ...patch };
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const data = (await res.json()) as { settings: Settings };
    setSettings(data.settings);
    setSaving(false);
    setMessage("Saved");
    setTimeout(() => setMessage(null), 1500);
  };

  if (!settings) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--ink-muted)]">
        Loading settings…
      </div>
    );
  }

  const ready = models.filter(
    (m) => !m.executionStatus || m.executionStatus === "ready",
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-10">
      <div className="mx-auto max-w-3xl animate-fade-up">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
        >
          <ArrowLeft size={14} />
          Back to chat
        </Link>

        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-[var(--ink-muted)]">
          ChatFRE is the UI and conversation store. FreeLLMAPI is the LLM
          backend.
        </p>
        {message && (
          <p className="mt-2 text-sm text-[var(--accent-strong)]">{message}</p>
        )}

        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold">FreeLLMAPI</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Provider keys, rate limits, and failover live in FreeLLMAPI. ChatFRE
            only needs the unified API key and base URL.
          </p>
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm">
            {backend ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--ink-muted)]">Status</dt>
                  <dd className="font-medium">
                    {!backend.configured
                      ? "Not configured"
                      : backend.ok
                        ? "Connected"
                        : "Unreachable"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-muted)]">Latency</dt>
                  <dd className="font-medium">
                    {backend.latencyMs != null ? `${backend.latencyMs} ms` : "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[var(--ink-muted)]">Base URL</dt>
                  <dd className="break-all font-mono text-xs">{backend.baseUrl}</dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-muted)]">Models ready</dt>
                  <dd className="font-medium">
                    {backend.readyCount ?? ready.length}
                    {backend.modelCount != null
                      ? ` / ${backend.modelCount}`
                      : ""}
                  </dd>
                </div>
                {backend.error && (
                  <div className="sm:col-span-2 text-red-700">{backend.error}</div>
                )}
              </dl>
            ) : (
              <p className="text-[var(--ink-muted)]">Checking connection…</p>
            )}
            {backend?.dashboardUrl && (
              <a
                href={backend.dashboardUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-[var(--accent-strong)] hover:underline"
              >
                Open FreeLLMAPI dashboard
                <ExternalLink size={14} />
              </a>
            )}
            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              Set <code className="font-mono">FREELLMAPI_BASE_URL</code> and{" "}
              <code className="font-mono">FREELLMAPI_API_KEY</code> in{" "}
              <code className="font-mono">.env.local</code>.
            </p>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold">General</h2>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--ink-muted)]">Theme</span>
              <select
                value={settings.theme}
                onChange={(e) => void save({ theme: e.target.value })}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--ink-muted)]">Default routing</span>
              <select
                value={settings.defaultProvider}
                onChange={(e) => void save({ defaultProvider: e.target.value })}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2"
              >
                {(strategies.length
                  ? strategies
                  : [{ id: "auto", name: "Auto (fallback chain)" }]
                ).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--ink-muted)]">Default model</span>
              <input
                value={settings.defaultModel}
                onChange={(e) =>
                  setSettings({ ...settings, defaultModel: e.target.value })
                }
                onBlur={() => void save({ defaultModel: settings.defaultModel })}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2"
                placeholder="auto"
                list="freellmapi-models"
              />
              <datalist id="freellmapi-models">
                <option value="auto" />
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
            </label>
            {saving && (
              <div className="text-xs text-[var(--ink-muted)]">Saving…</div>
            )}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Models</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Catalog from FreeLLMAPI. Manage keys and enablement in its
            dashboard.
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {models.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-4 text-[var(--ink-muted)]"
                    >
                      No models loaded. Connect FreeLLMAPI to see the catalog.
                    </td>
                  </tr>
                ) : (
                  models.slice(0, 80).map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{m.name}</div>
                        <div className="font-mono text-xs text-[var(--ink-muted)]">
                          {m.id}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-[var(--ink-muted)]">
                        {m.ownedBy ?? "—"}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {m.executionStatus ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {models.length > 80 && (
              <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--ink-muted)]">
                Showing 80 of {models.length} models.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
