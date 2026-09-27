"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatPanel } from "@/components/chat/chat-panel";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { Menu } from "lucide-react";

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: number;
  providerPreference: string;
  modelPreference: string;
};

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status?: string;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string | null;
};

type AppShellProps = {
  view?: "chat" | "settings";
};

export function AppShell({ view = "chat" }: AppShellProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [provider, setProvider] = useState("auto");
  const [model, setModel] = useState("auto");
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    const data = (await res.json()) as { conversations: ConversationSummary[] };
    setConversations(data.conversations);
    setLoadingList(false);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations?id=${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      conversation: ConversationSummary & {
        providerPreference: string;
        modelPreference: string;
      };
      messages: UiMessage[];
    };
    setActiveId(id);
    setMessages(
      data.messages.map((m) => ({
        ...m,
        role: m.role as UiMessage["role"],
      })),
    );
    setProvider(data.conversation.providerPreference || "auto");
    setModel(data.conversation.modelPreference || "auto");
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const handleNewChat = async () => {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as { conversation: ConversationSummary };
    await refreshConversations();
    setActiveId(data.conversation.id);
    setMessages([]);
    setProvider("auto");
    setModel("auto");
    setSidebarOpen(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/conversations?id=${id}`, { method: "DELETE" });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    await refreshConversations();
  };

  const handleRename = async (id: string, title: string) => {
    await fetch("/api/conversations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    });
    await refreshConversations();
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  };

  const sendMessage = async (opts: {
    message: string;
    regenerateMessageId?: string;
    editUserMessageId?: string;
  }) => {
    if (streaming) return;
    setStreaming(true);
    setStatusLine(null);
    const controller = new AbortController();
    abortRef.current = controller;

    let conversationId = activeId;
    let assistantId: string | null = null;

    if (opts.editUserMessageId) {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === opts.editUserMessageId);
        if (idx < 0) return prev;
        return [
          ...prev.slice(0, idx),
          {
            id: opts.editUserMessageId!,
            role: "user",
            content: opts.message,
            status: "completed",
          },
        ];
      });
    } else if (!opts.regenerateMessageId) {
      const tempUserId = `temp-user-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: tempUserId,
          role: "user",
          content: opts.message,
          status: "completed",
        },
      ]);
    } else {
      setMessages((prev) =>
        prev.filter((m) => m.id !== opts.regenerateMessageId),
      );
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: opts.message,
          provider,
          model,
          regenerateMessageId: opts.regenerateMessageId,
          editUserMessageId: opts.editUserMessageId,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Failed to start chat");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let event = "message";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          const data = JSON.parse(dataLine) as Record<string, unknown>;

          if (event === "conversation") {
            conversationId = data.conversationId as string;
            setActiveId(conversationId);
          } else if (event === "user_message") {
            setMessages((prev) => {
              const withoutTemp = prev.filter(
                (m) => !m.id.startsWith("temp-user-"),
              );
              const exists = withoutTemp.some((m) => m.id === data.id);
              if (exists) return withoutTemp;
              return [
                ...withoutTemp,
                {
                  id: data.id as string,
                  role: "user",
                  content: data.content as string,
                  status: "completed",
                },
              ];
            });
          } else if (event === "assistant_start") {
            assistantId = data.id as string;
            setMessages((prev) => [
              ...prev,
              {
                id: assistantId!,
                role: "assistant",
                content: "",
                status: "streaming",
              },
            ]);
          } else if (event === "status") {
            setStatusLine(data.message as string);
          } else if (event === "token") {
            const token = data.content as string;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + token, status: "streaming" }
                  : m,
              ),
            );
          } else if (event === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === (data.messageId as string) || m.id === assistantId
                  ? {
                      ...m,
                      status: "completed",
                      provider: data.provider as string,
                      model: data.model as string,
                      latencyMs: data.latencyMs as number,
                      inputTokens: data.inputTokens as number | undefined,
                      outputTokens: data.outputTokens as number | undefined,
                    }
                  : m,
              ),
            );
            setStatusLine(null);
            await refreshConversations();
          } else if (event === "error") {
            setStatusLine(data.message as string);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      status: "failed",
                      error: data.message as string,
                    }
                  : m,
              ),
            );
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setStatusLine(
          error instanceof Error
            ? error.message
            : "Something went wrong sending your message.",
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        loading={loadingList}
        onSelect={(id) => void loadConversation(id)}
        onNew={() => void handleNewChat()}
        onDelete={(id) => void handleDelete(id)}
        onRename={(id, title) => void handleRename(id, title)}
        view={view}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_88%,transparent)] px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            aria-label="Open sidebar"
            className="rounded-md p-2 hover:bg-black/5"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="font-display text-lg font-semibold tracking-tight">
            FreeLLM
          </div>
        </header>

        {view === "settings" ? (
          <SettingsPanel />
        ) : (
          <ChatPanel
            conversation={activeConversation}
            messages={messages}
            provider={provider}
            model={model}
            onProviderChange={setProvider}
            onModelChange={setModel}
            streaming={streaming}
            statusLine={statusLine}
            onSend={(message) => void sendMessage({ message })}
            onStop={stopGeneration}
            onRegenerate={(assistantId, userContent) =>
              void sendMessage({
                message: userContent,
                regenerateMessageId: assistantId,
              })
            }
            onEditUser={(userId, content) =>
              void sendMessage({
                message: content,
                editUserMessageId: userId,
              })
            }
            onNewChat={() => void handleNewChat()}
          />
        )}
      </div>
    </div>
  );
}
