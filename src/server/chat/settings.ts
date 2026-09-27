import { eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/server/database/client";
import { settings } from "@/server/database/schema";

export async function getSetting(key: string): Promise<string | null> {
  await ensureDatabase();
  const db = getDb();
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ensureDatabase();
  const db = getDb();
  const now = Date.now();
  const existing = await getSetting(key);
  if (existing === null) {
    await db.insert(settings).values({ key, value, updatedAt: now });
  } else {
    await db
      .update(settings)
      .set({ value, updatedAt: now })
      .where(eq(settings.key, key));
  }
}

export async function getAllSettings(): Promise<Record<string, string>> {
  await ensureDatabase();
  const db = getDb();
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
