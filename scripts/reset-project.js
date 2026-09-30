import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixedTargets = ["dist", "coverage", "tmp", ".tmp", "test-output", "out"];

async function main() {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(projectRoot, "package.json"), "utf8"),
  );
  const tarballPrefix = packageJson.name.replace(/^@/, "").replace(/\//g, "-");
  const tarballPattern = new RegExp(`^${escapeRegex(tarballPrefix)}-.*\\.tgz$`);
  const entries = await fs.readdir(projectRoot, { withFileTypes: true });
  const targets = fixedTargets
    .filter((name) => entries.some((entry) => entry.name === name))
    .map((name) => path.join(projectRoot, name));

  for (const entry of entries) {
    if (entry.isFile() && tarballPattern.test(entry.name)) {
      targets.push(path.join(projectRoot, entry.name));
    }
  }

  console.log("Cleaner project reset");
  if (targets.length === 0) {
    console.log("No disposable development artifacts found.");
    return;
  }

  console.log("\nThe following development artifacts will be removed:\n");
  for (const target of targets) {
    console.log(`  ${path.relative(projectRoot, target)}`);
  }

  if (process.argv.includes("--yes")) {
    await removeTargets(targets);
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Reset requires interactive confirmation. Use --yes only when you intend to remove the listed artifacts.",
    );
  }

  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await prompt.question("\nContinue? [y/N] ");
  prompt.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("Reset cancelled. No files were removed.");
    return;
  }

  await removeTargets(targets);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function removeTargets(targets) {
  for (const target of targets) {
    await fs.rm(target, { recursive: true, force: true });
    console.log(`Removed ${path.relative(projectRoot, target)}`);
  }
}

main().catch((error) => {
  console.error(`Reset failed: ${error.message}`);
  process.exitCode = 1;
});
