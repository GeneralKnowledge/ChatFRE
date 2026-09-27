import { ChatApiRequestSchema } from "@/lib/validation/schemas";
import { sendChatStream } from "@/server/chat/service";
import { createLogger } from "@/lib/logging/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api.chat");

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ChatApiRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.message.length > 100_000) {
    return Response.json({ error: "Message too large" }, { status: 413 });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        for await (const event of sendChatStream({
          ...parsed.data,
          signal: abort.signal,
        })) {
          send(event.type, event);
        }
      } catch (error) {
        log.error("stream_error", {
          error: error instanceof Error ? error.message : String(error),
        });
        send("error", {
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "No available provider can currently handle this request.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
