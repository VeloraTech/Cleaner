import test from "node:test";
import assert from "node:assert/strict";

import { scanText, scanProject } from "../src/core/scanner.js";

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
    fs.mkdtemp("cleaner-test-"),
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
