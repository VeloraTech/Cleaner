import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageJson = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const args = process.argv.slice(2);

function fail(message) {
  console.error(`Release check failed: ${message}`);
  process.exit(1);
}

function validateTag(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag ?? "");
  if (!match) {
    fail(`'${tag ?? ""}' is not a stable semantic version tag like v1.2.3.`);
  }
  if (tag !== `v${packageJson.version}`) {
    fail(
      `tag '${tag}' does not match package.json version '${packageJson.version}'.`,
    );
  }
  console.log(
    `Release tag ${tag} matches ${packageJson.name}@${packageJson.version}.`,
  );
}

function validatePackageMetadata() {
  if (!packageJson.name || !packageJson.version)
    fail("package name/version is missing.");
  if (packageJson.engines?.node !== ">=18") {
    fail(
      "package.json must declare the supported Node.js range (currently >=18).",
    );
  }
  if (packageJson.bin?.cleaner !== "dist/src/cli/index.js") {
    fail("the cleaner binary must point to dist/src/cli/index.js.");
  }
  for (const expectedFile of [
    "dist/src",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
  ]) {
    if (!packageJson.files?.includes(expectedFile)) {
      fail(`package.json files must include '${expectedFile}'.`);
    }
  }
}

function verifyPackManifest(manifestPath, tag) {
  if (tag) validateTag(tag);
  validatePackageMetadata();

  const manifest = JSON.parse(
    readFileSync(path.resolve(projectRoot, manifestPath), "utf8"),
  );
  if (!Array.isArray(manifest) || manifest.length !== 1) {
    fail("npm pack manifest must contain exactly one package.");
  }
  const packed = manifest[0];
  if (
    packed.name !== packageJson.name ||
    packed.version !== packageJson.version
  ) {
    fail(
      `packed package identity '${packed.name}@${packed.version}' does not match package.json.`,
    );
  }
  if (tag && packed.version !== tag.slice(1)) {
    fail(
      `packed version '${packed.version}' does not match release tag '${tag}'.`,
    );
  }
  if (!path.basename(packed.filename).endsWith(".tgz")) {
    fail("npm did not report a .tgz package filename.");
  }

  const files = new Set(
    packed.files.map((file) => file.path.replace(/\\/g, "/")),
  );
  const requiredFiles = [
    "package.json",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "dist/src/cli/index.js",
    "dist/src/config/config.js",
    "dist/src/core/scanner.js",
    "dist/src/core/transformer.js",
  ];
  for (const file of requiredFiles) {
    if (!files.has(file)) fail(`package is missing required file '${file}'.`);
  }

  const forbiddenPath =
    /(^|\/)(tests?|fixtures|scripts|node_modules|\.github)(\/|$)|(^|\/)\.env(?:\.|$)|(^|\/)\.npmrc$|(^|\/)package-lock\.json$/i;
  const forbiddenFiles = [...files].filter((file) => forbiddenPath.test(file));
  if (forbiddenFiles.length > 0) {
    fail(
      `package contains development or sensitive files: ${forbiddenFiles.join(", ")}`,
    );
  }

  const cliSource = readFileSync(
    path.join(projectRoot, packageJson.bin.cleaner),
    "utf8",
  );
  if (!cliSource.startsWith("#!/usr/bin/env node")) {
    fail("the CLI entry point is missing its Node.js executable shebang.");
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `package_file=${packed.filename}\n`,
    );
  }
  console.log(
    `Verified ${packed.filename}: ${packed.files.length} files, executable entry point and required package files present.`,
  );
}

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli)
    fail("run release:check through npm so npm_execpath is available.");
  return spawnSync(process.execPath, [npmCli, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    ...options,
  });
}

function runNpmStep(args, label) {
  console.log(`\n> npm ${args.join(" ")}\n`);
  const result = runNpm(args, { stdio: "inherit" });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0)
    fail(`${label} exited with status ${result.status}.`);
}

validatePackageMetadata();

if (args[0] === "--validate-tag") {
  validateTag(args[1]);
} else if (args[0] === "--manifest") {
  if (!args[1]) fail("provide the npm pack JSON manifest path.");
  const tagIndex = args.indexOf("--tag");
  verifyPackManifest(args[1], tagIndex >= 0 ? args[tagIndex + 1] : undefined);
} else {
  const tagIndex = args.indexOf("--tag");
  const tag = tagIndex >= 0 ? args[tagIndex + 1] : `v${packageJson.version}`;
  validateTag(tag);
  runNpmStep(["test"], "tests");
  runNpmStep(["run", "build"], "build");

  const dryRun = runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"], {
    maxBuffer: 10 * 1024 * 1024,
  });
  if (dryRun.error) fail(`npm pack --dry-run: ${dryRun.error.message}`);
  if (dryRun.status !== 0) {
    process.stderr.write(dryRun.stderr ?? "");
    fail(`npm pack --dry-run exited with status ${dryRun.status}.`);
  }

  const manifestPath = path.join(projectRoot, ".release-pack-manifest.json");
  try {
    JSON.parse(dryRun.stdout);
  } catch {
    fail("npm pack --dry-run did not return valid JSON.");
  }
  const { writeFileSync, rmSync } = await import("node:fs");
  writeFileSync(manifestPath, dryRun.stdout);
  try {
    verifyPackManifest(manifestPath, tag);
  } finally {
    rmSync(manifestPath, { force: true });
  }
  console.log(
    "Local release checks passed. No tarball was created or published.",
  );
}
