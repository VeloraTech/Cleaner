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
  const semanticContext =
    rules["unused-imports"] ||
    rules["unused-variables"] ||
    rules["unused-parameters"] ||
    rules.console ||
    rules["dead-code"]
      ? createSemanticContext(normalizedSource, filePath)
      : undefined;
  if (rules["unused-imports"]) {
    findings.push(...findUnusedImports(semanticContext!, filePath));
  }

  if (rules["unused-variables"]) {
    findings.push(...findUnusedVariables(semanticContext!, filePath));
  }

  if (rules["unused-parameters"]) {
    findings.push(...findUnusedParameters(semanticContext!, filePath));
  }

  if (rules.console) {
    findings.push(
      ...findConsoleStatements(
        semanticContext!.sourceFile,
        semanticContext!.hasSyntaxErrors,
        filePath,
      ),
    );
  }

  if (rules["dead-code"]) {
    findings.push(...findDeadCode(semanticContext!, filePath));
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

function findConsoleStatements(
  sourceFile: ts.SourceFile,
  hasSyntaxErrors: boolean,
  filePath: string,
): Finding[] {
  if (hasSyntaxErrors) return [];
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "console" &&
      ["log", "debug", "info", "warn", "error"].includes(
        node.expression.name.text,
      )
    ) {
      const statement =
        ts.isExpressionStatement(node.parent) && node.parent.expression === node
          ? node.parent
          : undefined;
      const safeParent =
        statement &&
        (ts.isBlock(statement.parent) ||
          ts.isSourceFile(statement.parent) ||
          ts.isCaseClause(statement.parent) ||
          ts.isDefaultClause(statement.parent));
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;

      findings.push({
        rule: "console",
        file: filePath,
        line,
        severity: safeParent ? "SAFE" : "WARNING",
        message: safeParent
          ? "Standalone console debug call can be removed safely."
          : "Console call is embedded in a context Cleaner cannot safely remove; keeping it unchanged.",
        fixable: Boolean(safeParent),
        ...(safeParent && statement
          ? {
              fix: {
                kind: "remove-statement" as const,
                text: statement.getText(sourceFile),
                start: statement.getStart(sourceFile),
                end: statement.end,
              },
            }
          : {}),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function findDeadCode(context: SemanticContext, filePath: string): Finding[] {
  if (context.hasSyntaxErrors) return [];
  const findings: Finding[] = [];

  const visitStatementList = (statements: ts.NodeArray<ts.Statement>): void => {
    let terminated = false;
    for (const statement of statements) {
      if (terminated) {
        const line =
          context.sourceFile.getLineAndCharacterOfPosition(
            statement.getStart(context.sourceFile),
          ).line + 1;
        findings.push({
          rule: "dead-code",
          file: filePath,
          line,
          severity: "WARNING",
          message:
            "Potential unreachable statement follows an unconditional return, throw, break, or continue.",
          fixable: false,
        });
        return;
      }

      visit(statement);
      terminated =
        ts.isReturnStatement(statement) ||
        ts.isThrowStatement(statement) ||
        ts.isBreakStatement(statement) ||
        ts.isContinueStatement(statement);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isSourceFile(node) || ts.isBlock(node)) {
      visitStatementList(node.statements);
      return;
    }
    if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      visitStatementList(node.statements);
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(context.sourceFile);
  return findings;
}

interface SemanticContext {
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  hasSyntaxErrors: boolean;
  referencedSymbols: Set<ts.Symbol>;
}

function createSemanticContext(
  source: string,
  filePath: string,
): SemanticContext {
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
  const checker = program.getTypeChecker();
  return {
    sourceFile,
    checker,
    hasSyntaxErrors: program.getSyntacticDiagnostics(sourceFile).length > 0,
    referencedSymbols: collectReferencedSymbols(sourceFile, checker),
  };
}

function collectReferencedSymbols(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): Set<ts.Symbol> {
  const referencedSymbols = new Set<ts.Symbol>();
  const visitReferences = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isShorthandPropertyAssignment(node)) {
      const symbol = checker.getShorthandAssignmentValueSymbol(node);
      if (symbol) referencedSymbols.add(symbol);
    }
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const isDeclaration = symbol?.declarations?.some(
        (declaration) => (declaration as ts.NamedDeclaration).name === node,
      );
      if (symbol && !isDeclaration) referencedSymbols.add(symbol);
    }
    ts.forEachChild(node, visitReferences);
  };
  visitReferences(sourceFile);
  return referencedSymbols;
}

function findUnusedImports(
  context: SemanticContext,
  filePath: string,
): Finding[] {
  const { sourceFile, checker, hasSyntaxErrors } = context;
  const { referencedSymbols } = context;

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

function findUnusedVariables(
  context: SemanticContext,
  filePath: string,
): Finding[] {
  if (context.hasSyntaxErrors) return [];
  const { referencedSymbols } = context;
  const findings: Finding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      for (const binding of getBindingIdentifiers(node.name)) {
        addUnusedBindingFinding(
          context,
          referencedSymbols,
          binding,
          filePath,
          "unused-variables",
          "Variable",
          findings,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  return findings;
}

function findUnusedParameters(
  context: SemanticContext,
  filePath: string,
): Finding[] {
  if (context.hasSyntaxErrors) return [];
  const { referencedSymbols } = context;
  const findings: Finding[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isParameter(node) &&
      ts.isFunctionLike(node.parent) &&
      "body" in node.parent &&
      node.parent.body !== undefined
    ) {
      for (const binding of getBindingIdentifiers(node.name)) {
        if (binding.text === "this") continue;
        addUnusedBindingFinding(
          context,
          referencedSymbols,
          binding,
          filePath,
          "unused-parameters",
          "Parameter",
          findings,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  return findings;
}

function getBindingIdentifiers(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  const identifiers: ts.Identifier[] = [];
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      identifiers.push(...getBindingIdentifiers(element.name));
    }
  }
  return identifiers;
}

function addUnusedBindingFinding(
  context: SemanticContext,
  referencedSymbols: Set<ts.Symbol>,
  binding: ts.Identifier,
  filePath: string,
  rule: "unused-variables" | "unused-parameters",
  label: "Variable" | "Parameter",
  findings: Finding[],
): void {
  const symbol = context.checker.getSymbolAtLocation(binding);
  if (
    !symbol ||
    referencedSymbols.has(symbol) ||
    (rule === "unused-variables" && isExportedSymbol(symbol))
  ) {
    return;
  }

  const line =
    context.sourceFile.getLineAndCharacterOfPosition(
      binding.getStart(context.sourceFile),
    ).line + 1;
  findings.push({
    rule,
    file: filePath,
    line,
    severity: "WARNING",
    message: `${label} '${binding.text}' appears unused.`,
    fixable: false,
  });
}

function isExportedSymbol(symbol: ts.Symbol): boolean {
  return (
    symbol.declarations?.some((declaration) => {
      let current: ts.Node | undefined = declaration;
      while (current && !ts.isSourceFile(current)) {
        if (
          ts.canHaveModifiers(current) &&
          ts
            .getModifiers(current)
            ?.some(
              (modifier) =>
                modifier.kind === ts.SyntaxKind.ExportKeyword ||
                modifier.kind === ts.SyntaxKind.DefaultKeyword,
            )
        ) {
          return true;
        }
        current = current.parent;
      }
      return false;
    }) ?? false
  );
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
    const relativeFile = path
      .relative(rootDir, file)
      .split(path.sep)
      .join("/");
    const scanned = scanText(content, relativeFile, {
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
