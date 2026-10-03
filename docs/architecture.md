# Cleaner architecture

Cleaner follows this project-level pipeline:

```text
CLI -> Project Loader -> Project Analysis -> Analyzers -> Findings/Evidence
                                              |
                                              v
                                  Edit Plan -> Validation -> Apply
```

`project-loader.ts` resolves the root, loads config and ignore settings,
discovers supported source files, and creates one shared TypeScript Program
using the project's tsconfig when available. It does not construct the graph.
`project-analysis.ts` consumes the loaded files and Program to build modules,
symbols, references, imports/exports, dependencies, and only reliably resolved
call edges. TypeScript's checker is reused to resolve cross-file relationships.

Findings retain the CLI-facing rule/severity/message fields and add a category,
confidence, locations, evidence records, and fixability. Current evidence is
STATIC and describes the analyzer's claim; RUNTIME evidence is a type-level
extension point only and runtime observation/evidence are future work.
Confidence is HIGH for syntax errors and transformations proven safe, MEDIUM
for project-local unused candidates, and LOW for heuristic legacy-file
candidates.

The active analyzers cover imports, local variables and parameters, functions
and exports with no identified project reference, console/debugger statements,
unreachable statements after unconditional control flow, legacy-named files,
and syntax/configuration errors. Unused exports are only project-local
candidates: external consumers and framework entry points may exist. Duplicate
code and artifact analysis are planned and do not emit findings.

Safe fixes become structured source-range edits with expected file hashes.
Validation stages a temporary copy, checks syntax and rejects newly introduced
TypeScript semantic diagnostics. It never uses the user's source files as its
validation workspace. Only after validation does the CLI write the cleaned
copy or, with explicit confirmation, apply safe changes to source files.
Validation does not run project tests. Runtime observation, advanced
simplification, and the broader Cleaner 2.0 vision are future work outside this
release.
