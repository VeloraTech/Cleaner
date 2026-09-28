export type Severity = "SAFE" | "WARNING" | "INFO" | "ERROR";

export type RuleId =
  | "unused-imports"
  | "unused-variables"
  | "unused-functions"
  | "unused-parameters"
  | "unused-exports"
  | "console"
  | "debugger"
  | "dead-code"
  | "dead-files"
  | "duplicate-code"
  | "artifacts";

export interface Finding {
  rule: RuleId;
  file: string;
  line: number;
  severity: Severity;
  message: string;
  fixable: boolean;
  fix?: {
    kind: "remove-import" | "remove-statement" | "remove-variable";
    text: string;
  };
}

export interface ScanOptions {
  rules: Record<string, boolean>;
  basePath?: string;
}

export interface ScanResult {
  filesScanned: number;
  findings: Finding[];
}
