import { NextResponse } from "next/server";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getMessages,
  listConversations,
  renameConversation,
} from "@/server/chat/service";
import {
  CreateConversationSchema,
  RenameConversationSchema,
} from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const conversation = await getConversation(id);
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const msgs = await getMessages(id);
    return NextResponse.json({ conversation, messages: msgs });
  }
  const conversations = await listConversations();
  return NextResponse.json({ conversations });
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CreateConversationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const conversation = await createConversation(parsed.data);
  return NextResponse.json({ conversation });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const id = body.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const parsed = RenameConversationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const conversation = await renameConversation(id, parsed.data.title);
  return NextResponse.json({ conversation });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await deleteConversation(id);
  return NextResponse.json({ ok: true });
}
