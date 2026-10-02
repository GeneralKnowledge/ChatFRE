"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, FolderGit } from "lucide-react";
import type { ConversationSummary, UiMessage } from "@/components/chat/app-shell";
import { MessageBubble } from "@/components/chat/message-bubble";
import { cn } from "@/lib/utils/cn";

type ChatPanelProps = {
  conversation: ConversationSummary | null;
  messages: UiMessage[];
  provider: string;
  model: string;
  onProviderChange: (v: string) => void;
  onModelChange: (v: string) => void;
  streaming: boolean;
  statusLine: string | null;
  onSend: (message: string) => void;
  onStop: () => void;
  onRegenerate: (assistantId: string, userContent: string) => void;
  onEditUser: (userId: string, content: string) => void;
  onNewChat: () => void;
};

type RoutingStrategy = { id: string; name: string; description?: string };
type ModelOption = {
  id: string;
  name: string;
  executionStatus?: string;
};

export function ChatPanel({
  conversation,
  messages,
  provider,
  model,
  onProviderChange,
  onModelChange,
  streaming,
  statusLine,
  onSend,
  onStop,
  onRegenerate,
  onEditUser,
  onNewChat,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [strategies, setStrategies] = useState<RoutingStrategy[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [repos, setRepos] = useState<string[]>([]);
  const [exportRepo, setExportRepo] = useState("");
  const [exportPath, setExportPath] = useState("chat-logs");
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void fetch("/api/providers")
      .then((r) => r.json())
      .then(
        (data: {
          routingStrategies?: RoutingStrategy[];
          config?: Array<{
            models: ModelOption[];
          }>;
          backend?: { ok?: boolean };
        }) => {
          setStrategies(data.routingStrategies ?? []);
          const catalog = data.config?.[0]?.models ?? [];
          setModels(
            catalog.filter(
              (m) => !m.executionStatus || m.executionStatus === "ready",
            ),
          );
          setBackendOk(data.backend?.ok ?? null);
        },
      )
      .catch(() => setBackendOk(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, statusLine]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const lastUserContent = [...messages]
    .reverse()
    .find((m) => m.role === "user")?.content;

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    onSend(text);
  };

  const openExport = async () => {
    if (!conversation) return;
    setExportOpen(true);
    setExportStatus(null);
    const res = await fetch("/api/github");
    const data = (await res.json()) as {
      connection: { tokenConfigured: boolean; defaultPath?: string };
      repositories: { fullName: string }[];
    };
    if (!data.connection.tokenConfigured) {
      setExportStatus("Set GITHUB_TOKEN on the server to enable export.");
      setRepos([]);
      return;
    }
    setRepos(data.repositories.map((r) => r.fullName));
    setExportPath(data.connection.defaultPath ?? "chat-logs");
    if (data.repositories[0]) setExportRepo(data.repositories[0].fullName);
  };

  const doExport = async () => {
    if (!conversation || !exportRepo) return;
    setExportStatus("Exporting…");
    const res = await fetch("/api/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: conversation.id,
        repository: exportRepo,
        path: exportPath,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      path?: string;
      htmlUrl?: string;
      error?: string;
    };
    if (!res.ok) {
      setExportStatus(data.error ?? "Export failed");
      return;
    }
    setExportStatus(
      data.htmlUrl
        ? `Exported to ${data.path}`
        : `Exported to ${data.path}`,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hidden items-center justify-between border-b border-[var(--border)] px-6 py-4 md:flex">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">
            {conversation?.title ?? "FreeLLM Chat"}
          </h1>
          <p className="text-sm text-[var(--ink-muted)]">
            Powered by FreeLLMAPI · local conversation history
          </p>
        </div>
        <div className="flex items-center gap-2">
          {conversation && (
            <button
              type="button"
              onClick={() => void openExport()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm hover:bg-white"
            >
              <FolderGit size={14} />
              Export
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        {messages.length === 0 ? (
          <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 pt-10 animate-fade-up md:pt-16">
            <div>
              <div className="font-display text-4xl font-semibold tracking-tight text-[var(--ink)] md:text-5xl">
                FreeLLM
              </div>
              <p className="mt-3 max-w-md text-base text-[var(--ink-muted)]">
                A personal ChatGPT-like client on top of FreeLLMAPI — free-tier
                routing, failover, and quota tracking stay in the gateway.
              </p>
              {backendOk === false && (
                <p className="mt-3 text-sm text-red-700">
                  FreeLLMAPI is unreachable. Start it and set FREELLMAPI_API_KEY
                  (see Settings).
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                "Explain quantum computing simply",
                "Help me draft a README",
                "What free models work well for coding?",
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onSend(prompt)}
                  className="rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-left text-sm text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                streaming={streaming && m.status === "streaming"}
                onRegenerate={
                  m.role === "assistant" && lastUserContent
                    ? () => onRegenerate(m.id, lastUserContent)
                    : undefined
                }
                onEdit={
                  m.role === "user"
                    ? (content) => onEditUser(m.id, content)
                    : undefined
                }
                onRetry={
                  m.role === "assistant" &&
                  m.status === "failed" &&
                  lastUserContent
                    ? () => onRegenerate(m.id, lastUserContent)
                    : undefined
                }
                className="animate-fade-up"
                style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}
              />
            ))}
            {statusLine && (
              <div className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--accent-strong)] animate-fade-up">
                {statusLine}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_80%,white)] px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={provider}
              onChange={(e) => {
                onProviderChange(e.target.value);
                if (e.target.value !== "auto" && !e.target.value.startsWith("auto:")) {
                  // leave model as-is
                } else {
                  onModelChange("auto");
                }
              }}
              className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs"
              title="FreeLLMAPI routing strategy (used when model is Auto)"
            >
              {(strategies.length
                ? strategies
                : [{ id: "auto", name: "Auto (fallback chain)" }]
              ).map((s) => (
                <option key={s.id} value={s.id}>
                  Route: {s.name}
                </option>
              ))}
            </select>
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="max-w-[280px] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs"
            >
              <option value="auto">Model: Auto</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {!conversation && (
              <button
                type="button"
                onClick={onNewChat}
                className="text-xs text-[var(--ink-muted)] underline-offset-2 hover:underline"
              >
                Start fresh
              </button>
            )}
          </div>

          <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-2 shadow-[var(--shadow)]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={1}
              placeholder="Message FreeLLM…"
              className="max-h-[180px] min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                className="mb-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ink)] text-white"
                aria-label="Stop generation"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim()}
                className={cn(
                  "mb-0.5 flex h-10 w-10 items-center justify-center rounded-xl text-white transition",
                  input.trim()
                    ? "bg-[var(--accent)] hover:bg-[var(--accent-strong)]"
                    : "cursor-not-allowed bg-[#b7c4bd]",
                )}
                aria-label="Send message"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow)] animate-fade-up">
            <h2 className="font-display text-xl font-semibold">
              Export to GitHub
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Creates a Markdown conversation log in your repository.
            </p>
            <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              Repository
            </label>
            <select
              value={exportRepo}
              onChange={(e) => setExportRepo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
            >
              {repos.length === 0 && <option value="">No repos</option>}
              {repos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              Path prefix
            </label>
            <input
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
            />
            {exportStatus && (
              <p className="mt-3 text-sm text-[var(--accent-strong)]">
                {exportStatus}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm hover:bg-black/5"
                onClick={() => setExportOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white hover:bg-[var(--accent-strong)]"
                onClick={() => void doExport()}
                disabled={!exportRepo}
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
