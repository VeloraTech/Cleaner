import fs from "node:fs/promises";
import path from "node:path";

export interface OutputDirectoryResolution {
  dirPath: string;
  created: boolean;
  reused: boolean;
}

export async function resolveOutputDirectory(
  rootDir: string,
  preferredName = "dist",
): Promise<OutputDirectoryResolution> {
  const target = path.join(rootDir, preferredName);

  try {
    const stats = await fs.stat(target);
    if (stats.isDirectory()) {
      return { dirPath: target, created: false, reused: true };
    }
  } catch {
    await fs.mkdir(target, { recursive: true });
    return { dirPath: target, created: true, reused: false };
  }

  return { dirPath: target, created: false, reused: true };
}
