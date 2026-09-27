import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  formatConversationMarkdown,
  GitHubService,
} from "@/server/github/service";

describe("formatConversationMarkdown", () => {
  it("includes title, date, provider/model, and messages", () => {
    const md = formatConversationMarkdown({
      title: "Hello",
      date: "2026-09-27T00:00:00.000Z",
      provider: "groq",
      model: "openai/gpt-oss-20b",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!", provider: "groq", model: "x" },
      ],
    });
    expect(md).toContain("# Hello");
    expect(md).toContain("Provider: groq");
    expect(md).toContain("### User");
    expect(md).toContain("Hi");
    expect(md).toContain("### Assistant");
  });
});

describe("GitHubService", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lists repositories via GitHub API", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        ok: true,
        json: async () => [
          {
            id: 1,
            full_name: "me/repo",
            private: false,
            default_branch: "main",
            html_url: "https://github.com/me/repo",
          },
        ],
      },
    );

    const svc = new GitHubService("fake-token");
    const repos = await svc.listRepositories();
    expect(repos[0]?.full_name).toBe("me/repo");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.github.com/user/repos"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fake-token",
        }),
      }),
    );
  });

  it("creates files with base64 content", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404 }) // getFile
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: { html_url: "https://github.com/x" } }),
      });

    const svc = new GitHubService("fake-token");
    const result = await svc.createOrUpdateFile({
      fullName: "me/repo",
      path: "chat-logs/a.md",
      content: "# hi",
      message: "export",
    });
    expect(result.htmlUrl).toContain("github.com");
    const putCall = fetchMock.mock.calls[1]!;
    const body = JSON.parse(putCall[1].body as string) as {
      content: string;
      message: string;
    };
    expect(body.message).toBe("export");
    expect(Buffer.from(body.content, "base64").toString("utf8")).toBe("# hi");
  });
});
