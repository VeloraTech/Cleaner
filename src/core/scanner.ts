import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { Finding, ScanOptions, ScanResult } from "./types.js";

function normalizeRuleName(rule: string): string {
  return rule.replace(/[-_\s]+/g, "-");
}

export function scanText(
  source: string,
  filePath: string,
  options: Partial<ScanOptions> = {},
): ScanResult {
  const findings: Finding[] = [];
  const rules = options.rules ?? {
    "unused-imports": true,
    "unused-variables": true,
    "unused-parameters": true,
    "dead-code": true,
    "dead-files": true,
    console: true,
    debugger: true,
  };

  const normalizedSource = source.toString();
  if (rules["unused-imports"]) {
    findings.push(...findUnusedImports(normalizedSource, filePath));
  }

  if (rules["unused-variables"]) {
    const unusedVariableMatches =
      normalizedSource.match(/const\s+(\w+)\s*=\s*[^;]+;/g) ?? [];
    for (const match of unusedVariableMatches) {
      const variableName = match.match(/const\s+(\w+)/)?.[1];
      if (!variableName) continue;

      const usageCount = normalizedSource.split(variableName).length - 1;
      if (usageCount <= 1) {
        findings.push({
          rule: "unused-variables",
          file: filePath,
          line: 1,
          severity: "WARNING",
          message: `Variable '${variableName}' appears unused.`,
          fixable: false,
        });
      }
    }
  }

  if (rules["unused-parameters"]) {
    const functionMatches =
      normalizedSource.match(/function\s+\w+\s*\(([^)]*)\)/g) ?? [];
    for (const match of functionMatches) {
      const params = match.match(/\(([^)]*)\)/)?.[1]?.split(",") ?? [];
      for (const param of params) {
        const cleanParam = param.trim();
        if (!cleanParam || cleanParam.startsWith("...")) continue;
        const variableName = cleanParam.replace(/:\s*.*$/, "").trim();
        const usageCount = normalizedSource.split(variableName).length - 1;
        if (usageCount <= 1) {
          findings.push({
            rule: "unused-parameters",
            file: filePath,
            line: 1,
            severity: "WARNING",
            message: `Parameter '${variableName}' appears unused.`,
            fixable: false,
          });
        }
      }
    }
  }

  if (rules["dead-code"]) {
    const deadCodeMatches =
      normalizedSource.match(
        /return\s+.*;\s*\n\s*(const|let|var|if|for|while|function|export)/g,
      ) ?? [];
    if (deadCodeMatches.length > 0) {
      findings.push({
        rule: "dead-code",
        file: filePath,
        line: 1,
        severity: "WARNING",
        message:
          "Potential unreachable code detected after an unconditional return.",
        fixable: false,
      });
    }
  }

  if (rules["dead-files"]) {
    const fileIsLegacy =
      filePath.includes("legacy") ||
      filePath.includes("old-") ||
      filePath.includes("deprecated");
    if (fileIsLegacy) {
      findings.push({
        rule: "dead-files",
        file: filePath,
        line: 1,
        severity: "INFO",
        message: "Potential dead file or legacy artifact detected.",
        fixable: false,
      });
    }
  }

  const consoleMatch =
    normalizedSource.match(/console\.(log|debug|info|warn|error)\s*\(/g) ?? [];
  if (consoleMatch.length > 0 && rules.console) {
    findings.push({
      rule: "console",
      file: filePath,
      line: 1,
      severity: "SAFE",
      message: `Console debug call(s) detected: ${consoleMatch.length}.`,
      fixable: true,
      fix: { kind: "remove-statement", text: consoleMatch[0] ?? "" },
    });
  }

  const debuggerMatches = normalizedSource.match(/debugger\s*;/g) ?? [];
  if (debuggerMatches.length > 0 && rules.debugger) {
    findings.push({
      rule: "debugger",
      file: filePath,
      line: 1,
      severity: "SAFE",
      message: "Debugger statement found.",
      fixable: true,
      fix: { kind: "remove-statement", text: debuggerMatches[0] ?? "" },
    });
  }

  return { filesScanned: 1, findings };
}

function findUnusedImports(source: string, filePath: string): Finding[] {
  const absolutePath = path.resolve(filePath || "cleaner-input.ts");
  const scriptKind = getScriptKind(absolutePath);
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
    jsx: ts.JsxEmit.Preserve,
  };
  const host = ts.createCompilerHost(compilerOptions);
  const normalizedFileName = path.normalize(absolutePath);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.getSourceFile = (
    name,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) =>
    path.normalize(name) === normalizedFileName
      ? sourceFile
      : originalGetSourceFile(
          name,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );
  host.fileExists = (name) =>
    path.normalize(name) === normalizedFileName || originalFileExists(name);
  host.readFile = (name) =>
    path.normalize(name) === normalizedFileName
      ? source
      : originalReadFile(name);

  const program = ts.createProgram([absolutePath], compilerOptions, host);
  const hasSyntaxErrors =
    program.getSyntacticDiagnostics(sourceFile).length > 0;

  const checker = program.getTypeChecker();
  const referencedSymbols = new Set<ts.Symbol>();
  const visitReferences = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isShorthandPropertyAssignment(node)) {
      const symbol = checker.getShorthandAssignmentValueSymbol(node);
      if (symbol) referencedSymbols.add(symbol);
    }
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) referencedSymbols.add(symbol);
    }
    ts.forEachChild(node, visitReferences);
  };
  visitReferences(sourceFile);

  const findings: Finding[] = [];
  const visitImports = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!clause) return;

      const bindings: ts.Identifier[] = [];
      if (clause.name) bindings.push(clause.name);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          bindings.push(clause.namedBindings.name);
        } else {
          bindings.push(
            ...clause.namedBindings.elements.map((item) => item.name),
          );
        }
      }

      const bindingSymbols = bindings.map((binding) =>
        checker.getSymbolAtLocation(binding),
      );
      const analysisUncertain =
        hasSyntaxErrors ||
        bindingSymbols.some((symbol) => symbol === undefined);
      const provenUnused =
        !analysisUncertain &&
        bindingSymbols.length > 0 &&
        bindingSymbols.every(
          (symbol): symbol is ts.Symbol =>
            symbol !== undefined && !referencedSymbols.has(symbol),
        );

      if (analysisUncertain) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;
        findings.push({
          rule: "unused-imports",
          file: filePath,
          line,
          severity: "WARNING",
          message:
            "Could not prove this import is unused. Keeping it unchanged.",
          fixable: false,
        });
      } else if (provenUnused) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;
        findings.push({
          rule: "unused-imports",
          file: filePath,
          line,
          severity: "SAFE",
          message: `Imported binding${bindings.length === 1 ? "" : "s"} '${bindings.map((binding) => binding.text).join(", ")}' has no references in this file.`,
          fixable: true,
          fix: {
            kind: "remove-import",
            text: node.getText(sourceFile),
            start: node.getStart(sourceFile),
            end: node.end,
          },
        });
      }
      return;
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(sourceFile);
  return findings;
}

function getScriptKind(filePath: string): ts.ScriptKind {
  switch (path.extname(filePath).toLowerCase()) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

export async function scanProject(
  rootDir: string,
  options: Partial<ScanOptions> = {},
): Promise<ScanResult> {
  const rules = options.rules ?? {
    "unused-imports": true,
    "unused-variables": true,
    "unused-parameters": true,
    "dead-code": true,
    "dead-files": true,
    console: true,
    debugger: true,
  };

  const ignore = options.ignore ?? [
    "node_modules/**",
    "dist/**",
    "coverage/**",
  ];
  const files = await collectProjectFiles(rootDir, ignore);
  const findings: Finding[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const scanned = scanText(content, path.relative(rootDir, file), {
      rules: normalizeRules(rules),
      ignore,
    });
    findings.push(...scanned.findings);
  }

  return {
    filesScanned: files.length,
    findings,
  };
}

export async function collectProjectFiles(
  rootDir: string,
  ignore: string[] = ["node_modules/**", "dist/**", "coverage/**"],
): Promise<string[]> {
  const queue = [rootDir];
  const files: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const relativePath = path
        .relative(rootDir, entryPath)
        .split(path.sep)
        .join("/");
      if (
        ignore.some((pattern) => matchesIgnorePattern(relativePath, pattern))
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        if (
          ["node_modules", ".git", "dist", "build", "coverage"].includes(
            entry.name,
          )
        ) {
          continue;
        }
        queue.push(entryPath);
      } else if (
        entry.name.endsWith(".js") ||
        entry.name.endsWith(".ts") ||
        entry.name.endsWith(".jsx") ||
        entry.name.endsWith(".tsx")
      ) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function matchesIgnorePattern(relativePath: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, "/");
  if (normalized.endsWith("/**")) {
    const prefix = normalized.slice(0, -3);
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  }
  return (
    relativePath === normalized || relativePath.startsWith(`${normalized}/`)
  );
}

function normalizeRules(
  rules: Record<string, boolean>,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(rules).map(([key, value]) => [
      normalizeRuleName(key),
      value,
    ]),
  );
}
