"use client";

import Link from "next/link";
import { useState } from "react";
import {
  MessageSquarePlus,
  Settings,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import type { ConversationSummary } from "@/components/chat/app-shell";
import { cn } from "@/lib/utils/cn";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  view: "chat" | "settings";
};

export function Sidebar({
  open,
  onClose,
  conversations,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
  onRename,
  view,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const content = (
    <div className="flex h-full flex-col bg-[var(--bg-sidebar)] text-[#e8efe9]">
      <div className="flex items-center justify-between px-4 pb-2 pt-5">
        <Link href="/" className="group">
          <div className="font-display text-2xl font-semibold tracking-tight text-[#f4f7f4]">
            FreeLLM
          </div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#8aa396]">
            Free provider chat
          </div>
        </Link>
        <button
          type="button"
          className="rounded-md p-1.5 text-[#8aa396] hover:bg-[var(--bg-sidebar-hover)] md:hidden"
          onClick={onClose}
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>
      </div>

      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)]"
        >
          <MessageSquarePlus size={16} />
          New Chat
        </button>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="px-3 py-2 text-sm text-[#8aa396]">Loading…</div>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-2 text-sm text-[#8aa396]">
            No conversations yet
          </div>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id} className="group relative">
                {editingId === c.id ? (
                  <form
                    className="px-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      onRename(c.id, editTitle.trim() || c.title);
                      setEditingId(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => setEditingId(null)}
                      className="w-full rounded-md border border-[#3d4b44] bg-[#121815] px-2 py-1.5 text-sm outline-none"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      "flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm transition",
                      activeId === c.id && view === "chat"
                        ? "bg-[var(--bg-sidebar-hover)] text-white"
                        : "text-[#c5d2cb] hover:bg-[var(--bg-sidebar-hover)]",
                    )}
                  >
                    <span className="truncate pr-12">{c.title}</span>
                  </button>
                )}
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    className="rounded p-1 text-[#8aa396] hover:bg-black/30 hover:text-white"
                    aria-label="Rename"
                    onClick={() => {
                      setEditingId(c.id);
                      setEditTitle(c.title);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-[#8aa396] hover:bg-black/30 hover:text-[#ffb4a8]"
                    aria-label="Delete"
                    onClick={() => onDelete(c.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[#2c3832] p-3">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition",
            view === "settings"
              ? "bg-[var(--bg-sidebar-hover)] text-white"
              : "text-[#c5d2cb] hover:bg-[var(--bg-sidebar-hover)]",
          )}
        >
          <Settings size={16} />
          Settings
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-[280px] shrink-0 md:block">{content}</aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close overlay"
            onClick={onClose}
          />
          <div className="absolute inset-y-0 left-0 w-[280px] shadow-xl animate-fade-up">
            {content}
          </div>
        </div>
      )}
    </>
  );
}
