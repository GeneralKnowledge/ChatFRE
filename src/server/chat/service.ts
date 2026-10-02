import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  ensureDatabase,
  getDb,
  getDefaultUserId,
} from "@/server/database/client";
import { conversations, messages } from "@/server/database/schema";
import {
  FreeLlmApiError,
  streamFreeLlmChat,
} from "@/server/llm/freellmapi/client";
import type { ChatMessage } from "@/server/llm/types";
import { createLogger } from "@/lib/logging/logger";
import { getSetting, setSetting } from "@/server/chat/settings";

const log = createLogger("chat");

export async function listConversations() {
  await ensureDatabase();
  const db = getDb();
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.archived, false))
    .orderBy(desc(conversations.updatedAt));
}

export async function getConversation(id: string) {
  await ensureDatabase();
  const db = getDb();
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMessages(conversationId: string) {
  await ensureDatabase();
  const db = getDb();
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

export async function createConversation(opts?: {
  title?: string;
  modelPreference?: string;
  providerPreference?: string;
  systemPrompt?: string;
}) {
  await ensureDatabase();
  const db = getDb();
  const userId = await getDefaultUserId();
  const now = Date.now();
  const defaults = await getChatDefaults();
  const id = nanoid();
  await db.insert(conversations).values({
    id,
    userId,
    title: opts?.title ?? "New Chat",
    createdAt: now,
    updatedAt: now,
    modelPreference: opts?.modelPreference ?? defaults.defaultModel,
    providerPreference: opts?.providerPreference ?? defaults.defaultProvider,
    systemPrompt: opts?.systemPrompt ?? null,
    archived: false,
  });
  return (await getConversation(id))!;
}

export async function renameConversation(id: string, title: string) {
  await ensureDatabase();
  const db = getDb();
  await db
    .update(conversations)
    .set({ title, updatedAt: Date.now() })
    .where(eq(conversations.id, id));
  return getConversation(id);
}

export async function deleteConversation(id: string) {
  await ensureDatabase();
  const db = getDb();
  await db.delete(messages).where(eq(messages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
}

export async function updateConversationPreferences(
  id: string,
  prefs: { modelPreference?: string; providerPreference?: string },
) {
  await ensureDatabase();
  const db = getDb();
  await db
    .update(conversations)
    .set({ ...prefs, updatedAt: Date.now() })
    .where(eq(conversations.id, id));
}

export type SendChatInput = {
  conversationId?: string;
  message: string;
  model?: string;
  provider?: string;
  regenerateMessageId?: string;
  editUserMessageId?: string;
  signal?: AbortSignal;
};

export type ChatStreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "user_message"; id: string; content: string }
  | { type: "assistant_start"; id: string }
  | { type: "status"; message: string }
  | { type: "token"; content: string }
  | {
      type: "done";
      messageId: string;
      provider: string;
      model: string;
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
      routedVia?: string;
    }
  | { type: "error"; message: string };

export async function* sendChatStream(
  input: SendChatInput,
): AsyncGenerator<ChatStreamEvent> {
  await ensureDatabase();
  const db = getDb();
  const requestId = nanoid();
  const started = Date.now();

  let conversation = input.conversationId
    ? await getConversation(input.conversationId)
    : null;

  if (!conversation) {
    conversation = await createConversation();
  }

  yield { type: "conversation", conversationId: conversation.id };

  const providerPref =
    input.provider ?? conversation.providerPreference ?? "auto";
  const modelPref = input.model ?? conversation.modelPreference ?? "auto";

  if (input.editUserMessageId) {
    const existing = await getMessages(conversation.id);
    const idx = existing.findIndex((m) => m.id === input.editUserMessageId);
    if (idx >= 0) {
      for (const m of existing.slice(idx)) {
        await db.delete(messages).where(eq(messages.id, m.id));
      }
    }
  }

  if (input.regenerateMessageId) {
    await db
      .delete(messages)
      .where(eq(messages.id, input.regenerateMessageId));
  }

  if (!input.regenerateMessageId) {
    const userMessageId = nanoid();
    await db.insert(messages).values({
      id: userMessageId,
      conversationId: conversation.id,
      role: "user",
      content: input.message,
      createdAt: Date.now(),
      status: "completed",
      provider: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      error: null,
      metadata: null,
    });
    yield {
      type: "user_message",
      id: userMessageId,
      content: input.message,
    };

    if (conversation.title === "New Chat") {
      const trimmed = input.message.trim();
      const title =
        trimmed.slice(0, 48) + (trimmed.length > 48 ? "…" : "");
      await renameConversation(conversation.id, title || "New Chat");
    }
  }

  const history = await getMessages(conversation.id);
  const chatMessages: ChatMessage[] = [];
  if (conversation.systemPrompt) {
    chatMessages.push({ role: "system", content: conversation.systemPrompt });
  }
  for (const m of history) {
    if (m.status === "failed" || m.status === "cancelled") continue;
    if (m.role === "tool") continue;
    chatMessages.push({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    });
  }

  const assistantId = nanoid();
  await db.insert(messages).values({
    id: assistantId,
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    status: "streaming",
    provider: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
    error: null,
    metadata: null,
  });
  yield { type: "assistant_start", id: assistantId };
  yield {
    type: "status",
    message: "Routing through FreeLLMAPI…",
  };

  let full = "";
  let provider = "freellmapi";
  let model = modelPref;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let routedVia: string | undefined;

  try {
    const streamIter = streamFreeLlmChat({
      messages: chatMessages,
      provider: providerPref,
      model: modelPref,
      signal: input.signal,
    });

    while (true) {
      const next = await streamIter.next();
      if (next.done) {
        const result = next.value;
        provider = result.provider;
        model = result.model;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
        routedVia = result.routedVia;
        if (!full && result.content) full = result.content;
        break;
      }
      const chunk = next.value;
      if (chunk.type === "token" && chunk.content) {
        full += chunk.content;
        yield { type: "token", content: chunk.content };
      } else if (chunk.type === "error") {
        throw new Error(chunk.error ?? "Stream error");
      }
    }

    const latencyMs = Date.now() - started;
    await db
      .update(messages)
      .set({
        content: full,
        status: "completed",
        provider,
        model,
        inputTokens: inputTokens ?? null,
        outputTokens: outputTokens ?? null,
        latencyMs,
        metadata: JSON.stringify({ requestId, routedVia }),
      })
      .where(eq(messages.id, assistantId));

    await db
      .update(conversations)
      .set({ updatedAt: Date.now() })
      .where(eq(conversations.id, conversation.id));

    log.info("chat_completed", {
      requestId,
      conversationId: conversation.id,
      provider,
      model,
      routedVia,
      startTime: started,
      endTime: Date.now(),
      latency: latencyMs,
      status: "ok",
      retryCount: 0,
    });

    yield {
      type: "done",
      messageId: assistantId,
      provider,
      model,
      latencyMs,
      inputTokens,
      outputTokens,
      routedVia,
    };
  } catch (error) {
    const aborted =
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError");

    let message =
      error instanceof Error
        ? error.message
        : "FreeLLMAPI could not handle this request.";

    if (error instanceof FreeLlmApiError && error.status === 503) {
      message =
        "FreeLLMAPI is not configured. Set FREELLMAPI_API_KEY and start FreeLLMAPI (see README).";
    } else if (
      error instanceof Error &&
      /ECONNREFUSED|fetch failed|Failed to fetch/i.test(error.message)
    ) {
      message =
        "Cannot reach FreeLLMAPI. Is it running on the configured FREELLMAPI_BASE_URL?";
    }

    await db
      .update(messages)
      .set({
        content: full,
        status: aborted ? "cancelled" : "failed",
        error: message,
        latencyMs: Date.now() - started,
      })
      .where(eq(messages.id, assistantId));

    log.error("chat_failed", {
      requestId,
      conversationId: conversation.id,
      provider,
      model,
      latency: Date.now() - started,
      status: "error",
      error: message,
    });

    yield { type: "error", message };
  }
}

export async function getChatDefaults() {
  const defaultProvider = (await getSetting("defaultProvider")) ?? "auto";
  const defaultModel = (await getSetting("defaultModel")) ?? "auto";
  const theme = (await getSetting("theme")) ?? "system";
  const freeOnly = (await getSetting("freeOnly")) !== "false";
  const autoProviderSelection =
    (await getSetting("autoProviderSelection")) !== "false";
  return {
    defaultProvider,
    defaultModel,
    theme,
    freeOnly,
    autoProviderSelection,
  };
}

export async function saveChatDefaults(values: {
  defaultProvider?: string;
  defaultModel?: string;
  theme?: string;
  freeOnly?: boolean;
  autoProviderSelection?: boolean;
}) {
  if (values.defaultProvider !== undefined) {
    await setSetting("defaultProvider", values.defaultProvider);
  }
  if (values.defaultModel !== undefined) {
    await setSetting("defaultModel", values.defaultModel);
  }
  if (values.theme !== undefined) {
    await setSetting("theme", values.theme);
  }
  if (values.freeOnly !== undefined) {
    await setSetting("freeOnly", values.freeOnly ? "true" : "false");
  }
  if (values.autoProviderSelection !== undefined) {
    await setSetting(
      "autoProviderSelection",
      values.autoProviderSelection ? "true" : "false",
    );
  }
}
