import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import ts from "typescript";

import { loadProjectInputs, type LoadedProject } from "./project-loader.js";
import type { CleanerConfig } from "../config/config.js";
import type {
  Project,
  ProjectCall,
  ProjectDependency,
  ProjectFile,
  ProjectFunction,
  ProjectGraph,
  ProjectModule,
  ProjectReference,
  ProjectSymbol,
  SourceLocation,
} from "./types.js";

export { collectProjectFiles } from "./project-loader.js";

export interface ProjectAnalysisContext {
  sessionId: string;
  project: Project;
  config: CleanerConfig;
  compilerOptions: ts.CompilerOptions;
  program: ts.Program;
  sourceFiles: Map<string, ts.SourceFile>;
  sourceFilesById: Map<string, ts.SourceFile>;
}

export async function loadProjectAnalysis(
  rootDir: string,
  overrides: Partial<LoadedProject["config"]> = {},
): Promise<ProjectAnalysisContext> {
  const loaded = await loadProjectInputs(rootDir, overrides);
  const graph = buildProjectGraph(loaded.files, loaded.sourceFiles, loaded.program);
  const id = stableId("project", loaded.root);
  const project: Project = {
    id,
    root: loaded.root,
    tsconfigPath: loaded.tsconfigPath,
    rules: loaded.config.rules,
    ignore: loaded.config.ignore,
    files: loaded.files,
    graph,
    configDiagnostics: loaded.configDiagnostics,
  };

  return {
    sessionId: randomUUID(),
    project,
    config: loaded.config,
    compilerOptions: loaded.compilerOptions,
    program: loaded.program,
    sourceFiles: loaded.sourceFiles,
    sourceFilesById: loaded.sourceFilesById,
  };
}

function buildProjectGraph(
  files: ProjectFile[],
  sourceFiles: Map<string, ts.SourceFile>,
  program: ts.Program,
): ProjectGraph {
  const checker = program.getTypeChecker();
  const fileByPath = new Map(files.map((file) => [pathKey(file.path), file]));
  const moduleByFile = new Map(
    files.map((file) => [file.id, stableId("module", file.id)]),
  );
  const modules: ProjectModule[] = files.map((file) => ({
    id: moduleByFile.get(file.id)!,
    fileId: file.id,
    importNames: [],
    exportNames: [],
  }));
  const moduleById = new Map(modules.map((item) => [item.id, item]));
  const symbolsByTsSymbol = new Map<ts.Symbol, ProjectSymbol>();
  const functionsByTsSymbol = new Map<ts.Symbol, ProjectFunction>();
  const references: ProjectReference[] = [];
  const dependencies: ProjectDependency[] = [];
  const calls: ProjectCall[] = [];
  const functionsById = new Map<string, ProjectFunction>();

  const sourceLocation = (node: ts.Node, file: ProjectFile): SourceLocation => {
    const start = node.getStart();
    const position = node.getSourceFile().getLineAndCharacterOfPosition(start);
    return {
      fileId: file.id,
      path: file.relativePath,
      start,
      end: node.end,
      line: position.line + 1,
      column: position.character + 1,
    };
  };

  const resolveAlias = (symbol: ts.Symbol): ts.Symbol => {
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      try {
        return checker.getAliasedSymbol(symbol);
      } catch {
        return symbol;
      }
    }
    return symbol;
  };

  const declarationFor = (symbol: ts.Symbol): ts.Declaration | undefined =>
    symbol.valueDeclaration ?? symbol.declarations?.[0];

  const symbolIdFor = (symbol: ts.Symbol): string | undefined => {
    const declaration = declarationFor(symbol);
    if (!declaration) return undefined;
    const declarationFile = fileByPath.get(
      pathKey(declaration.getSourceFile().fileName),
    );
    if (!declarationFile) return undefined;
    const declarationName = (declaration as ts.NamedDeclaration).name;
    const start = declarationName?.getStart() ?? declaration.getStart();
    return stableId(
      "symbol",
      `${declarationFile.id}:${start}:${symbol.getName()}`,
    );
  };

  const addSymbol = (
    symbol: ts.Symbol,
    fallbackFile: ProjectFile,
    fallbackNode: ts.Node,
    exported = false,
  ): ProjectSymbol | undefined => {
    const declaration = declarationFor(symbol);
    const declarationFile = declaration
      ? fileByPath.get(pathKey(declaration.getSourceFile().fileName))
      : undefined;
    const file = declarationFile ?? fallbackFile;
    const locationNode = declaration ?? fallbackNode;
    const id =
      symbolIdFor(symbol) ??
      stableId(
        "symbol",
        `${file.id}:${locationNode.getStart()}:${symbol.getName()}`,
      );
    const current = symbolsByTsSymbol.get(symbol);
    if (current) {
      if (exported) current.exported = true;
      return current;
    }
    const value: ProjectSymbol = {
      id,
      fileId: file.id,
      scopeId: findScopeId(locationNode, file),
      name: symbol.getName(),
      kind: symbolKind(symbol, declaration),
      exported,
      location: sourceLocation(locationNode, file),
    };
    symbolsByTsSymbol.set(symbol, value);
    return value;
  };

  const addDependency = (
    specifier: string,
    node: ts.Node,
    sourceFile: ts.SourceFile,
    file: ProjectFile,
    kind: ProjectDependency["kind"],
  ): void => {
    const resolved = ts.resolveModuleName(
      specifier,
      sourceFile.fileName,
      program.getCompilerOptions(),
      ts.sys,
    ).resolvedModule?.resolvedFileName;
    const targetFile = resolved ? fileByPath.get(pathKey(resolved)) : undefined;
    dependencies.push({
      id: stableId("dependency", `${file.id}:${node.getStart()}:${specifier}`),
      fromModuleId: moduleByFile.get(file.id)!,
      specifier,
      toModuleId: targetFile ? moduleByFile.get(targetFile.id) : undefined,
      kind,
      resolution: targetFile
        ? "resolved-project"
        : resolved
          ? "resolved-external"
          : "unresolved",
      location: sourceLocation(node, file),
    });
  };

  for (const [key, sourceFile] of sourceFiles) {
    const file = fileByPath.get(key);
    if (!file) continue;
    const module = moduleById.get(moduleByFile.get(file.id)!)!;

    const sourceModuleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (sourceModuleSymbol) {
      for (const exported of checker.getExportsOfModule(sourceModuleSymbol)) {
        const target = resolveAlias(exported);
        const descriptor = addSymbol(target, file, sourceFile, true);
        if (descriptor && !module.exportNames.includes(exported.getName())) {
          module.exportNames.push(exported.getName());
        }
      }
    }

    const visit = (node: ts.Node, currentFunctionId?: string): void => {
      let localFunctionId = currentFunctionId;
      if (ts.isFunctionLike(node)) {
        const functionSymbol = node.name
          ? checker.getSymbolAtLocation(node.name)
          : ts.isVariableDeclaration(node.parent)
            ? checker.getSymbolAtLocation(node.parent.name)
            : undefined;
        const symbolNode = functionSymbol
          ? addSymbol(functionSymbol, file, node)
          : undefined;
        localFunctionId = stableId(
          "function",
          `${file.id}:${node.getStart()}:${symbolNode?.id ?? "anonymous"}`,
        );
        const record: ProjectFunction = {
          id: localFunctionId,
          symbolId: symbolNode?.id,
          fileId: file.id,
          name: symbolNode?.name ?? "<anonymous>",
          parameterSymbolIds: node.parameters.flatMap((parameter) => {
            if (!ts.isIdentifier(parameter.name)) return [];
            const parameterSymbol = checker.getSymbolAtLocation(parameter.name);
            const descriptor = parameterSymbol
              ? addSymbol(parameterSymbol, file, parameter.name)
              : undefined;
            return descriptor ? [descriptor.id] : [];
          }),
          location: sourceLocation(node, file),
        };
        functionsById.set(record.id, record);
        if (functionSymbol) functionsByTsSymbol.set(functionSymbol, record);
      }

      if (ts.isImportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (ts.isStringLiteral(specifier)) {
          addDependency(specifier.text, node, sourceFile, file, "import");
          const importClause = node.importClause;
          if (importClause?.name) module.importNames.push("default");
          if (importClause?.namedBindings) {
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              module.importNames.push("*");
            } else {
              module.importNames.push(
                ...importClause.namedBindings.elements.map(
                  (element) => element.propertyName?.text ?? element.name.text,
                ),
              );
            }
          }
          for (const binding of getImportBindings(importClause)) {
            const symbol = checker.getSymbolAtLocation(binding);
            if (symbol) addSymbol(symbol, file, binding);
          }
        }
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        addDependency(
          node.moduleSpecifier.text,
          node,
          sourceFile,
          file,
          "re-export",
        );
      } else if (ts.isCallExpression(node)) {
        const dynamicSpecifier =
          node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : ts.isIdentifier(node.expression) &&
                node.expression.text === "require"
              ? node.arguments[0]
              : undefined;
        if (dynamicSpecifier && ts.isStringLiteralLike(dynamicSpecifier)) {
          addDependency(
            dynamicSpecifier.text,
            node,
            sourceFile,
            file,
            node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? "dynamic-import"
              : "require",
          );
        }

        const calleeSymbol = checker.getSymbolAtLocation(node.expression);
        const canonicalCallee = calleeSymbol
          ? resolveAlias(calleeSymbol)
          : undefined;
        const calleeId = canonicalCallee
          ? symbolIdFor(canonicalCallee)
          : undefined;
        calls.push({
          id: stableId("call", `${file.id}:${node.getStart()}`),
          callerFunctionId: localFunctionId,
          calleeName: node.expression.getText(sourceFile),
          resolution: "unresolved",
          targetSymbolId: calleeId,
          location: sourceLocation(node, file),
        });
      }

      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) {
          const declarationName = symbol.declarations?.some(
            (declaration) => (declaration as ts.NamedDeclaration).name === node,
          );
          if (declarationName) {
            addSymbol(symbol, file, node);
          } else {
            const canonical = resolveAlias(symbol);
            const target = addSymbol(canonical, file, node);
            const referenceKind = isTypePosition(node) ? "type" : "value";
            if (target) {
              references.push({
                id: stableId(
                  "reference",
                  `${file.id}:${node.getStart()}:${target.id}`,
                ),
                fileId: file.id,
                targetSymbolId: target.id,
                fromFunctionId: localFunctionId,
                kind: referenceKind,
                location: sourceLocation(node, file),
              });
            }
          }
        }
      }
      ts.forEachChild(node, (child) => visit(child, localFunctionId));
    };
    visit(sourceFile);
  }

  const functions = [...functionsById.values()];
  const functionBySymbolId = new Map(
    functions
      .filter((item) => item.symbolId)
      .map((item) => [item.symbolId!, item]),
  );
  for (const call of calls) {
    const target = call.targetSymbolId
      ? functionBySymbolId.get(call.targetSymbolId)
      : undefined;
    if (target) {
      call.calleeFunctionId = target.id;
      call.resolution = "resolved";
    }
  }
  return {
    files,
    modules,
    symbols: [...symbolsByTsSymbol.values()],
    references,
    functions,
    dependencies,
    calls,
  };
}

function getImportBindings(
  clause: ts.ImportClause | undefined,
): ts.Identifier[] {
  if (!clause) return [];
  const bindings: ts.Identifier[] = [];
  if (clause.name) bindings.push(clause.name);
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push(clause.namedBindings.name);
    } else {
      bindings.push(
        ...clause.namedBindings.elements.map((element) => element.name),
      );
    }
  }
  return bindings;
}

function findScopeId(node: ts.Node, file: ProjectFile): string {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current) || ts.isBlock(current)) {
      return stableId("scope", `${file.id}:${current.getStart()}`);
    }
    current = current.parent;
  }
  return stableId("scope", `${file.id}:module`);
}

function symbolKind(
  symbol: ts.Symbol,
  declaration: ts.Declaration | undefined,
): ProjectSymbol["kind"] {
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) return "import";
  if (declaration && ts.isParameter(declaration)) return "parameter";
  if (declaration && ts.isClassDeclaration(declaration)) return "class";
  if (declaration && ts.isMethodDeclaration(declaration)) return "method";
  if (declaration && ts.isFunctionDeclaration(declaration)) return "function";
  if (
    symbol.flags &
    (ts.SymbolFlags.Interface |
      ts.SymbolFlags.TypeAlias |
      ts.SymbolFlags.TypeParameter)
  ) {
    return "type";
  }
  if (declaration && ts.isPropertyDeclaration(declaration)) return "property";
  if (declaration && ts.isVariableDeclaration(declaration)) return "variable";
  return "other";
}

function isTypePosition(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (current.parent && !ts.isStatement(current.parent)) {
    current = current.parent;
    if (
      ts.isTypeNode(current) ||
      ts.isTypeQueryNode(current) ||
      ts.isImportTypeNode(current)
    ) {
      return true;
    }
    if (
      ts.isExpression(current) ||
      ts.isStatement(current) ||
      ts.isSourceFile(current)
    ) {
      return false;
    }
  }
  return false;
}

function stableId(kind: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${kind}:${digest}`;
}

function pathKey(candidate: string): string {
  const absolute = path.resolve(candidate);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

