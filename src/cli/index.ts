#!/usr/bin/env node
import { Command } from "commander";

import { scanProject } from "../core/scanner.js";

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
  const result = await scanProject(targetPath, {
    rules: { "unused-imports": true, console: true, debugger: true },
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Cleaner v0.1.0");
  console.log(`Scanning ${targetPath}...`);
  console.log(`Files scanned: ${result.filesScanned}`);
  console.log(`Findings: ${result.findings.length}`);

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
