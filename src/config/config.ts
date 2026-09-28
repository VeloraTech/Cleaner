import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_RULES } from "../core/rules.js";

export interface CleanerConfig {
  rules: Record<string, boolean>;
  ignore: string[];
}

export async function loadConfig(
  overrides: Partial<CleanerConfig> = {},
): Promise<CleanerConfig> {
  const rules = { ...DEFAULT_RULES, ...(overrides.rules ?? {}) };
  const ignore = overrides.ignore ?? [
    "node_modules/**",
    "dist/**",
    "coverage/**",
  ];

  return {
    rules,
    ignore,
  };
}

export async function loadConfigFromFile(
  filePath: string,
): Promise<CleanerConfig> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CleanerConfig>;
    return loadConfig(parsed);
  } catch {
    return loadConfig();
  }
}

export async function resolveConfigPath(
  rootDir: string,
  explicitPath?: string,
): Promise<string | undefined> {
  if (explicitPath) {
    return path.resolve(rootDir, explicitPath);
  }

  const candidates = [
    path.join(rootDir, "cleaner.config.json"),
    path.join(rootDir, ".cleaner.json"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue searching
    }
  }

  return undefined;
}
