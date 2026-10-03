#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

import {
  loadConfig,
  loadConfigFromFile,
  resolveConfigPath,
} from "../config/config.js";
import { analyzeProject } from "../core/scanner.js";
import {
  applyAnalysisPlan,
  buildDiffFromAnalysis,
  writeCleanedCopyFromAnalysis,
} from "../core/transformer.js";
import { resolveOutputPlan } from "../core/output.js";
import { RULES } from "../core/rules.js";
import type { Project, ScanResult } from "../core/types.js";

const packageVersion = (
  JSON.parse(
    readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../package.json",
      ),
      "utf8",
    ),
  ) as { version: string }
).version;

const program = new Command();
program.name("cleaner");
program.description(
  "Analyze your project and write a cleaned copy by default. Source files are never modified unless you explicitly choose the source location and confirm.",
);

program
  .argument("[path]", "project path to scan", ".")
  .option(
    "--check",
    "scan without modifying files and return a CI-friendly exit code",
  )
  .option("--json", "emit JSON output")
  .option("--diff", "preview proposed changes")
  .option("--write", "enable the explicit source modification workflow")
  .option("-o, --output <directory>", "output directory (default: dist)")
  .option("--force", "skip confirmation for explicit source modification")
  .option("--config <path>", "path to cleaner config file")
  .version(packageVersion);

program.action(async (targetPath: string, options: Record<string, any>) => {
  const resolvedPath = await resolveConfigPath(targetPath, options.config);
  const config = resolvedPath
    ? await loadConfigFromFile(resolvedPath)
    : await loadConfig();

  const analysis = await analyzeProject(targetPath, {
    rules: config.rules,
    ignore: config.ignore,
  });
  const result: ScanResult = {
    filesScanned: analysis.project.files.length,
    findings: analysis.findings,
  };

  if (
    options.check ||
    options.json ||
    options.diff ||
    (!options.write && !options.json && !options.diff)
  ) {
    const mode = options.diff
      ? "Diff preview (read-only)"
      : options.check
        ? "Check (read-only)"
        : "Cleaned copy";
    printResult(
      targetPath,
      result,
      config.rules,
      options.json,
      mode,
      analysis.project,
      analysis.sessionId,
    );
  }

  if (options.diff) {
    const diffLines = buildDiffFromAnalysis(analysis);
    console.log("\nProposed safe changes:");
    console.log(diffLines.join("\n") || "  No safe changes to propose.");
    console.log("\nDiff preview only. No files were changed or written.");
    return;
  }

  if (options.check) {
    process.exitCode = result.findings.length > 0 ? 1 : 0;
    return;
  }

  if (options.json) {
    return;
  }

  if (options.write && options.output && options.output !== targetPath) {
    throw new Error(
      "--write modifies the input source and cannot use a different --output directory.",
    );
  }

  const outputOption = options.write ? targetPath : options.output;
  const outputPlan = await resolveOutputPlan(targetPath, outputOption);

  if (outputPlan.sourceModification) {
    await confirmSourceModification(targetPath, options.force, options.write);
    const applied = await applyAnalysisPlan(analysis, outputPlan.inputPath, {
      rules: config.rules,
      ignore: config.ignore,
    });
    console.log(`Applied ${applied} safe changes to the source directory.`);
    return;
  }

  const applied = await writeCleanedCopyFromAnalysis(
    analysis,
    outputPlan.outputPath,
    {
      rules: config.rules,
      ignore: config.ignore,
    },
  );
  console.log(`Writing cleaned files...`);
  console.log(`Output: ${outputPlan.outputPath}`);
  console.log(`Applied ${applied} safe changes.`);
  console.log("Source files were not modified.");
});

program.parseAsync().catch((error: unknown) => {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});

function printResult(
  targetPath: string,
  result: {
    filesScanned: number;
    findings: Array<{
      severity: string;
      rule: string;
      file: string;
      line: number;
      message: string;
    }>;
  },
  rules: Record<string, boolean>,
  json: boolean,
  mode: string,
  project: Project,
  sessionId: string,
): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          sessionId,
          project: {
            id: project.id,
            root: project.root,
            tsconfigPath: project.tsconfigPath,
            configDiagnostics: project.configDiagnostics,
            graph: project.graph,
          },
          ...result,
        },
        null,
        2,
      ),
    );
    return;
  }

  const activeRules = Object.values(RULES)
    .filter((rule) => rule.status === "implemented")
    .map((rule) => rule.id);
  const severityOrder = ["SAFE", "WARNING", "INFO", "ERROR"];
  const severityCounts = severityOrder
    .map(
      (severity) =>
        `${severity} ${result.findings.filter((finding) => finding.severity === severity).length}`,
    )
    .join(", ");

  console.log(`Cleaner v${packageVersion}`);
  console.log(`Mode: ${mode}`);
  console.log(`Input: ${targetPath}`);
  console.log(`Files scanned: ${result.filesScanned}`);
  console.log(
    `Project graph: ${project.graph.modules.length} modules, ${project.graph.symbols.length} symbols, ${project.graph.references.length} references, ${project.graph.dependencies.length} dependencies, ${project.graph.calls.length} calls`,
  );
  console.log(`Findings: ${result.findings.length} (${severityCounts})`);
  console.log(
    `Implemented rules enabled: ${activeRules.filter((id) => rules[id] !== false).length}/${activeRules.length}`,
  );

  for (const severity of severityOrder) {
    const findings = result.findings.filter(
      (finding) => finding.severity === severity,
    );
    if (findings.length === 0) continue;
    console.log(`\n${severity} findings:`);
    for (const finding of findings) {
      const displayPath = finding.file.replace(/\\/g, "/");
      console.log(
        `  ${finding.rule} ${displayPath}:${finding.line} - ${finding.message}`,
      );
    }
  }
}

async function confirmSourceModification(
  targetPath: string,
  force: boolean,
  writeRequested: boolean,
): Promise<void> {
  if (force) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Modifying the source directory requires explicit confirmation. Use --force only when you intentionally want to modify source files.",
    );
  }

  console.warn("⚠ Cleaner is about to modify your source directory.");
  console.warn(`\nInput:\n  ${targetPath}\n\nOutput:\n  ${targetPath}`);
  console.warn(
    writeRequested
      ? "\nYou requested source modification. This cannot be automatically undone."
      : "\nYou explicitly selected the source directory as the output.",
  );
  console.warn('\nType "y" to confirm you understand and want to continue:');

  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await prompt.question("");
  prompt.close();
  if (answer.trim().toLowerCase() !== "y") {
    throw new Error("Operation cancelled. No files were modified.");
  }
}
