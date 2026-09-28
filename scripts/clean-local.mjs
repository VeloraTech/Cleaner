import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const cleanupTargets = [
  ".tmp",
  ".cache",
  "tmp",
  "temp",
  "coverage",
  ".nyc_output",
  ".eslintcache",
  "dist",
  "out",
];

async function removeIfExists(targetPath) {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isDirectory()) {
      await fs.rm(targetPath, { recursive: true, force: true });
      console.log(
        `Removed directory: ${path.relative(projectRoot, targetPath) || "."}`,
      );
      return;
    }

    await fs.unlink(targetPath);
    console.log(
      `Removed file: ${path.relative(projectRoot, targetPath) || "."}`,
    );
  } catch {
    // Ignore missing paths.
  }
}

async function main() {
  for (const target of cleanupTargets) {
    await removeIfExists(path.join(projectRoot, target));
  }

  console.log("Local cleanup complete.");
}

main().catch((error) => {
  console.error("Local cleanup failed:", error);
  process.exitCode = 1;
});
