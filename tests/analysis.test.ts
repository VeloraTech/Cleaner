import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { analyzeProject, scanText, scanProject } from "../src/core/scanner.js";
import { loadConfig } from "../src/config/config.js";
import { RULES } from "../src/core/rules.js";
import { resolveOutputPlan } from "../src/core/output.js";
import { applySafeTransforms } from "../src/core/transformer.js";
import { validateTransformationPlan } from "../src/core/validation.js";

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

test("console cleanup preserves surrounding callback and call syntax", async () => {
  const projectDir = await mkdtemp(
    path.join(tmpdir(), "cleaner-console-block-"),
  );
  const filePath = path.join(projectDir, "server.js");
  const source = `app.listen(PORT, () => {\n  console.log("started");\n});\n`;
  await writeFile(filePath, source);

  await applySafeTransforms(projectDir, {
    rules: { console: true },
  });

  const updated = await readFile(filePath, "utf8");
  assert.doesNotMatch(updated, /console\.log/);
  assert.match(updated, /app\.listen\(PORT, \(\) => \{\s*\}\);/);
});

test("console calls in expression and unbraced control-flow contexts are kept", () => {
  const result = scanText(
    `if (ready) console.log("ready");\nconst result = console.log("value");`,
    "unsafe-console-context.js",
    { rules: { console: true } },
  );

  assert.equal(
    result.findings.filter((item) => item.rule === "console").length,
    2,
  );
  assert.equal(
    result.findings.every((item) => item.severity === "WARNING"),
    true,
  );
  assert.equal(
    result.findings.every((item) => !item.fixable),
    true,
  );
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

test("dead-code detection does not flag reachable code after a conditional return", () => {
  const source = `function render(enabled) {
  if (!enabled) return null;
  const title = "Portfolio";
  return title;
}`;
  const result = scanText(source, "component.jsx", {
    rules: { "dead-code": true },
  });

  assert.equal(
    result.findings.some((finding) => finding.rule === "dead-code"),
    false,
  );
});

test("dead-code findings point to the first unreachable statement", () => {
  const source = `function render() {
  return null;
  const unreachable = true;
}`;
  const result = scanText(source, "dead-code.js", {
    rules: { "dead-code": true },
  });
  const finding = result.findings.find((item) => item.rule === "dead-code");

  assert.equal(finding?.line, 3);
  assert.equal(finding?.severity, "WARNING");
  assert.equal(finding?.fixable, false);
});

test("unused-variable analysis ignores strings and respects lexical bindings", () => {
  const source = `
    const token = 42;
    const text = "token";
    const shadowed = 1;
    function read(shadowed) {
      return shadowed;
    }
    const used = 3;
    function getUsed() {
      return used;
    }
  `;
  const result = scanText(source, "unused-variables.js", {
    rules: { "unused-variables": true },
  });
  const unusedNames = result.findings
    .filter((finding) => finding.rule === "unused-variables")
    .map((finding) => finding.message.match(/'([^']+)'/)?.[1]);

  assert.ok(unusedNames.includes("token"));
  assert.ok(unusedNames.includes("text"));
  assert.ok(unusedNames.includes("shadowed"));
  assert.ok(!unusedNames.includes("used"));
  assert.equal(
    result.findings.every((finding) => !finding.fixable),
    true,
  );
});

test("unused-variable analysis handles destructuring by binding", () => {
  const source = `const { unused, used } = values;\nvoid used;`;
  const result = scanText(source, "destructured-variables.ts", {
    rules: { "unused-variables": true },
  });
  const unusedNames = result.findings
    .filter((finding) => finding.rule === "unused-variables")
    .map((finding) => finding.message.match(/'([^']+)'/)?.[1]);

  assert.deepEqual(unusedNames, ["unused"]);
});

test("unused-variable analysis keeps exported bindings for external consumers", () => {
  const result = scanText(
    `export const bootLines = ["ready"];\nexport function start() { return bootLines; }`,
    "src/data/terminal.js",
    { rules: { "unused-variables": true } },
  );

  assert.equal(
    result.findings.some((finding) => finding.rule === "unused-variables"),
    false,
  );
});

test("unused-parameter analysis handles callbacks and shadowing", () => {
  const source = `
    function greet(name) { return "name"; }
    function outer(value) {
      function nested(value) { return value; }
      return 2;
    }
    const used = (item) => item + 1;
    [1, 2].map((entry) => entry + 1);
  `;
  const result = scanText(source, "unused-parameters.ts", {
    rules: { "unused-parameters": true },
  });
  const unusedNames = result.findings
    .filter((finding) => finding.rule === "unused-parameters")
    .map((finding) => finding.message.match(/'([^']+)'/)?.[1]);

  assert.ok(unusedNames.includes("name"));
  assert.ok(unusedNames.includes("value"));
  assert.ok(!unusedNames.includes("item"));
  assert.ok(!unusedNames.includes("entry"));
  assert.equal(
    result.findings.every((finding) => !finding.fixable),
    true,
  );
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

test("project analysis resolves cross-file imports, re-exports, and path aliases", async () => {
  const projectDir = await mkdtemp(
    path.join(tmpdir(), "cleaner-project-graph-"),
  );
  await mkdir(path.join(projectDir, "src", "lib"), { recursive: true });
  await writeFile(
    path.join(projectDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        baseUrl: ".",
        paths: { "@lib/*": ["src/lib/*"] },
      },
      include: ["src/**/*.ts"],
    }),
  );
  await writeFile(
    path.join(projectDir, "src", "lib", "foo.ts"),
    `export function foo() { return 1; }\nexport function unusedExport() { return 2; }\nfunction privateUnused() { return 3; }\n`,
  );
  await writeFile(
    path.join(projectDir, "src", "index.ts"),
    `export { foo as sharedFoo } from "@lib/foo";\n`,
  );
  await writeFile(
    path.join(projectDir, "src", "consumer.ts"),
    `import { sharedFoo } from "./index.js";\nexport const result = sharedFoo();\n`,
  );

  const result = await analyzeProject(projectDir);
  const unusedImport = result.findings.find(
    (finding) =>
      finding.category === "unused-imports" &&
      finding.locations.some((location) => location.path === "src/consumer.ts"),
  );
  const unusedExport = result.findings.find(
    (finding) =>
      finding.category === "unused-exports" &&
      finding.message.includes("unusedExport"),
  );
  const privateFunction = result.findings.find(
    (finding) =>
      finding.category === "unused-functions" &&
      finding.message.includes("privateUnused"),
  );

  assert.equal(result.project.files.length, 3);
  assert.equal(result.project.graph.modules.length, 3);
  assert.ok(
    result.project.graph.dependencies.some(
      (edge) =>
        edge.specifier === "@lib/foo" &&
        edge.resolution === "resolved-project" &&
        edge.toModuleId !== undefined,
    ),
  );
  assert.ok(
    result.project.graph.references.some(
      (reference) =>
        reference.fileId ===
          result.project.files.find(
            (file) => file.relativePath === "src/consumer.ts",
          )?.id && reference.kind === "value",
    ),
  );
  assert.equal(unusedImport, undefined);
  assert.ok(unusedExport);
  assert.ok(privateFunction);
});

test("project analysis reports source syntax failures with locations", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-syntax-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "broken.ts"),
    "const broken = ;\n",
  );

  const result = await analyzeProject(projectDir);
  const syntaxFinding = result.findings.find(
    (finding) => finding.category === "syntax",
  );

  assert.equal(syntaxFinding?.severity, "ERROR");
  assert.equal(syntaxFinding?.locations[0]?.path, "src/broken.ts");
  assert.equal(syntaxFinding?.evidence[0]?.kind, "STATIC");
});

test("invalid transformation plans fail validation without changing originals", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cleaner-validation-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  const sourcePath = path.join(projectDir, "src", "value.ts");
  const source = "const value = 1;\n";
  await writeFile(sourcePath, source);

  const analysis = await analyzeProject(projectDir, {
    rules: { "unused-imports": false, "unused-variables": false },
  });
  const file = analysis.project.files.find(
    (projectFile) => projectFile.relativePath === "src/value.ts",
  );
  assert.ok(file);

  const start = source.indexOf("1");
  const result = await validateTransformationPlan(projectDir, {
    id: "invalid-edit-test",
    findingIds: [],
    risk: "LOW",
    edits: [
      {
        fileId: file.id,
        path: file.relativePath,
        expectedContentHash: file.contentHash,
        start,
        end: start + 1,
        replacement: ";",
      },
    ],
    preview: "invalid edit",
  });

  assert.equal(result.status, "FAILED");
  assert.equal(
    result.steps.some(
      (step) => step.name === "syntax" && step.status === "FAILED",
    ),
    true,
  );
  assert.equal(await readFile(sourcePath, "utf8"), source);
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
  assert.match(
    output,
    /Diff preview only\. No files were changed or written\./,
  );
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
