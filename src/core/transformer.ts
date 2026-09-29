import fs from "node:fs/promises";
import path from "node:path";

import { collectProjectFiles, scanProject } from "./scanner.js";
import type { Finding, ScanOptions } from "./types.js";

export async function buildDiffForProject(
  rootDir: string,
  options: Partial<ScanOptions> = {},
): Promise<string[]> {
  const { findings } = await scanProject(rootDir, options);
  const lines: string[] = [];

  for (const finding of findings.filter((item) => item.fix)) {
    lines.push(`--- ${finding.file} (${finding.severity}) ---`);
    lines.push(`Reason: ${finding.message}`);
    lines.push(`Change: ${finding.fix?.text ?? ""}`);
    lines.push("");
  }

  return lines;
}

export async function applySafeTransforms(
  rootDir: string,
  options: Partial<ScanOptions> = {},
): Promise<number> {
  const { findings } = await scanProject(rootDir, options);
  const byFile = new Map<string, string>();

  for (const finding of findings.filter(
    (item) => item.fix && item.severity === "SAFE",
  )) {
    const filePath = path.join(rootDir, finding.file);
    const current =
      byFile.get(filePath) ?? (await fs.readFile(filePath, "utf8"));
    let updated = current;

    if (finding.rule === "debugger") {
      updated = updated.replace(/debugger\s*;/g, "");
    }

    if (finding.rule === "console") {
      updated = updated.replace(
        /console\.(log|debug|info|warn|error)\s*\([^;]*\);?/g,
        "",
      );
    }

    if (finding.rule === "unused-imports") {
      const importLine = finding.fix?.text ?? "";
      if (importLine) {
        updated = updated.replace(
          new RegExp(`^\\s*${escapeRegex(importLine)}\\s*\\n?`, "m"),
          "",
        );
      }
    }

    byFile.set(filePath, updated);
  }

  let applied = 0;
  for (const [filePath, updatedText] of byFile.entries()) {
    const existing = await fs.readFile(filePath, "utf8");
    if (existing !== updatedText) {
      await fs.writeFile(filePath, updatedText);
      applied += 1;
    }
  }

  return applied;
}

export async function writeCleanedCopy(
  inputDir: string,
  outputDir: string,
  options: Partial<ScanOptions> = {},
): Promise<number> {
  const files = await collectProjectFiles(inputDir, options.ignore);
  await fs.mkdir(outputDir, { recursive: true });

  for (const sourcePath of files) {
    const relativePath = path.relative(inputDir, sourcePath);
    const destinationPath = path.join(outputDir, relativePath);
    if (path.resolve(sourcePath) === path.resolve(destinationPath)) continue;
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }

  return applySafeTransforms(outputDir, options);
}

export function toDiffText(findings: Finding[]): string {
  return findings
    .filter((finding) => finding.fix)
    .map((finding) => `- ${finding.file}: ${finding.message}`)
    .join("\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
