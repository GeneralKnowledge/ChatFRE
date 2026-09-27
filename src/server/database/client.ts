import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import * as schema from "./schema";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "freellm.db");

let client: Client | null = null;
let db: LibSQLDatabase<typeof schema> | null = null;
let initialized = false;

function getDbPath(): string {
  return process.env.FREELLM_DB_PATH ?? DEFAULT_DB_PATH;
}

export function getClient(): Client {
  if (!client) {
    const dbPath = getDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    client = createClient({ url: `file:${dbPath}` });
  }
  return client;
}

export function getDb(): LibSQLDatabase<typeof schema> {
  if (!db) {
    db = drizzle(getClient(), { schema });
  }
  return db;
}

export async function ensureDatabase(): Promise<LibSQLDatabase<typeof schema>> {
  const database = getDb();
  if (initialized) return database;

  const c = getClient();
  await c.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Local User',
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        model_preference TEXT NOT NULL DEFAULT 'auto',
        provider_preference TEXT NOT NULL DEFAULT 'auto',
        system_prompt TEXT,
        archived INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        provider TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        latency_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'completed',
        error TEXT,
        metadata TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS provider_runtime_state (
        provider_id TEXT PRIMARY KEY,
        requests_this_minute INTEGER NOT NULL DEFAULT 0,
        requests_this_hour INTEGER NOT NULL DEFAULT 0,
        requests_today INTEGER NOT NULL DEFAULT 0,
        requests_this_month INTEGER NOT NULL DEFAULT 0,
        tokens_this_minute INTEGER NOT NULL DEFAULT 0,
        tokens_today INTEGER NOT NULL DEFAULT 0,
        tokens_this_month INTEGER NOT NULL DEFAULT 0,
        queue_depth INTEGER NOT NULL DEFAULT 0,
        active_requests INTEGER NOT NULL DEFAULT 0,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_success INTEGER,
        last_failure INTEGER,
        blocked_until INTEGER,
        observed_rate_limits TEXT,
        last_rate_limit_headers TEXT,
        health TEXT,
        enabled_override INTEGER,
        minute_window_start INTEGER NOT NULL,
        hour_window_start INTEGER NOT NULL,
        day_window_start INTEGER NOT NULL,
        month_window_start INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS github_connections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        token_configured INTEGER NOT NULL DEFAULT 0,
        username TEXT,
        default_repo TEXT,
        default_path TEXT DEFAULT 'chat-logs',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS github_repositories (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES github_connections(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        private INTEGER NOT NULL DEFAULT 0,
        default_branch TEXT NOT NULL DEFAULT 'main',
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at)`,
    ],
    "write",
  );

  const existing = await c.execute("SELECT id FROM users LIMIT 1");
  if (existing.rows.length === 0) {
    const now = Date.now();
    await c.execute({
      sql: "INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)",
      args: [nanoid(), "Local User", now],
    });
  }

  initialized = true;
  return database;
}

export async function getDefaultUserId(): Promise<string> {
  await ensureDatabase();
  const result = await getClient().execute("SELECT id FROM users LIMIT 1");
  return String(result.rows[0]!.id);
}

/** Reset module state — for tests only */
export function resetDatabaseForTests(): void {
  client?.close();
  client = null;
  db = null;
  initialized = false;
}
