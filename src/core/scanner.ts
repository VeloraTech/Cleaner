import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

import {
  collectProjectFiles,
  loadProjectAnalysis,
  type ProjectAnalysisContext,
} from "./project-analysis.js";
import type {
  Confidence,
  Evidence,
  EvidenceFinding,
  Finding,
  ProjectAnalysisResult,
  ProjectFile,
  ProjectGraph,
  RuleId,
  ScanOptions,
  ScanResult,
  SourceLocation,
} from "./types.js";

export { collectProjectFiles } from "./project-analysis.js";

function normalizeRuleName(rule: string): string {
  return rule.replace(/[-_\s]+/g, "-");
}

interface SemanticContext {
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  hasSyntaxErrors: boolean;
  referencedSymbols: Set<ts.Symbol>;
}

interface FileAnalyzerContext {
  filePath: string;
  sourceFile: ts.SourceFile;
  semantic: SemanticContext;
}

interface FileAnalyzer {
  rule: RuleId;
  analyze(context: FileAnalyzerContext): Finding[];
}

interface ProjectAnalyzer {
  rule: RuleId;
  analyze(context: ProjectAnalysisContext): Finding[];
}

const fileAnalyzers: FileAnalyzer[] = [
  {
    rule: "unused-imports",
    analyze: ({ filePath, semantic }) => findUnusedImports(semantic, filePath),
  },
  {
    rule: "unused-variables",
    analyze: ({ filePath, semantic }) =>
      findUnusedVariables(semantic, filePath),
  },
  {
    rule: "unused-parameters",
    analyze: ({ filePath, semantic }) =>
      findUnusedParameters(semantic, filePath),
  },
  {
    rule: "console",
    analyze: ({ filePath, semantic }) =>
      findConsoleStatements(semantic, filePath),
  },
  {
    rule: "debugger",
    analyze: ({ filePath, semantic }) =>
      findDebuggerStatements(semantic, filePath),
  },
  {
    rule: "dead-code",
    analyze: ({ filePath, semantic }) => findDeadCode(semantic, filePath),
  },
  {
    rule: "dead-files",
    analyze: ({ filePath }) => findLegacyFile(filePath),
  },
];

const projectAnalyzers: ProjectAnalyzer[] = [
  {
    rule: "unused-functions",
    analyze: ({ project }) => findUnusedFunctions(project.graph, project.files),
  },
  {
    rule: "unused-exports",
    analyze: ({ project }) => findUnusedExports(project.graph, project.files),
  },
];

export function scanText(
  source: string,
  filePath: string,
  options: Partial<ScanOptions> = {},
): ScanResult {
  const rules = options.rules ?? {
    "unused-imports": true,
    "unused-variables": true,
    "unused-parameters": true,
    console: true,
    debugger: true,
    "dead-code": true,
    "dead-files": true,
  };
  const sourceFile = createSourceFile(source, filePath);
  const program = createSingleFileProgram(sourceFile, source);
  const semantic = createSemanticContext(sourceFile, program);
  return {
    filesScanned: 1,
    findings: analyzeFile(sourceFile.fileName, semantic, rules),
  };
}

function createSourceFile(source: string, filePath: string): ts.SourceFile {
  const absolutePath = path.resolve(filePath || "cleaner-input.ts");
  return ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(absolutePath),
  );
}

function createSingleFileProgram(
  sourceFile: ts.SourceFile,
  source: string,
): ts.Program {
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
  const fileName = path.normalize(sourceFile.fileName);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, fresh) =>
    path.normalize(name) === fileName
      ? sourceFile
      : originalGetSourceFile(name, languageVersion, onError, fresh);
  host.fileExists = (name) =>
    path.normalize(name) === fileName || originalFileExists(name);
  host.readFile = (name) =>
    path.normalize(name) === fileName ? source : originalReadFile(name);
  return ts.createProgram([sourceFile.fileName], compilerOptions, host);
}

function createSemanticContext(
  sourceFile: ts.SourceFile,
  program: ts.Program,
): SemanticContext {
  const checker = program.getTypeChecker();
  return {
    sourceFile,
    checker,
    hasSyntaxErrors: program.getSyntacticDiagnostics(sourceFile).length > 0,
    referencedSymbols: collectReferencedSymbols(sourceFile, checker),
  };
}

export async function analyzeProject(
  rootDir: string,
  options: Partial<ScanOptions> = {},
): Promise<ProjectAnalysisResult> {
  const context = await loadProjectAnalysis(rootDir, {
    rules: options.rules,
    ignore: options.ignore,
  });
  const rules = normalizeRules(context.config.rules);
  const rawFindings: Finding[] = [];
  const fileById = new Map(
    context.project.files.map((file) => [file.id, file]),
  );

  for (const file of context.project.files) {
    const sourceFile = context.sourceFilesById.get(file.id);
    if (!sourceFile) continue;
    const semantic = createSemanticContext(sourceFile, context.program);
    rawFindings.push(...analyzeFile(file.relativePath, semantic, rules));

    if (semantic.hasSyntaxErrors && rules.syntax !== false) {
      for (const diagnostic of context.program.getSyntacticDiagnostics(
        sourceFile,
      )) {
        const position = sourceFile.getLineAndCharacterOfPosition(
          diagnostic.start ?? 0,
        );
        rawFindings.push({
          rule: "syntax",
          file: file.relativePath,
          line: position.line + 1,
          severity: "ERROR",
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
          fixable: false,
        });
      }
    }
  }

  for (const analyzer of projectAnalyzers) {
    if (rules[analyzer.rule] !== false) {
      rawFindings.push(...analyzer.analyze(context));
    }
  }

  for (const message of context.project.configDiagnostics) {
    rawFindings.push({
      rule: "syntax",
      file: context.project.tsconfigPath
        ? path.relative(context.project.root, context.project.tsconfigPath)
        : "tsconfig.json",
      line: 1,
      severity: "ERROR",
      message: `TypeScript configuration: ${message}`,
      fixable: false,
    });
  }

  return {
    sessionId: context.sessionId,
    project: context.project,
    findings: rawFindings.map((finding) =>
      attachStaticEvidence(
        finding,
        context.sessionId,
        fileById,
        context.sourceFilesById,
      ),
    ),
  };
}

export async function scanProject(
  rootDir: string,
  options: Partial<ScanOptions> = {},
): Promise<ScanResult> {
  const analysis = await analyzeProject(rootDir, options);
  return {
    filesScanned: analysis.project.files.length,
    findings: analysis.findings,
  };
}

function analyzeFile(
  filePath: string,
  semantic: SemanticContext,
  rules: Record<string, boolean>,
): Finding[] {
  const context = { filePath, sourceFile: semantic.sourceFile, semantic };
  const findings: Finding[] = [];
  for (const analyzer of fileAnalyzers) {
    if (rules[analyzer.rule] === true) {
      findings.push(...analyzer.analyze(context));
    }
  }
  return findings;
}

function collectReferencedSymbols(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): Set<ts.Symbol> {
  const referencedSymbols = new Set<ts.Symbol>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isShorthandPropertyAssignment(node)) {
      const symbol = checker.getShorthandAssignmentValueSymbol(node);
      if (symbol) referencedSymbols.add(symbol);
    }
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declarationName = symbol?.declarations?.some(
        (declaration) => (declaration as ts.NamedDeclaration).name === node,
      );
      if (symbol && !declarationName) referencedSymbols.add(symbol);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return referencedSymbols;
}

function findConsoleStatements(
  context: SemanticContext,
  filePath: string,
): Finding[] {
  if (context.hasSyntaxErrors) return [];
  const sourceFile = context.sourceFile;
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

function findDebuggerStatements(
  context: SemanticContext,
  filePath: string,
): Finding[] {
  if (context.hasSyntaxErrors) return [];
  const sourceFile = context.sourceFile;
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isDebuggerStatement(node)) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      findings.push({
        rule: "debugger",
        file: filePath,
        line,
        severity: "SAFE",
        message: "Debugger statement found.",
        fixable: true,
        fix: {
          kind: "remove-statement",
          text: node.getText(sourceFile),
          start: node.getStart(sourceFile),
          end: node.end,
        },
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function findDeadCode(context: SemanticContext, filePath: string): Finding[] {
  if (context.hasSyntaxErrors) return [];
  const sourceFile = context.sourceFile;
  const findings: Finding[] = [];
  const visitStatementList = (statements: ts.NodeArray<ts.Statement>): void => {
    let terminated = false;
    for (const statement of statements) {
      if (terminated) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(
            statement.getStart(sourceFile),
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
    if (
      ts.isSourceFile(node) ||
      ts.isBlock(node) ||
      ts.isCaseClause(node) ||
      ts.isDefaultClause(node)
    ) {
      visitStatementList(node.statements);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function findUnusedImports(
  context: SemanticContext,
  filePath: string,
): Finding[] {
  const { sourceFile, checker, hasSyntaxErrors, referencedSymbols } = context;
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (!ts.isImportDeclaration(node)) {
      ts.forEachChild(node, visit);
      return;
    }
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
    const symbols = bindings.map((binding) =>
      checker.getSymbolAtLocation(binding),
    );
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;
    if (hasSyntaxErrors || symbols.some((symbol) => !symbol)) {
      findings.push({
        rule: "unused-imports",
        file: filePath,
        line,
        severity: "WARNING",
        message: "Could not prove this import is unused. Keeping it unchanged.",
        fixable: false,
      });
    } else if (
      symbols.length > 0 &&
      symbols.every((symbol) => symbol && !referencedSymbols.has(symbol))
    ) {
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
  };
  visit(sourceFile);
  return findings;
}

function findUnusedVariables(
  context: SemanticContext,
  filePath: string,
): Finding[] {
  if (context.hasSyntaxErrors) return [];
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      for (const binding of getBindingIdentifiers(node.name)) {
        addUnusedBindingFinding(
          context,
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
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isParameter(node) &&
      ts.isFunctionLike(node.parent) &&
      "body" in node.parent &&
      node.parent.body !== undefined
    ) {
      for (const binding of getBindingIdentifiers(node.name)) {
        if (binding.text !== "this") {
          addUnusedBindingFinding(
            context,
            binding,
            filePath,
            "unused-parameters",
            "Parameter",
            findings,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  return findings;
}

function getBindingIdentifiers(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  const result: ts.Identifier[] = [];
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element))
      result.push(...getBindingIdentifiers(element.name));
  }
  return result;
}

function addUnusedBindingFinding(
  context: SemanticContext,
  binding: ts.Identifier,
  filePath: string,
  rule: "unused-variables" | "unused-parameters",
  label: string,
  findings: Finding[],
): void {
  const symbol = context.checker.getSymbolAtLocation(binding);
  if (
    !symbol ||
    context.referencedSymbols.has(symbol) ||
    (rule === "unused-variables" && isExportedSymbol(symbol))
  )
    return;
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
        )
          return true;
        current = current.parent;
      }
      return false;
    }) ?? false
  );
}

function findLegacyFile(filePath: string): Finding[] {
  const candidate = ["legacy", "old-", "deprecated"].some((token) =>
    filePath.includes(token),
  );
  return candidate
    ? [
        {
          rule: "dead-files",
          file: filePath,
          line: 1,
          severity: "INFO",
          message: "Potential dead file or legacy artifact detected.",
          fixable: false,
        },
      ]
    : [];
}

function findUnusedFunctions(
  graph: ProjectGraph,
  files: ProjectFile[],
): Finding[] {
  const symbols = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const fileById = new Map(files.map((file) => [file.id, file]));
  const findings: Finding[] = [];
  for (const fn of graph.functions) {
    if (!fn.symbolId) continue;
    const symbol = symbols.get(fn.symbolId);
    if (
      !symbol ||
      symbol.exported ||
      !["function", "method"].includes(symbol.kind)
    )
      continue;
    const referencedOutside = graph.references.some(
      (reference) =>
        reference.targetSymbolId === symbol.id &&
        reference.fromFunctionId !== fn.id,
    );
    if (referencedOutside) continue;
    const file = fileById.get(fn.fileId);
    if (file)
      findings.push({
        rule: "unused-functions",
        file: file.relativePath,
        line: fn.location.line,
        severity: "WARNING",
        message: `Function '${fn.name}' has no resolved references in the scanned project. Dynamic or external use is not ruled out.`,
        fixable: false,
      });
  }
  return findings;
}

function findUnusedExports(
  graph: ProjectGraph,
  files: ProjectFile[],
): Finding[] {
  const fileById = new Map(files.map((file) => [file.id, file]));
  const findings: Finding[] = [];
  for (const symbol of graph.symbols) {
    if (!symbol.exported) continue;
    const referencedByProject = graph.references.some(
      (reference) =>
        reference.targetSymbolId === symbol.id &&
        reference.fileId !== symbol.fileId,
    );
    if (referencedByProject) continue;
    const file = fileById.get(symbol.fileId);
    if (file)
      findings.push({
        rule: "unused-exports",
        file: file.relativePath,
        line: symbol.location.line,
        severity: "WARNING",
        message: `Export '${symbol.name}' has no resolved consumer in the scanned project. External consumers are not ruled out.`,
        fixable: false,
      });
  }
  return findings;
}

function attachStaticEvidence(
  finding: Finding,
  sessionId: string,
  fileById: Map<string, ProjectFile>,
  sourceFilesById: Map<string, ts.SourceFile>,
): EvidenceFinding {
  const file = [...fileById.values()].find(
    (item) => item.relativePath === finding.file,
  );
  const sourceFile = file ? sourceFilesById.get(file.id) : undefined;
  const fallbackStart = sourceFile
    ? sourceFile.getPositionOfLineAndCharacter(Math.max(0, finding.line - 1), 0)
    : 0;
  const start = finding.fix?.start ?? fallbackStart;
  const position = sourceFile?.getLineAndCharacterOfPosition(start);
  const location: SourceLocation = {
    fileId: file?.id ?? `file:${finding.file}`,
    path: finding.file,
    start,
    end: finding.fix?.end ?? start,
    line: finding.line,
    column: (position?.character ?? 0) + 1,
  };
  const confidence: Confidence =
    finding.severity === "SAFE" || finding.rule === "syntax"
      ? "HIGH"
      : finding.rule === "unused-exports"
        ? "LOW"
        : "MEDIUM";
  const evidence: Evidence = {
    id: stableEvidenceId(
      sessionId,
      finding.rule,
      finding.file,
      String(finding.line),
    ),
    kind:
      finding.rule === "unused-functions" || finding.rule === "unused-exports"
        ? "DERIVED"
        : "STATIC",
    claim: finding.message,
    location,
    sessionId,
  };
  return {
    ...finding,
    id: stableEvidenceId(
      sessionId,
      "finding",
      finding.rule,
      finding.file,
      String(finding.line),
    ),
    category: finding.rule,
    confidence,
    locations: [location],
    evidence: [evidence],
    fixability: finding.fixable
      ? "SAFE"
      : finding.severity === "WARNING"
        ? "REVIEW"
        : "NONE",
  };
}

function stableEvidenceId(...parts: string[]): string {
  return `evidence:${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16)}`;
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
