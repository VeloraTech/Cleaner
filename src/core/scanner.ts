import fs from "node:fs/promises";
import path from "node:path";

import type { Finding, ScanOptions, ScanResult } from "./types.js";

function normalizeRuleName(rule: string): string {
  return rule.replace(/[-_\s]+/g, "-");
}

export function scanText(
  source: string,
  filePath: string,
  options: Partial<ScanOptions> = {},
): ScanResult {
  const findings: Finding[] = [];
  const rules = options.rules ?? {
    "unused-imports": true,
    console: true,
    debugger: true,
  };

  const normalizedSource = source.toString();
  const importMatch =
    normalizedSource.match(/import\s+(?:[^;]+?)\s+from\s+['"][^'"]+['"];?/g) ??
    [];

  if (importMatch.length > 0 && rules["unused-imports"]) {
    findings.push({
      rule: "unused-imports",
      file: filePath,
      line: 1,
      severity: "SAFE",
      message: "Unused import candidates detected during static scan.",
      fixable: true,
      fix: { kind: "remove-import", text: importMatch[0] ?? "" },
    });
  }

  const consoleMatch =
    normalizedSource.match(/console\.(log|debug|info|warn|error)\s*\(/g) ?? [];
  if (consoleMatch.length > 0 && rules.console) {
    findings.push({
      rule: "console",
      file: filePath,
      line: 1,
      severity: "SAFE",
      message: `Console debug call(s) detected: ${consoleMatch.length}.`,
      fixable: true,
      fix: { kind: "remove-statement", text: consoleMatch[0] ?? "" },
    });
  }

  const debuggerMatches = normalizedSource.match(/debugger\s*;/g) ?? [];
  if (debuggerMatches.length > 0 && rules.debugger) {
    findings.push({
      rule: "debugger",
      file: filePath,
      line: 1,
      severity: "SAFE",
      message: "Debugger statement found.",
      fixable: true,
      fix: { kind: "remove-statement", text: debuggerMatches[0] ?? "" },
    });
  }

  return { filesScanned: 1, findings };
}

export async function scanProject(
  rootDir: string,
  options: Partial<ScanOptions> = {},
): Promise<ScanResult> {
  const rules = options.rules ?? {
    "unused-imports": true,
    console: true,
    debugger: true,
  };

  const files = await collectFiles(rootDir);
  const findings: Finding[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const scanned = scanText(content, path.relative(rootDir, file), {
      rules: normalizeRules(rules),
    });
    findings.push(...scanned.findings);
  }

  return {
    filesScanned: files.length,
    findings,
  };
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const queue = [rootDir];
  const files: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          ["node_modules", ".git", "dist", "build", "coverage"].includes(
            entry.name,
          )
        ) {
          continue;
        }
        queue.push(entryPath);
      } else if (
        entry.name.endsWith(".js") ||
        entry.name.endsWith(".ts") ||
        entry.name.endsWith(".jsx") ||
        entry.name.endsWith(".tsx")
      ) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function normalizeRules(
  rules: Record<string, boolean>,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(rules).map(([key, value]) => [
      normalizeRuleName(key),
      value,
    ]),
  );
}
