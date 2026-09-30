import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { scanText, scanProject } from "../src/core/scanner.js";
import { loadConfig } from "../src/config/config.js";
import { RULES } from "../src/core/rules.js";
import { resolveOutputPlan } from "../src/core/output.js";
import { applySafeTransforms } from "../src/core/transformer.js";

test("detects unused imports and debug statements in code text", () => {
  const source = `
    import jwt from 'jsonwebtoken';
    const answer = 42;
    console.log('debug');
    debugger;

    function app() {
      return answer;
    }
  `;

  const result = scanText(source, "example.ts");
  assert.ok(
    result.findings.some((finding) => finding.rule === "unused-imports"),
  );
  assert.ok(result.findings.some((finding) => finding.rule === "console"));
  assert.ok(result.findings.some((finding) => finding.rule === "debugger"));
});

test("scanProject reports files and safe findings without writing", async () => {
  const dir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(path.join(tmpdir(), "cleaner-output-")),
  );

  await import("node:fs/promises").then(async (fs) => {
    await fs.mkdir(`${dir}/src`, { recursive: true });
    await fs.writeFile(
      `${dir}/src/example.ts`,
      `import jwt from 'jsonwebtoken';\nconst x = 1;\nconsole.log('hi');\n\nexport function run() { return x; }\n`,
    );
  });

  const result = await scanProject(dir, {
    rules: { "unused-imports": true, console: true, debugger: true },
  });
  assert.ok(result.findings.length >= 2);
  assert.ok(result.filesScanned >= 1);
});

test("detects unused variables and dead-code candidates", () => {
  const source = `
    const unusedValue = 123;
    function sample() {
      const value = 1;
      return value;
      const deadCode = 2;
    }
  `;

  const result = scanText(source, "example.ts", {
    rules: { "unused-variables": true, "dead-code": true },
  });

  assert.ok(
    result.findings.some((finding) => finding.rule === "unused-variables"),
  );
  assert.ok(result.findings.some((finding) => finding.rule === "dead-code"));
});

test("loads config defaults and ignore patterns", async () => {
  const config = await loadConfig({
    rules: { console: true, debugger: true },
    ignore: ["dist/**", "coverage/**"],
  });

  assert.equal(config.rules.console, true);
  assert.equal(config.rules.debugger, true);
  assert.deepEqual(config.ignore, ["dist/**", "coverage/**"]);
});

test("rule registry exposes every configured rule", () => {
  const ruleIds = Object.keys(RULES);
  assert.ok(ruleIds.length > 0);
  for (const ruleId of ruleIds) {
    const rule = RULES[ruleId as keyof typeof RULES];
    assert.equal(rule?.id, ruleId);
    assert.equal(typeof rule?.description, "string");
    assert.equal(typeof rule?.fixable, "boolean");
  }
});

test("unused-import fixtures classify bindings and transform only proven unused imports", async () => {
  const fixtureRoot = path.resolve("fixtures/unused-imports");
  const cases = [
    ["used-default-import.js", false],
    ["unused-default-import.js", true],
    ["used-named-import.js", false],
    ["unused-named-import.js", true],
    ["used-namespace-import.js", false],
    ["alias-import.js", false],
    ["shadowed-binding.js", true],
    ["nested-scope.js", false],
    ["callback-reference.js", false],
    ["exported-import.js", false],
    ["side-effect-import.js", false],
    ["typescript-type-usage.ts", false],
    ["cookie-parser-regression.js", false],
    ["unused-cookie-parser.js", true],
    ["re-export-from.js", false],
  ] as const;

  for (const [fixtureName, expectedUnused] of cases) {
    const source = await readFile(path.join(fixtureRoot, fixtureName), "utf8");
    const result = scanText(source, fixtureName);
    const hasUnusedImport = result.findings.some(
      (finding) => finding.rule === "unused-imports",
    );
    assert.equal(hasUnusedImport, expectedUnused, fixtureName);

    const projectDir = await mkdtemp(
      path.join(tmpdir(), "cleaner-import-fix-"),
    );
    const sourceFile = path.join(projectDir, fixtureName);
    await writeFile(sourceFile, source);
    await applySafeTransforms(projectDir);
    const transformed = await readFile(sourceFile, "utf8");
    if (expectedUnused) {
      assert.doesNotMatch(transformed, /^\s*import\b/m, fixtureName);
    } else {
      assert.equal(transformed, source, fixtureName);
    }
  }
});

test("import references are recognized in common expression contexts", () => {
  const references = [
    "foo();",
    "const x = foo;",
    "const x = foo();",
    "return foo;",
    "await foo();",
    "if (foo) {}",
    "foo && bar();",
    'router.post("/", foo);',
    "const middleware = foo(); app.use(middleware);",
    "const obj = { handler: foo };",
    "const obj = { foo };",
    "const arr = [foo];",
    "const result = foo ? a : b;",
  ];

  for (const reference of references) {
    const source = `import foo from "./foo.js";\nfunction run() { ${reference} }`;
    const result = scanText(source, "references.js");
    assert.ok(
      !result.findings.some((finding) => finding.rule === "unused-imports"),
      reference,
    );
  }
});

test("a same-named destructured local does not count as an import reference", () => {
  const source = `import foo from "./foo.js";\nfunction run() { const { foo } = something; return foo; }`;
  const result = scanText(source, "destructured-shadow.js");
  assert.ok(
    result.findings.some((finding) => finding.rule === "unused-imports"),
  );
});

test("syntax uncertainty warns and never offers an import removal", () => {
  const result = scanText(
    `import foo from "./foo.js";\nconst = ;`,
    "uncertain.js",
  );
  const finding = result.findings.find(
    (item) => item.rule === "unused-imports",
  );

  assert.equal(finding?.severity, "WARNING");
  assert.equal(finding?.fixable, false);
  assert.match(finding?.message ?? "", /Could not prove.*Keeping it unchanged/);
});

test("cookie-parser stays intact through default, diff, and source-write CLI paths", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-express-"));
  const sourceDir = path.join(projectDir, "src");
  await mkdir(sourceDir, { recursive: true });
  const sourceFile = path.join(sourceDir, "app.js");
  const source = `import express from "express";\nimport cookieParser from "cookie-parser";\n\nconst app = express();\napp.use(cookieParser());\n`;
  await writeFile(sourceFile, source);
  const cliPath = path.resolve("dist/src/cli/index.js");

  execFileSync("node", [cliPath, "src"], { cwd: projectDir, encoding: "utf8" });
  assert.equal(await readFile(sourceFile, "utf8"), source);
  assert.equal(
    await readFile(path.join(projectDir, "dist", "src", "app.js"), "utf8"),
    source,
  );

  const diff = execFileSync("node", [cliPath, "src", "--diff"], {
    cwd: projectDir,
    encoding: "utf8",
  });
  assert.doesNotMatch(diff, /unused-imports/);

  execFileSync("node", [cliPath, "src", "--write", "--force"], {
    cwd: projectDir,
    encoding: "utf8",
  });
  assert.match(await readFile(sourceFile, "utf8"), /cookieParser\(\)/);
  assert.match(await readFile(sourceFile, "utf8"), /import cookieParser/);
});

test("detects unused parameters and dead-file candidates", () => {
  const source = `
    function greet(name, unusedValue) {
      return \`Hello \${name}\`;
    }
    export const legacy = 1;
  `;

  const result = scanText(source, "src/legacy.ts", {
    rules: { "unused-parameters": true, "dead-files": true },
  });

  assert.ok(
    result.findings.some((finding) => finding.rule === "unused-parameters"),
  );
  assert.ok(result.findings.some((finding) => finding.rule === "dead-files"));
});

test("scanProject skips ignored files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cleaner-ignore-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await mkdir(path.join(dir, "dist"), { recursive: true });
  await writeFile(path.join(dir, "src", "visible.ts"), "console.log('x');\n");
  await writeFile(path.join(dir, "dist", "ignored.ts"), "console.log('y');\n");

  const result = await scanProject(dir, {
    rules: { console: true },
    ignore: ["dist/**"],
  });

  assert.ok(
    result.findings.some((finding) => finding.file.includes("visible.ts")),
  );
  assert.ok(!result.findings.some((finding) => finding.file.includes("dist")));
});

test("diff mode reports proposed changes", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-output-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "demo.ts"),
    `import jwt from 'jsonwebtoken';\nconsole.log('hi');\ndebugger;\n`,
  );

  const output = execFileSync(
    "node",
    ["dist/src/cli/index.js", projectDir, "--diff"],
    { encoding: "utf8" },
  );

  assert.match(output, /--- .*demo\.ts/i);
  assert.match(output, /console|debugger|unused-imports/i);
});

test("default mode writes a cleaned copy and preserves the source", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-output-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  const filePath = path.join(projectDir, "src", "demo.ts");
  const source = `import jwt from 'jsonwebtoken';\nconsole.log('hi');\ndebugger;\nexport const keep = 1;\n`;
  await writeFile(filePath, source);

  execFileSync("node", [path.resolve("dist/src/cli/index.js"), "src"], {
    cwd: projectDir,
    encoding: "utf8",
  });

  assert.equal(await readFile(filePath, "utf8"), source);
  const updated = await readFile(
    path.join(projectDir, "dist", "src", "demo.ts"),
    "utf8",
  );
  assert.doesNotMatch(updated, /console\.log|debugger;/i);
});

test("custom output preserves the input directory structure", async () => {
  const projectDir = await mkdtemp(
    path.join(tmpdir(), "cleaner-custom-output-"),
  );
  await mkdir(path.join(projectDir, "src", "nested"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "nested", "demo.ts"),
    "console.log('x');\n",
  );

  execFileSync(
    "node",
    [path.resolve("dist/src/cli/index.js"), "src", "--output", "cleaned"],
    {
      cwd: projectDir,
      encoding: "utf8",
    },
  );

  await access(path.join(projectDir, "cleaned", "src", "nested", "demo.ts"));
});

test("project-root input writes directly under dist", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-root-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "demo.ts"),
    "console.log('x');\n",
  );

  execFileSync("node", [path.resolve("dist/src/cli/index.js"), "."], {
    cwd: projectDir,
    encoding: "utf8",
  });
  execFileSync("node", [path.resolve("dist/src/cli/index.js"), "."], {
    cwd: projectDir,
    encoding: "utf8",
  });

  await access(path.join(projectDir, "dist", "src", "demo.ts"));
  await assert.rejects(
    access(path.join(projectDir, "dist", path.basename(projectDir))),
  );
  await assert.rejects(access(path.join(projectDir, "dist", "dist")));
});

test("output inside the source tree is rejected", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-overlap-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "demo.ts"),
    "console.log('x');\n",
  );

  await assert.rejects(
    resolveOutputPlan("src", "src/cleaned", projectDir),
    /overlaps the input directory/i,
  );
});

test("write mode requires an explicit source override", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-write-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  const filePath = path.join(projectDir, "src", "demo.ts");
  await writeFile(filePath, "console.log('hi');\ndebugger;\n");

  assert.throws(() =>
    execFileSync(
      "node",
      [path.resolve("dist/src/cli/index.js"), "src", "--write"],
      {
        cwd: projectDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  assert.match(await readFile(filePath, "utf8"), /console\.log|debugger;/i);

  execFileSync(
    "node",
    [path.resolve("dist/src/cli/index.js"), "src", "--write", "--force"],
    {
      cwd: projectDir,
      encoding: "utf8",
    },
  );
  assert.doesNotMatch(
    await readFile(filePath, "utf8"),
    /console\.log|debugger;/i,
  );
});

test("diff mode does not create output", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-diff-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "demo.ts"),
    "console.log('x');\n",
  );

  execFileSync(
    "node",
    [path.resolve("dist/src/cli/index.js"), "src", "--diff"],
    {
      cwd: projectDir,
      encoding: "utf8",
    },
  );

  await assert.rejects(access(path.join(projectDir, "dist")));
});

test("check mode is read-only", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-check-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "demo.ts"),
    "console.log('x');\n",
  );

  assert.throws(() =>
    execFileSync(
      "node",
      [path.resolve("dist/src/cli/index.js"), "src", "--check"],
      {
        cwd: projectDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  await assert.rejects(access(path.join(projectDir, "dist")));
});

test("sample fixture produces clean JSON CLI output", () => {
  const fixturePath = path.resolve("fixtures/sample-project");
  const output = execFileSync(
    "node",
    ["dist/src/cli/index.js", fixturePath, "--json"],
    { encoding: "utf8" },
  );
  const result = JSON.parse(output) as {
    filesScanned: number;
    findings: Array<{ rule: string }>;
  };

  assert.ok(result.filesScanned >= 2);
  assert.ok(result.findings.some((finding) => finding.rule === "console"));
  assert.ok(result.findings.some((finding) => finding.rule === "debugger"));
});
