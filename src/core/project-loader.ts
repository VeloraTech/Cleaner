import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import { loadConfig, type CleanerConfig } from "../config/config.js";
import type { ProjectFile, SourceLanguage } from "./types.js";

export interface LoadedProject {
  root: string;
  tsconfigPath?: string;
  config: CleanerConfig;
  compilerOptions: ts.CompilerOptions;
  program: ts.Program;
  sourceFiles: Map<string, ts.SourceFile>;
  sourceFilesById: Map<string, ts.SourceFile>;
  files: ProjectFile[];
  configDiagnostics: string[];
}

const supportedExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const ignoredDirectoryNames = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
]);

export async function loadProjectInputs(
  rootDir: string,
  overrides: Partial<CleanerConfig> = {},
): Promise<LoadedProject> {
  const root = await canonicalPath(path.resolve(rootDir));
  const config = await loadConfig(overrides);
  const discoveredPaths = await collectProjectFiles(root, config.ignore);
  const tsconfigPath = ts.findConfigFile(
    root,
    ts.sys.fileExists,
    "tsconfig.json",
  );
  const { compilerOptions, rootNames, configDiagnostics } =
    await loadCompilerConfiguration(root, discoveredPaths, tsconfigPath);
  const program = ts.createProgram(rootNames, compilerOptions);
  const sourceFiles = getProjectSourceFiles(program, rootNames);
  const files = await buildFileRecords(root, sourceFiles, program);
  const fileIdByPath = new Map(
    files.map((file) => [pathKey(file.path), file.id]),
  );
  const sourceFilesById = new Map<string, ts.SourceFile>();
  for (const [filePath, sourceFile] of sourceFiles) {
    const fileId = fileIdByPath.get(filePath);
    if (fileId) sourceFilesById.set(fileId, sourceFile);
  }

  return {
    root,
    tsconfigPath: rootNames.length > 0 ? tsconfigPath : undefined,
    config,
    compilerOptions,
    program,
    sourceFiles,
    sourceFilesById,
    files,
    configDiagnostics,
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
      const relativePath = toPosixPath(path.relative(rootDir, entryPath));
      if (
        ignore.some((pattern) => matchesIgnorePattern(relativePath, pattern))
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) queue.push(entryPath);
        continue;
      }
      if (supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.resolve(entryPath));
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function loadCompilerConfiguration(
  root: string,
  discoveredPaths: string[],
  tsconfigPath: string | undefined,
): Promise<{
  compilerOptions: ts.CompilerOptions;
  rootNames: string[];
  configDiagnostics: string[];
}> {
  const discovered = new Map(
    discoveredPaths.map((file) => [pathKey(file), file]),
  );
  const fallbackOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    noLib: true,
    noResolve: false,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.Preserve,
  };

  if (!tsconfigPath) {
    return {
      compilerOptions: fallbackOptions,
      rootNames: discoveredPaths,
      configDiagnostics: [],
    };
  }

  const configRead = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configRead.error) {
    return {
      compilerOptions: fallbackOptions,
      rootNames: discoveredPaths,
      configDiagnostics: [formatDiagnostic(configRead.error)],
    };
  }

  const parsed = ts.parseJsonConfigFileContent(
    configRead.config,
    ts.sys,
    path.dirname(tsconfigPath),
    { noEmit: true, allowJs: true, checkJs: false, skipLibCheck: true },
    tsconfigPath,
  );
  const configuredNames = parsed.fileNames
    .map((file) => discovered.get(pathKey(file)))
    .filter((file): file is string => file !== undefined);

  if (configuredNames.length === 0 && discoveredPaths.length > 0) {
    return {
      compilerOptions: fallbackOptions,
      rootNames: discoveredPaths,
      configDiagnostics: [],
    };
  }

  return {
    compilerOptions: {
      ...parsed.options,
      allowJs: true,
      noEmit: true,
      noEmitOnError: false,
      incremental: false,
      composite: false,
      skipLibCheck: true,
    },
    rootNames: configuredNames,
    configDiagnostics: parsed.errors.map(formatDiagnostic),
  };
}

function getProjectSourceFiles(
  program: ts.Program,
  rootNames: string[],
): Map<string, ts.SourceFile> {
  const rootKeys = new Set(rootNames.map(pathKey));
  const result = new Map<string, ts.SourceFile>();
  for (const sourceFile of program.getSourceFiles()) {
    const key = pathKey(sourceFile.fileName);
    if (rootKeys.has(key)) result.set(key, sourceFile);
  }
  return result;
}

async function buildFileRecords(
  root: string,
  sourceFiles: Map<string, ts.SourceFile>,
  program: ts.Program,
): Promise<ProjectFile[]> {
  const files: ProjectFile[] = [];
  for (const sourceFile of sourceFiles.values()) {
    const absolutePath = path.resolve(sourceFile.fileName);
    const relativePath = toPosixPath(path.relative(root, absolutePath));
    const content = await fs.readFile(absolutePath);
    const parseErrorCount = program.getSyntacticDiagnostics(sourceFile).length;
    files.push({
      id: stableId("file", relativePath),
      path: absolutePath,
      relativePath,
      language: languageForPath(absolutePath),
      contentHash: createHash("sha256").update(content).digest("hex"),
      parseStatus: parseErrorCount === 0 ? "OK" : "ERROR",
      parseErrorCount,
    });
  }
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function languageForPath(filePath: string): SourceLanguage {
  return /\.[cm]?tsx?$/i.test(filePath) ? "typescript" : "javascript";
}

function stableId(kind: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${kind}:${digest}`;
}

function pathKey(candidate: string): string {
  const absolute = path.resolve(candidate);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function toPosixPath(candidate: string): string {
  return candidate.split(path.sep).join("/");
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

async function canonicalPath(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
