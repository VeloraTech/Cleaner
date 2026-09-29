#!/usr/bin/env node
import readline from "node:readline/promises";
import { Command } from "commander";

import {
  loadConfig,
  loadConfigFromFile,
  resolveConfigPath,
} from "../config/config.js";
import { scanProject } from "../core/scanner.js";
import {
  applySafeTransforms,
  buildDiffForProject,
  writeCleanedCopy,
} from "../core/transformer.js";
import { resolveOutputPlan } from "../core/output.js";
import { RULES } from "../core/rules.js";

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
  .version("0.1.0");

program.action(async (targetPath: string, options: Record<string, any>) => {
  const resolvedPath = await resolveConfigPath(targetPath, options.config);
  const config = resolvedPath
    ? await loadConfigFromFile(resolvedPath)
    : await loadConfig();

  const result = await scanProject(targetPath, {
    rules: config.rules,
    ignore: config.ignore,
  });

  if (
    options.check ||
    options.json ||
    options.diff ||
    (!options.write && !options.json && !options.diff)
  ) {
    printResult(targetPath, result, config.rules, options.json);
  }

  if (options.diff) {
    const diffLines = await buildDiffForProject(targetPath, {
      rules: config.rules,
      ignore: config.ignore,
    });
    console.log(diffLines.join("\n") || "No safe diff output available.");
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
    const applied = await applySafeTransforms(outputPlan.inputPath, {
      rules: config.rules,
      ignore: config.ignore,
    });
    console.log(`Applied ${applied} safe changes to the source directory.`);
    return;
  }

  const applied = await writeCleanedCopy(
    outputPlan.inputPath,
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
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Cleaner v0.1.0");
  console.log(`Scanning: ${targetPath}`);
  console.log(`Files scanned: ${result.filesScanned}`);
  console.log(`Findings: ${result.findings.length}`);
  console.log(
    `Rules enabled: ${Object.keys(RULES).filter((id) => rules[id] !== false).length}`,
  );

  for (const finding of result.findings) {
    console.log(
      `${finding.severity} ${finding.rule} ${finding.file}:${finding.line} - ${finding.message}`,
    );
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
