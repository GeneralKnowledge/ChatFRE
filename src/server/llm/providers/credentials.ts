import type { AdapterCredentials, ProviderConfig } from "../types";

/**
 * Credential abstraction — currently env-based.
 * Designed so encrypted DB storage can replace this later.
 */
export class CredentialStore {
  get(provider: ProviderConfig): AdapterCredentials | null {
    const key = process.env[provider.authentication.envVar]?.trim();
    const required = provider.authentication.required;

    if (required && !key) return null;
    if (!required && !key) {
      // Anonymous access allowed
      return { apiKey: undefined, extra: {} };
    }

    const extra: Record<string, string> = {};
    for (const envVar of provider.authentication.extraEnvVars ?? []) {
      const value = process.env[envVar]?.trim();
      if (!value && required) return null;
      if (value) extra[envVar] = value;
    }

    const accountId =
      extra.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;

    return {
      apiKey: key,
      accountId,
      extra,
    };
  }

  isConfigured(provider: ProviderConfig): boolean {
    if (!provider.authentication.required) return true;
    return Boolean(process.env[provider.authentication.envVar]?.trim());
  }
}

export const credentialStore = new CredentialStore();
