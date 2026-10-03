import { analyzeProject } from "./scanner.js";
import { collectProjectFiles } from "./project-analysis.js";
import {
  applyPlanEdits,
  createTransformationPlan,
  findFileForEdit,
  formatPlanDiff,
} from "./transformation-plan.js";
import { validateTransformationPlan } from "./validation.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import type {
  ProjectAnalysisResult,
  Finding,
  ProjectFile,
  ScanOptions,
  TransformationPlan,
} from "./types.js";

export async function buildDiffForProject(
  rootDir: string,
  options: Partial<ScanOptions> = {},
): Promise<string[]> {
  const analysis = await analyzeProject(rootDir, options);
  return buildDiffFromAnalysis(analysis);
}

export function buildDiffFromAnalysis(
  analysis: ProjectAnalysisResult,
): string[] {
  return formatPlanDiff(createTransformationPlan(analysis));
}

export async function applySafeTransforms(
  rootDir: string,
  options: Partial<ScanOptions> = {},
): Promise<number> {
  const analysis = await analyzeProject(rootDir, options);
  return applyAnalysisPlan(analysis, rootDir, options);
}

export async function applyAnalysisPlan(
  analysis: ProjectAnalysisResult,
  rootDir: string,
  options: Partial<ScanOptions> = {},
): Promise<number> {
  const plan = createTransformationPlan(analysis);
  const validation = await validateTransformationPlan(rootDir, plan, options);
  if (validation.status !== "PASSED") {
    throw new Error(
      `Transformation validation failed:\n${validation.steps
        .filter((step) => step.status === "FAILED")
        .map((step) => step.message)
        .join("\n")}`,
    );
  }
  return applyTransformationPlan(rootDir, plan, analysis.project.files);
}

export async function writeCleanedCopy(
  inputDir: string,
  outputDir: string,
  options: Partial<ScanOptions> = {},
): Promise<number> {
  const analysis = await analyzeProject(inputDir, options);
  return writeCleanedCopyFromAnalysis(analysis, outputDir, options);
}

export async function writeCleanedCopyFromAnalysis(
  analysis: ProjectAnalysisResult,
  outputDir: string,
  options: Partial<ScanOptions> = {},
): Promise<number> {
  const inputDir = analysis.project.root;
  const plan = createTransformationPlan(analysis);
  const validation = await validateTransformationPlan(inputDir, plan, options);
  if (validation.status !== "PASSED") {
    throw new Error(
      `Transformation validation failed:\n${validation.steps
        .filter((step) => step.status === "FAILED")
        .map((step) => step.message)
        .join("\n")}`,
    );
  }

  if (path.resolve(inputDir) === path.resolve(outputDir)) {
    throw new Error("Cleaned-copy output must not be the input directory.");
  }
  const files = await collectProjectFiles(inputDir, options.ignore);
  await fs.mkdir(outputDir, { recursive: true });

  for (const sourcePath of files) {
    const relativePath = path.relative(inputDir, sourcePath);
    const destinationPath = path.join(outputDir, relativePath);
    if (path.resolve(sourcePath) === path.resolve(destinationPath)) continue;
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }

  return applyTransformationPlan(outputDir, plan, analysis.project.files);
}

export async function applyTransformationPlan(
  rootDir: string,
  plan: TransformationPlan,
  files: ProjectFile[],
): Promise<number> {
  const editsByFile = new Map<string, TransformationPlan["edits"]>();
  for (const edit of plan.edits) {
    if (!findFileForEdit(files, edit)) {
      throw new Error(`Unknown file in transformation plan: '${edit.path}'.`);
    }
    const absolutePath = path.resolve(rootDir, edit.path);
    const relative = path.relative(path.resolve(rootDir), absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Transformation path escapes the target root: '${edit.path}'.`,
      );
    }
    const edits = editsByFile.get(absolutePath) ?? [];
    edits.push(edit);
    editsByFile.set(absolutePath, edits);
  }

  const updates = new Map<string, string>();
  for (const [filePath, edits] of editsByFile) {
    const current = await fs.readFile(filePath, "utf8");
    const actualHash = createHash("sha256").update(current).digest("hex");
    if (edits.some((edit) => edit.expectedContentHash !== actualHash)) {
      throw new Error(
        `Source changed after analysis; refusing to edit '${filePath}'.`,
      );
    }
    updates.set(filePath, applyPlanEdits(current, edits));
  }

  let changedFiles = 0;
  for (const [filePath, updated] of updates) {
    if ((await fs.readFile(filePath, "utf8")) === updated) continue;
    await fs.writeFile(filePath, updated, "utf8");
    changedFiles += 1;
  }
  return changedFiles;
}

export function toDiffText(findings: Finding[]): string {
  return findings
    .filter((finding) => finding.fix)
    .map((finding) => `- ${finding.file}: ${finding.message}`)
    .join("\n");
}
