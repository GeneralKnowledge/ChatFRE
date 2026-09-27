import type { ProviderConfig } from "../types";
import type { ProviderAdapter } from "./base";
import { CloudflareNativeAdapter } from "./cloudflare-native";
import { GeminiAdapter } from "./gemini";
import { OpenAIChatAdapter } from "./openai-chat";

const openai = new OpenAIChatAdapter();
const cloudflare = new CloudflareNativeAdapter();
const gemini = new GeminiAdapter();

export function getAdapter(provider: ProviderConfig): ProviderAdapter {
  switch (provider.apiStyle) {
    case "cloudflare_native":
      return cloudflare;
    case "gemini_native_or_openai_compat":
      return gemini;
    case "openai_chat":
    default:
      return openai;
  }
}
