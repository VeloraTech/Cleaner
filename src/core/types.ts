export type Severity = "SAFE" | "WARNING" | "INFO" | "ERROR";

export type EvidenceKind = "STATIC" | "RUNTIME" | "DERIVED";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type SourceLanguage = "javascript" | "typescript";

export interface SourceLocation {
  fileId: string;
  path: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  claim: string;
  location?: SourceLocation;
  sessionId?: string;
  coverage?: string;
}

export interface EvidenceFinding extends Finding {
  id: string;
  category: string;
  severity: Severity;
  confidence: Confidence;
  message: string;
  locations: SourceLocation[];
  evidence: Evidence[];
  fixability: "SAFE" | "REVIEW" | "NONE";
}

export interface ProjectFile {
  id: string;
  path: string;
  relativePath: string;
  language: SourceLanguage;
  contentHash: string;
  parseStatus: "OK" | "ERROR";
  parseErrorCount: number;
}

export interface ProjectModule {
  id: string;
  fileId: string;
  importNames: string[];
  exportNames: string[];
}

export interface ProjectSymbol {
  id: string;
  fileId: string;
  scopeId: string;
  name: string;
  kind:
    | "variable"
    | "function"
    | "parameter"
    | "import"
    | "class"
    | "method"
    | "type"
    | "property"
    | "other";
  exported: boolean;
  location: SourceLocation;
}

export interface ProjectReference {
  id: string;
  fileId: string;
  targetSymbolId: string;
  fromFunctionId?: string;
  kind: "value" | "type";
  location: SourceLocation;
}

export interface ProjectFunction {
  id: string;
  symbolId?: string;
  fileId: string;
  name: string;
  parameterSymbolIds: string[];
  location: SourceLocation;
}

export interface ProjectCall {
  id: string;
  callerFunctionId?: string;
  calleeFunctionId?: string;
  calleeName: string;
  resolution: "resolved" | "unresolved";
  targetSymbolId?: string;
  location: SourceLocation;
}

export interface ProjectDependency {
  id: string;
  fromModuleId: string;
  specifier: string;
  toModuleId?: string;
  kind: "import" | "re-export" | "require" | "dynamic-import";
  resolution: "resolved-project" | "resolved-external" | "unresolved";
  location: SourceLocation;
}

export interface ProjectGraph {
  files: ProjectFile[];
  modules: ProjectModule[];
  symbols: ProjectSymbol[];
  references: ProjectReference[];
  functions: ProjectFunction[];
  dependencies: ProjectDependency[];
  calls: ProjectCall[];
}

export interface Project {
  id: string;
  root: string;
  tsconfigPath?: string;
  rules: Record<string, boolean>;
  ignore: string[];
  files: ProjectFile[];
  graph: ProjectGraph;
  configDiagnostics: string[];
}

export interface ProjectAnalysisResult {
  sessionId: string;
  project: Project;
  findings: EvidenceFinding[];
}

export interface TransformationEdit {
  fileId: string;
  path: string;
  expectedContentHash: string;
  start: number;
  end: number;
  replacement: string;
}

export interface TransformationPlan {
  id: string;
  findingIds: string[];
  risk: "LOW" | "MEDIUM" | "HIGH";
  edits: TransformationEdit[];
  preview: string;
}

export interface ValidationStepResult {
  name: string;
  status: "PASSED" | "FAILED" | "SKIPPED";
  message: string;
}

export interface ValidationResult {
  transformationId: string;
  status: "PASSED" | "FAILED";
  steps: ValidationStepResult[];
}

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
  | "syntax"
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
    start?: number;
    end?: number;
  };
}

export interface ScanOptions {
  rules: Record<string, boolean>;
  basePath?: string;
  ignore?: string[];
}

export interface ScanResult {
  filesScanned: number;
  findings: Finding[];
}
