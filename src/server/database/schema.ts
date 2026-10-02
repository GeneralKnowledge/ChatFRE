import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default("Local User"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull().default("New Chat"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  modelPreference: text("model_preference").notNull().default("auto"),
  providerPreference: text("provider_preference").notNull().default("auto"),
  systemPrompt: text("system_prompt"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["system", "user", "assistant", "tool"],
  }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  provider: text("provider"),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  status: text("status", {
    enum: ["pending", "streaming", "completed", "failed", "cancelled"],
  })
    .notNull()
    .default("completed"),
  error: text("error"),
  metadata: text("metadata"),
});

export const providerRuntimeState = sqliteTable("provider_runtime_state", {
  providerId: text("provider_id").primaryKey(),
  requestsThisMinute: integer("requests_this_minute").notNull().default(0),
  requestsThisHour: integer("requests_this_hour").notNull().default(0),
  requestsToday: integer("requests_today").notNull().default(0),
  requestsThisMonth: integer("requests_this_month").notNull().default(0),
  tokensThisMinute: integer("tokens_this_minute").notNull().default(0),
  tokensToday: integer("tokens_today").notNull().default(0),
  tokensThisMonth: integer("tokens_this_month").notNull().default(0),
  queueDepth: integer("queue_depth").notNull().default(0),
  activeRequests: integer("active_requests").notNull().default(0),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastSuccess: integer("last_success"),
  lastFailure: integer("last_failure"),
  blockedUntil: integer("blocked_until"),
  observedRateLimits: text("observed_rate_limits"),
  lastRateLimitHeaders: text("last_rate_limit_headers"),
  health: text("health"),
  enabledOverride: integer("enabled_override", { mode: "boolean" }),
  minuteWindowStart: integer("minute_window_start").notNull(),
  hourWindowStart: integer("hour_window_start").notNull(),
  dayWindowStart: integer("day_window_start").notNull(),
  monthWindowStart: integer("month_window_start").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const githubConnections = sqliteTable("github_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenConfigured: integer("token_configured", { mode: "boolean" })
    .notNull()
    .default(false),
  username: text("username"),
  defaultRepo: text("default_repo"),
  defaultPath: text("default_path").default("chat-logs"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const githubRepositories = sqliteTable("github_repositories", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id")
    .notNull()
    .references(() => githubConnections.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  private: integer("private", { mode: "boolean" }).notNull().default(false),
  defaultBranch: text("default_branch").notNull().default("main"),
  updatedAt: integer("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Setting = typeof settings.$inferSelect;
