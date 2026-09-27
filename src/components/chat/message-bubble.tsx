"use client";

import { useState, type CSSProperties } from "react";
import {
  Check,
  Copy,
  Pencil,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { UiMessage } from "@/components/chat/app-shell";
import { Markdown } from "@/components/chat/markdown";
import { formatLatency, cn } from "@/lib/utils/cn";

type MessageBubbleProps = {
  message: UiMessage;
  streaming?: boolean;
  onRegenerate?: () => void;
  onEdit?: (content: string) => void;
  onRetry?: () => void;
  className?: string;
  style?: CSSProperties;
};

export function MessageBubble({
  message,
  streaming,
  onRegenerate,
  onEdit,
  onRetry,
  className,
  style,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isUser = message.role === "user";

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn("group flex", isUser ? "justify-end" : "justify-start", className)}
      style={style}
    >
      <div
        className={cn(
          "max-w-[min(100%,42rem)]",
          isUser
            ? "rounded-2xl bg-[var(--user-bubble)] px-4 py-3"
            : "w-full px-1 py-1",
        )}
      >
        <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
          {isUser ? "You" : "Assistant"}
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[100px] w-full rounded-lg border border-[var(--border)] bg-white p-3 text-sm outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                onClick={() => {
                  setEditing(false);
                  onEdit?.(draft);
                }}
              >
                Save & resubmit
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm hover:bg-black/5"
                onClick={() => {
                  setEditing(false);
                  setDraft(message.content);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "prose-chat",
              streaming && !message.content && "animate-pulse-soft",
              streaming && "typing-cursor",
            )}
          >
            {message.content ? (
              isUser ? (
                <div className="whitespace-pre-wrap text-[0.98rem] leading-relaxed">
                  {message.content}
                </div>
              ) : (
                <Markdown content={message.content} />
              )
            ) : streaming ? (
              <span className="text-[var(--ink-muted)]">Thinking…</span>
            ) : (
              <span className="text-[var(--ink-muted)]">No content</span>
            )}
          </div>
        )}

        {message.error && (
          <div className="mt-2 text-sm text-[var(--danger)]">{message.error}</div>
        )}

        {!editing && (
          <div className="mt-2 flex flex-wrap items-center gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-black/5"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            {isUser && onEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-black/5"
              >
                <Pencil size={12} />
                Edit
              </button>
            )}
            {!isUser && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-black/5"
              >
                <RefreshCw size={12} />
                Regenerate
              </button>
            )}
            {!isUser && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-black/5"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            )}
            {!isUser && (message.provider || message.model || message.latencyMs) && (
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-black/5"
              >
                {detailsOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                Details
              </button>
            )}
          </div>
        )}

        {detailsOpen && (
          <div className="mt-2 rounded-lg border border-[var(--border)] bg-white/70 px-3 py-2 text-xs text-[var(--ink-muted)]">
            <div>Provider: {message.provider ?? "—"}</div>
            <div>Model: {message.model ?? "—"}</div>
            <div>Latency: {formatLatency(message.latencyMs)}</div>
            {(message.inputTokens != null || message.outputTokens != null) && (
              <div>
                Tokens: {message.inputTokens ?? "—"} in /{" "}
                {message.outputTokens ?? "—"} out
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
