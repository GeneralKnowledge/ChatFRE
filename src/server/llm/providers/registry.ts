import fs from "node:fs";
import path from "node:path";
import {
  ProvidersFileSchema,
  type ProviderConfig,
  type ProvidersFile,
} from "../types";

let cached: ProvidersFile | null = null;

export function loadProvidersConfig(force = false): ProvidersFile {
  if (cached && !force) return cached;

  const candidates = [
    path.join(process.cwd(), "config", "providers.json"),
    path.join(process.cwd(), "src", "config", "providers.json"),
  ];

  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    throw new Error("providers.json not found");
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  cached = ProvidersFileSchema.parse(raw);
  return cached;
}

export function getProviderConfigs(opts?: {
  includeDisabled?: boolean;
}): ProviderConfig[] {
  const file = loadProvidersConfig();
  if (opts?.includeDisabled) return file.providers;
  return file.providers.filter((p) => p.enabled);
}

export function getProviderById(id: string): ProviderConfig | undefined {
  return loadProvidersConfig().providers.find((p) => p.id === id);
}

export function getGlobalConcurrency(): number {
  return loadProvidersConfig().globalConcurrency ?? 1;
}

export function getFreeOnlyDefault(): boolean {
  return loadProvidersConfig().freeOnlyDefault ?? true;
}

export function clearProvidersCache(): void {
  cached = null;
}
