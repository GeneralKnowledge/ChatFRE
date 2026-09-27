import { NextResponse } from "next/server";
import { getChatDefaults, saveChatDefaults } from "@/server/chat/service";
import { SettingsUpdateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getChatDefaults();
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const parsed = SettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  await saveChatDefaults(parsed.data);
  const settings = await getChatDefaults();
  return NextResponse.json({ settings });
}
