import fs from "node:fs/promises";
import path from "node:path";

import { scanText } from "./scanner.js";
import type { Finding } from "./types.js";

export async function buildDiffForProject(rootDir: string): Promise<string[]> {
  const lines: string[] = [];
  const { findings } = await import("./scanner.js").then((m) =>
    m.scanProject(rootDir),
  );

  for (const finding of findings.filter((item) => item.fix)) {
    lines.push(`--- ${finding.file} (${finding.severity}) ---`);
    lines.push(`Reason: ${finding.message}`);
    lines.push(`Change: ${finding.fix?.text ?? ""}`);
    lines.push("");
  }

  return lines;
}

export async function applySafeTransforms(rootDir: string): Promise<number> {
  const { findings } = await import("./scanner.js").then((m) =>
    m.scanProject(rootDir),
  );
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
      updated = updated.replace(
        new RegExp(
          `^.*${finding.fix?.text?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`,
          "m",
        ),
        "",
      );
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

export function toDiffText(findings: Finding[]): string {
  return findings
    .filter((finding) => finding.fix)
    .map((finding) => `- ${finding.file}: ${finding.message}`)
    .join("\n");
}
