import { createHash } from "node:crypto";

import type {
  ProjectAnalysisResult,
  ProjectFile,
  TransformationEdit,
  TransformationPlan,
} from "./types.js";

export function createTransformationPlan(
  analysis: ProjectAnalysisResult,
): TransformationPlan {
  const fileByPath = new Map(
    analysis.project.files.map((file) => [file.relativePath, file]),
  );
  const edits: TransformationEdit[] = [];
  const findingIds: string[] = [];
  const previews: string[] = [];

  for (const finding of analysis.findings) {
    if (
      finding.severity !== "SAFE" ||
      !finding.fixable ||
      finding.fix?.start === undefined ||
      finding.fix.end === undefined
    ) {
      continue;
    }
    const file = fileByPath.get(finding.file);
    if (!file) continue;
    findingIds.push(finding.id);
    edits.push({
      fileId: file.id,
      path: file.relativePath,
      expectedContentHash: file.contentHash,
      start: finding.fix.start,
      end: finding.fix.end,
      replacement: "",
    });
    previews.push(
      `--- ${file.relativePath} (${finding.severity}) ---\nReason: ${finding.message}\n- ${finding.fix.text}\n+ (removed)`,
    );
  }

  const orderedEdits = [...edits].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.start - right.start,
  );
  const identity = orderedEdits
    .map(
      (edit) =>
        `${edit.path}:${edit.start}:${edit.end}:${edit.expectedContentHash}`,
    )
    .join("\n");

  return {
    id: `transform:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`,
    findingIds,
    risk: "LOW",
    edits: orderedEdits,
    preview: previews.join("\n\n"),
  };
}

export function applyPlanEdits(
  source: string,
  edits: TransformationEdit[],
): string {
  let updated = source;
  const descending = [...edits].sort((left, right) => right.start - left.start);
  let previousStart = Number.POSITIVE_INFINITY;
  for (const edit of descending) {
    if (
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > updated.length ||
      edit.end > previousStart
    ) {
      throw new Error(`Overlapping or invalid edits in '${edit.path}'.`);
    }
    updated = `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`;
    previousStart = edit.start;
  }
  return updated;
}

export function formatPlanDiff(plan: TransformationPlan): string[] {
  return plan.preview ? plan.preview.split("\n") : [];
}

export function findFileForEdit(
  files: ProjectFile[],
  edit: TransformationEdit,
): ProjectFile | undefined {
  return files.find(
    (file) => file.id === edit.fileId && file.relativePath === edit.path,
  );
}
