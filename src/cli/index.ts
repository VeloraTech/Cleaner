#!/usr/bin/env node
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
} from "../core/transformer.js";
import { resolveOutputDirectory } from "../core/output.js";
import { RULES } from "../core/rules.js";

const program = new Command();
program.name("cleaner");
program.description(
  "A safe static-analysis tool for identifying unnecessary code and artifacts.",
);

program
  .argument("[path]", "project path to scan", ".")
  .option(
    "--check",
    "scan without modifying files and return a CI-friendly exit code",
  )
  .option("--json", "emit JSON output")
  .option("--diff", "preview proposed changes")
  .option("--write", "apply safe transformations")
  .option("--config <path>", "path to cleaner config file")
  .version("0.1.0");

program.action(async (targetPath: string, options: any) => {
  const resolvedPath = await resolveConfigPath(targetPath, options.config);
  const config = resolvedPath
    ? await loadConfigFromFile(resolvedPath)
    : await loadConfig();

  const outputDir = await resolveOutputDirectory(process.cwd(), "dist");

  const result = await scanProject(targetPath, {
    rules: config.rules,
    ignore: config.ignore,
  });

  if (options.diff) {
    const diffLines = await buildDiffForProject(targetPath);
    console.log(diffLines.join("\n") || "No safe diff output available.");
    return;
  }

  if (options.write) {
    const applied = await applySafeTransforms(targetPath);
    console.log(`Applied ${applied} safe changes.`);
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Output directory: ${outputDir.dirPath}`);
  console.log("Cleaner v0.1.0");
  console.log(`Scanning ${targetPath}...`);
  console.log(`Files scanned: ${result.filesScanned}`);
  console.log(`Findings: ${result.findings.length}`);
  console.log(
    `Rules enabled: ${Object.keys(RULES).filter((id) => config.rules[id] !== false).length}`,
  );

  for (const finding of result.findings) {
    console.log(
      `${finding.severity} ${finding.rule} ${finding.file}:${finding.line} - ${finding.message}`,
    );
  }

  if (options.check) {
    process.exit(result.findings.length > 0 ? 1 : 0);
  }
});

program.parse();
