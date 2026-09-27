import { NextResponse } from "next/server";
import {
  createGitHubService,
  ensureGithubConnection,
  exportConversationToGitHub,
} from "@/server/github/service";
import { GithubExportSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const connection = await ensureGithubConnection();
  const svc = createGitHubService();
  let repositories: Array<{
    fullName: string;
    private: boolean;
    defaultBranch: string;
  }> = [];

  if (svc) {
    try {
      const repos = await svc.listRepositories();
      repositories = repos.map((r) => ({
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
      }));
    } catch {
      repositories = [];
    }
  }

  return NextResponse.json({
    connection: {
      tokenConfigured: connection.tokenConfigured,
      username: connection.username,
      defaultRepo: connection.defaultRepo,
      defaultPath: connection.defaultPath ?? "chat-logs",
    },
    repositories,
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = GithubExportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const result = await exportConversationToGitHub(parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "GitHub export failed",
      },
      { status: 400 },
    );
  }
}
