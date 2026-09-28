import type { RuleId } from "./types.js";

export interface RuleDefinition {
  id: RuleId;
  description: string;
  severity: "SAFE" | "WARNING" | "INFO";
  fixable: boolean;
}

export const RULES: Record<RuleId, RuleDefinition> = {
  "unused-imports": {
    id: "unused-imports",
    description: "Import bindings that are never used in the current module.",
    severity: "SAFE",
    fixable: true,
  },
  "unused-variables": {
    id: "unused-variables",
    description: "Locally declared variables with no meaningful reference.",
    severity: "WARNING",
    fixable: false,
  },
  "unused-functions": {
    id: "unused-functions",
    description:
      "Functions with no identified references in the project graph.",
    severity: "WARNING",
    fixable: false,
  },
  "unused-parameters": {
    id: "unused-parameters",
    description: "Function parameters that appear never to be read.",
    severity: "WARNING",
    fixable: false,
  },
  "unused-exports": {
    id: "unused-exports",
    description:
      "Exports that appear to have no local or project-level consumers.",
    severity: "WARNING",
    fixable: false,
  },
  console: {
    id: "console",
    description:
      "Console debugging statements that a developer may want to remove.",
    severity: "SAFE",
    fixable: true,
  },
  debugger: {
    id: "debugger",
    description: "Debugger statements left in source.",
    severity: "SAFE",
    fixable: true,
  },
  "dead-code": {
    id: "dead-code",
    description:
      "Code after unconditional return or other unreachable control flow.",
    severity: "WARNING",
    fixable: false,
  },
  "dead-files": {
    id: "dead-files",
    description: "Files that appear to be legacy or otherwise unreferenced.",
    severity: "INFO",
    fixable: false,
  },
  "duplicate-code": {
    id: "duplicate-code",
    description:
      "Code structures that are structurally similar and may be candidates for cleanup.",
    severity: "INFO",
    fixable: false,
  },
  artifacts: {
    id: "artifacts",
    description:
      "Generated directories or build artifacts that may be ignored or cleaned up.",
    severity: "INFO",
    fixable: false,
  },
};

export const DEFAULT_RULES: Record<string, boolean> = Object.fromEntries(
  Object.entries(RULES).map(([id]) => [id, true]),
);
