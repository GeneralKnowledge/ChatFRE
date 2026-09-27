import { z } from "zod";

export const ChatApiRequestSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(100_000),
  model: z.string().default("auto"),
  provider: z.string().default("auto"),
  regenerateMessageId: z.string().optional(),
  editUserMessageId: z.string().optional(),
});

export const CreateConversationSchema = z.object({
  title: z.string().max(200).optional(),
  modelPreference: z.string().optional(),
  providerPreference: z.string().optional(),
  systemPrompt: z.string().max(20_000).optional(),
});

export const RenameConversationSchema = z.object({
  title: z.string().min(1).max(200),
});

export const SettingsUpdateSchema = z.object({
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  freeOnly: z.boolean().optional(),
  autoProviderSelection: z.boolean().optional(),
});

export const ProviderToggleSchema = z.object({
  providerId: z.string(),
  enabled: z.boolean(),
});

export const GithubExportSchema = z.object({
  conversationId: z.string(),
  repository: z.string().min(3),
  path: z.string().optional(),
});
