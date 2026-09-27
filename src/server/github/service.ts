import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  ensureDatabase,
  getDb,
  getDefaultUserId,
} from "@/server/database/client";
import { githubConnections, messages, conversations } from "@/server/database/schema";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("github");

type GitHubRepo = {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
};

export class GitHubService {
  constructor(private token: string) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "FreeLLM-Chat",
    };
  }

  async getAuthenticatedUser(): Promise<{ login: string }> {
    const res = await fetch("https://api.github.com/user", {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`GitHub auth failed: ${res.status}`);
    }
    return (await res.json()) as { login: string };
  }

  async listRepositories(): Promise<GitHubRepo[]> {
    const res = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=updated",
      { headers: this.headers() },
    );
    if (!res.ok) {
      throw new Error(`Failed to list repositories: ${res.status}`);
    }
    return (await res.json()) as GitHubRepo[];
  }

  async getRepository(fullName: string): Promise<GitHubRepo> {
    const res = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`Repository not found: ${fullName}`);
    }
    return (await res.json()) as GitHubRepo;
  }

  async getFile(
    fullName: string,
    path: string,
    ref?: string,
  ): Promise<{ sha: string; content: string } | null> {
    const url = new URL(
      `https://api.github.com/repos/${fullName}/contents/${path}`,
    );
    if (ref) url.searchParams.set("ref", ref);
    const res = await fetch(url, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`getFile failed: ${res.status}`);
    const data = (await res.json()) as {
      sha: string;
      content: string;
      encoding: string;
    };
    const content = Buffer.from(data.content, "base64").toString("utf8");
    return { sha: data.sha, content };
  }

  async createOrUpdateFile(params: {
    fullName: string;
    path: string;
    content: string;
    message: string;
    branch?: string;
  }): Promise<{ htmlUrl?: string }> {
    const existing = await this.getFile(
      params.fullName,
      params.path,
      params.branch,
    );
    const body: Record<string, unknown> = {
      message: params.message,
      content: Buffer.from(params.content, "utf8").toString("base64"),
    };
    if (params.branch) body.branch = params.branch;
    if (existing) body.sha = existing.sha;

    const res = await fetch(
      `https://api.github.com/repos/${params.fullName}/contents/${params.path}`,
      {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`createOrUpdateFile failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      content?: { html_url?: string };
    };
    return { htmlUrl: data.content?.html_url };
  }

  async createBranch(
    fullName: string,
    branch: string,
    fromBranch = "main",
  ): Promise<void> {
    const refRes = await fetch(
      `https://api.github.com/repos/${fullName}/git/ref/heads/${fromBranch}`,
      { headers: this.headers() },
    );
    if (!refRes.ok) throw new Error(`Base branch not found: ${fromBranch}`);
    const ref = (await refRes.json()) as { object: { sha: string } };
    const res = await fetch(
      `https://api.github.com/repos/${fullName}/git/refs`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: ref.object.sha,
        }),
      },
    );
    if (!res.ok && res.status !== 422) {
      throw new Error(`createBranch failed: ${res.status}`);
    }
  }
}

export function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN?.trim() || null;
}

export function createGitHubService(): GitHubService | null {
  const token = getGitHubToken();
  if (!token) return null;
  return new GitHubService(token);
}

export async function ensureGithubConnection() {
  await ensureDatabase();
  const db = getDb();
  const userId = await getDefaultUserId();
  const existing = await db
    .select()
    .from(githubConnections)
    .where(eq(githubConnections.userId, userId))
    .limit(1);

  const tokenConfigured = Boolean(getGitHubToken());
  let username: string | null = existing[0]?.username ?? null;

  if (tokenConfigured) {
    try {
      const svc = createGitHubService()!;
      const user = await svc.getAuthenticatedUser();
      username = user.login;
    } catch (error) {
      log.warn("github_user_lookup_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (existing[0]) {
    await db
      .update(githubConnections)
      .set({
        tokenConfigured,
        username,
        updatedAt: Date.now(),
      })
      .where(eq(githubConnections.id, existing[0].id));
    return { ...existing[0], tokenConfigured, username };
  }

  const id = nanoid();
  const now = Date.now();
  await db.insert(githubConnections).values({
    id,
    userId,
    tokenConfigured,
    username,
    defaultRepo: null,
    defaultPath: "chat-logs",
    createdAt: now,
    updatedAt: now,
  });
  return {
    id,
    userId,
    tokenConfigured,
    username,
    defaultRepo: null,
    defaultPath: "chat-logs",
    createdAt: now,
    updatedAt: now,
  };
}

export function formatConversationMarkdown(params: {
  title: string;
  date: string;
  provider?: string | null;
  model?: string | null;
  messages: Array<{ role: string; content: string; provider?: string | null; model?: string | null }>;
  metadata?: Record<string, unknown>;
}): string {
  const lines: string[] = [
    `# ${params.title}`,
    "",
    `- Date: ${params.date}`,
  ];
  if (params.provider) lines.push(`- Provider: ${params.provider}`);
  if (params.model) lines.push(`- Model: ${params.model}`);
  if (params.metadata) {
    lines.push(`- Metadata: \`${JSON.stringify(params.metadata)}\``);
  }
  lines.push("", "---", "");

  for (const m of params.messages) {
    const label =
      m.role === "user"
        ? "User"
        : m.role === "assistant"
          ? "Assistant"
          : m.role;
    lines.push(`### ${label}`);
    if (m.role === "assistant" && (m.provider || m.model)) {
      lines.push(`_${[m.provider, m.model].filter(Boolean).join(" / ")}_`, "");
    }
    lines.push(m.content, "");
  }

  return lines.join("\n");
}

export async function exportConversationToGitHub(params: {
  conversationId: string;
  repository: string;
  path?: string;
}): Promise<{ path: string; htmlUrl?: string }> {
  const svc = createGitHubService();
  if (!svc) {
    throw new Error("GitHub token not configured (set GITHUB_TOKEN)");
  }

  await ensureDatabase();
  const db = getDb();
  const convRows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) throw new Error("Conversation not found");

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.conversationId))
    .orderBy(messages.createdAt);

  const date = new Date(conversation.createdAt).toISOString().slice(0, 10);
  const slug = conversation.id.slice(0, 8);
  const basePath = (params.path ?? "chat-logs").replace(/\/$/, "");
  const filePath = `${basePath}/${date}-chat-${slug}.md`;

  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  const markdown = formatConversationMarkdown({
    title: conversation.title,
    date: new Date(conversation.createdAt).toISOString(),
    provider: lastAssistant?.provider,
    model: lastAssistant?.model,
    messages: msgs.map((m) => ({
      role: m.role,
      content: m.content,
      provider: m.provider,
      model: m.model,
    })),
    metadata: {
      conversationId: conversation.id,
      exportedAt: new Date().toISOString(),
    },
  });

  const result = await svc.createOrUpdateFile({
    fullName: params.repository,
    path: filePath,
    content: markdown,
    message: `chore: export chat "${conversation.title}"`,
  });

  log.info("github_export", {
    conversationId: params.conversationId,
    repository: params.repository,
    path: filePath,
  });

  return { path: filePath, htmlUrl: result.htmlUrl };
}
