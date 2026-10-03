import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

import { loadProjectAnalysis } from "./project-analysis.js";
import { applyPlanEdits } from "./transformation-plan.js";
import type {
  ScanOptions,
  TransformationPlan,
  ValidationResult,
  ValidationStepResult,
} from "./types.js";

export async function validateTransformationPlan(
  rootDir: string,
  plan: TransformationPlan,
  options: Partial<ScanOptions> = {},
): Promise<ValidationResult> {
  const analysis = await loadProjectAnalysis(rootDir, {
    rules: options.rules,
    ignore: options.ignore,
  });
  const fileById = new Map(
    analysis.project.files.map((file) => [file.id, file]),
  );
  for (const edit of plan.edits) {
    const file = fileById.get(edit.fileId);
    if (!file || file.relativePath !== edit.path) {
      return {
        transformationId: plan.id,
        status: "FAILED",
        steps: [
          {
            name: "staging",
            status: "FAILED",
            message: `Unknown file in transformation plan: ${edit.path}`,
          },
        ],
      };
    }
    if (file.contentHash !== edit.expectedContentHash) {
      return {
        transformationId: plan.id,
        status: "FAILED",
        steps: [
          {
            name: "staging",
            status: "FAILED",
            message: `Source changed after analysis: ${edit.path}`,
          },
        ],
      };
    }
  }
  if (plan.edits.length === 0) {
    return {
      transformationId: plan.id,
      status: "PASSED",
      steps: [
        {
          name: "staging",
          status: "SKIPPED",
          message: "The transformation plan contains no edits.",
        },
        {
          name: "syntax",
          status: "SKIPPED",
          message: "There are no edited files to parse.",
        },
        {
          name: "typescript",
          status: "SKIPPED",
          message: "There are no edited files to typecheck.",
        },
      ],
    };
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cleaner-validation-"),
  );
  const steps: ValidationStepResult[] = [];
  try {
    const editsByFile = new Map<string, TransformationPlan["edits"]>();
    for (const edit of plan.edits) {
      const edits = editsByFile.get(edit.fileId) ?? [];
      edits.push(edit);
      editsByFile.set(edit.fileId, edits);
    }

    const stagedRootNames: string[] = [];
    for (const file of analysis.project.files) {
      const sourceFile = analysis.sourceFilesById.get(file.id);
      if (!sourceFile) continue;
      const edits = editsByFile.get(file.id) ?? [];
      const stagedText = applyPlanEdits(sourceFile.text, edits);
      const stagedPath = path.join(temporaryRoot, file.relativePath);
      await fs.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.writeFile(stagedPath, stagedText, "utf8");
      stagedRootNames.push(stagedPath);
    }
    steps.push({
      name: "staging",
      status: "PASSED",
      message: `Staged ${stagedRootNames.length} source files in a temporary validation workspace.`,
    });

    const originalPackageJson = path.join(
      analysis.project.root,
      "package.json",
    );
    try {
      await fs.copyFile(
        originalPackageJson,
        path.join(temporaryRoot, "package.json"),
      );
    } catch {
      // A package manifest is not required for source parsing or checking.
    }

    const originalNodeModules = path.join(
      analysis.project.root,
      "node_modules",
    );
    try {
      await fs.access(originalNodeModules);
      await fs.symlink(
        originalNodeModules,
        path.join(temporaryRoot, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      // Source syntax validation still works without installed dependencies.
    }

    const compilerOptions = {
      ...analysis.compilerOptions,
      baseUrl: analysis.compilerOptions.baseUrl
        ? rebaseOptionPath(
            analysis.compilerOptions.baseUrl,
            analysis.project.root,
            temporaryRoot,
          )
        : undefined,
      rootDir: analysis.compilerOptions.rootDir
        ? rebaseOptionPath(
            analysis.compilerOptions.rootDir,
            analysis.project.root,
            temporaryRoot,
          )
        : undefined,
      rootDirs: analysis.compilerOptions.rootDirs?.map((root) =>
        rebaseOptionPath(root, analysis.project.root, temporaryRoot),
      ),
      noEmit: true,
      incremental: false,
      composite: false,
    } satisfies ts.CompilerOptions;
    const validationProgram = ts.createProgram(
      stagedRootNames,
      compilerOptions,
    );
    const stagedSourceFiles = validationProgram
      .getSourceFiles()
      .filter((sourceFile) =>
        path
          .resolve(sourceFile.fileName)
          .startsWith(path.resolve(temporaryRoot)),
      );
    const syntaxDiagnostics = stagedSourceFiles.flatMap((sourceFile) =>
      validationProgram.getSyntacticDiagnostics(sourceFile),
    );
    if (syntaxDiagnostics.length > 0) {
      steps.push({
        name: "syntax",
        status: "FAILED",
        message: syntaxDiagnostics
          .slice(0, 5)
          .map((diagnostic) => formatDiagnostic(diagnostic))
          .join("\n"),
      });
      return { transformationId: plan.id, status: "FAILED", steps };
    }
    steps.push({
      name: "syntax",
      status: "PASSED",
      message: `Parsed ${stagedSourceFiles.length} staged source files without syntax errors.`,
    });

    const baselineDiagnostics = await collectProjectSemanticDiagnostics(
      analysis.program,
      analysis.sourceFilesById,
      analysis.project.root,
    );
    const candidateDiagnostics = await collectSemanticDiagnostics(
      validationProgram,
      stagedSourceFiles,
      temporaryRoot,
    );
    const newDiagnostics = candidateDiagnostics.filter(
      (diagnostic) => !baselineDiagnostics.has(diagnostic.key),
    );
    if (newDiagnostics.length > 0) {
      steps.push({
        name: "typescript",
        status: "FAILED",
        message: newDiagnostics
          .slice(0, 5)
          .map((diagnostic) => diagnostic.message)
          .join("\n"),
      });
      return { transformationId: plan.id, status: "FAILED", steps };
    }
    steps.push({
      name: "typescript",
      status: "PASSED",
      message: "No new TypeScript semantic diagnostics were introduced.",
    });
    return { transformationId: plan.id, status: "PASSED", steps };
  } catch (error) {
    steps.push({
      name: "validation",
      status: "FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
    return { transformationId: plan.id, status: "FAILED", steps };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function rebaseOptionPath(
  optionPath: string,
  originalRoot: string,
  temporaryRoot: string,
): string {
  const relative = path.relative(originalRoot, optionPath);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? optionPath
    : path.resolve(temporaryRoot, relative);
}

interface DiagnosticRecord {
  key: string;
  message: string;
}

async function collectProjectSemanticDiagnostics(
  program: ts.Program,
  sourceFilesById: Map<string, ts.SourceFile>,
  projectRoot: string,
): Promise<Set<string>> {
  const results = new Set<string>();
  for (const sourceFile of sourceFilesById.values()) {
    for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) {
      results.add(diagnosticKey(diagnostic, sourceFile.fileName, projectRoot));
    }
  }
  return results;
}

async function collectSemanticDiagnostics(
  program: ts.Program,
  sourceFiles: ts.SourceFile[],
  temporaryRoot: string,
): Promise<DiagnosticRecord[]> {
  const results: DiagnosticRecord[] = [];
  for (const sourceFile of sourceFiles) {
    for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) {
      results.push({
        key: diagnosticKey(diagnostic, sourceFile.fileName, temporaryRoot),
        message: formatDiagnostic(diagnostic),
      });
    }
  }
  return results;
}

function diagnosticKey(
  diagnostic: ts.Diagnostic,
  fileName: string,
  baseRoot: string,
): string {
  const normalizedPath = path.relative(baseRoot, fileName);
  return `${normalizedPath}:${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const location =
    diagnostic.file && diagnostic.start !== undefined
      ? `${diagnostic.file.fileName}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}: `
      : "";
  return `${location}${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
}
