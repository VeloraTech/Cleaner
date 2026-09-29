import fs from "node:fs/promises";
import path from "node:path";

export interface OutputPlan {
  inputPath: string;
  outputPath: string;
  explicitOutput: boolean;
  sourceModification: boolean;
}

export async function resolveOutputPlan(
  inputPath: string,
  outputOption: string | undefined,
  cwd = process.cwd(),
): Promise<OutputPlan> {
  const inputAbsolute = await canonicalPath(path.resolve(cwd, inputPath));
  const cwdCanonical = await canonicalPath(cwd);
  const explicitOutput = outputOption !== undefined;
  const outputBase = explicitOutput
    ? path.resolve(cwd, outputOption)
    : path.join(cwd, "dist");
  const outputBaseCanonical = await canonicalPath(outputBase);
  const isSourceOutput = outputBaseCanonical === inputAbsolute;
  const isProjectRoot = inputAbsolute === cwdCanonical;
  const outputPath =
    isSourceOutput || isProjectRoot
      ? outputBaseCanonical
      : path.join(outputBaseCanonical, path.basename(inputAbsolute));
  const sourceModification = outputPath === inputAbsolute;

  if (sourceModification && !explicitOutput) {
    throw new Error(
      "The default output directory resolves to the input directory. Choose a different input or explicit output directory.",
    );
  }

  if (
    !sourceModification &&
    !(isProjectRoot && !explicitOutput) &&
    (isPathInside(outputPath, inputAbsolute) ||
      isPathInside(inputAbsolute, outputPath))
  ) {
    throw new Error(
      `Output directory overlaps the input directory.\n\nInput:\n  ${inputPath}\n\nOutput:\n  ${outputPath}\n\nCleaner will not write because this could cause recursive or unintended source modification. Choose an output directory outside the source tree.`,
    );
  }

  return {
    inputPath: inputAbsolute,
    outputPath,
    explicitOutput,
    sourceModification,
  };
}

export async function ensureOutputDirectory(outputPath: string): Promise<void> {
  await fs.mkdir(outputPath, { recursive: true });
}

async function canonicalPath(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch {
    const parent = path.dirname(candidate);
    if (parent === candidate) return path.normalize(candidate);
    const canonicalParent = await canonicalPath(parent);
    return path.join(canonicalParent, path.basename(candidate));
  }
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}
