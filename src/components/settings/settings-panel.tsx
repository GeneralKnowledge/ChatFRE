"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type Settings = {
  defaultProvider: string;
  defaultModel: string;
  theme: string;
  freeOnly: boolean;
  autoProviderSelection: boolean;
};

type ProviderStatus = {
  id: string;
  name: string;
  enabled: boolean;
  reason: string | null;
  apiKeyConfigured: boolean;
  health: { healthy: boolean } | null;
  budget: {
    requestsToday: number;
    requestsThisMonth: number;
    rpd: number | null;
    rpm: number | null;
    monthly: number | null;
  };
  queueDepth: number;
  available: boolean;
  models: { id: string; name: string }[];
  blockedUntil: number | null;
};

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const [s, p] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/providers").then((r) => r.json()),
    ]);
    setSettings(s.settings as Settings);
    setProviders(p.providers as ProviderStatus[]);
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

  const toggleProvider = async (providerId: string, enabled: boolean) => {
    await fetch("/api/providers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, enabled }),
    });
    await load();
  };

  if (!settings) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--ink-muted)]">
        Loading settings…
      </div>
    );
  }

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
          Single-user preferences and free provider status.
        </p>
        {message && (
          <p className="mt-2 text-sm text-[var(--accent-strong)]">{message}</p>
        )}

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
              <span className="text-[var(--ink-muted)]">Default provider</span>
              <select
                value={settings.defaultProvider}
                onChange={(e) => void save({ defaultProvider: e.target.value })}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2"
              >
                <option value="auto">Auto</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
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
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.autoProviderSelection}
                onChange={(e) =>
                  void save({ autoProviderSelection: e.target.checked })
                }
              />
              Auto provider selection
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.freeOnly}
                onChange={(e) => void save({ freeOnly: e.target.checked })}
              />
              Free services only
            </label>
            {saving && (
              <div className="text-xs text-[var(--ink-muted)]">Saving…</div>
            )}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Providers</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            API keys stay server-side via environment variables. Keys are never
            shown here.
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Enabled</th>
                  <th className="px-3 py-2 font-medium">Key</th>
                  <th className="px-3 py-2 font-medium">Health</th>
                  <th className="px-3 py-2 font-medium">Budget</th>
                  <th className="px-3 py-2 font-medium">Queue</th>
                  <th className="px-3 py-2 font-medium">Models</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium">{p.name}</div>
                      {p.reason && (
                        <div className="mt-1 max-w-[220px] text-xs text-[var(--ink-muted)]">
                          {p.reason}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) =>
                          void toggleProvider(p.id, e.target.checked)
                        }
                      />
                    </td>
                    <td className="px-3 py-3 align-top">
                      {p.apiKeyConfigured ? (
                        <span className="text-[var(--accent-strong)]">Yes</span>
                      ) : (
                        <span className="text-[var(--ink-muted)]">No</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {p.blockedUntil && p.blockedUntil > Date.now()
                        ? "Blocked"
                        : p.available
                          ? "Ready"
                          : p.health?.healthy === false
                            ? "Unhealthy"
                            : "Unavailable"}
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-[var(--ink-muted)]">
                      <div>
                        Today: {p.budget.requestsToday}
                        {p.budget.rpd != null ? ` / ${p.budget.rpd}` : ""}
                      </div>
                      <div>
                        Month: {p.budget.requestsThisMonth}
                        {p.budget.monthly != null
                          ? ` / ${p.budget.monthly}`
                          : ""}
                      </div>
                      {p.budget.rpm != null && <div>RPM: {p.budget.rpm}</div>}
                    </td>
                    <td className="px-3 py-3 align-top">{p.queueDepth}</td>
                    <td className="px-3 py-3 align-top text-xs text-[var(--ink-muted)]">
                      {p.models.slice(0, 3).map((m) => (
                        <div key={m.id}>{m.name}</div>
                      ))}
                      {p.models.length > 3 && (
                        <div>+{p.models.length - 3} more</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
