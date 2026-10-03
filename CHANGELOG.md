# Changelog

All notable changes to Cleaner will be documented here.

The project is currently experimental, so this changelog will evolve alongside the release process.

## Unreleased

### Added

- Post-install CLI starter commands, including `npx cleaner --help`, with
  foreground install guidance for npm's lifecycle-output buffering. The
  installer uses a packaged script file rather than inline command source.
- Clear severity-grouped CLI output with explicit read-only diff status.

### Fixed

- Remove console calls by AST statement ranges so callback braces, call
  delimiters, and surrounding code remain intact.
- Keep console calls in expression or unbraced control-flow contexts unchanged
  when their removal cannot be proven safe.
- Replace regex dead-code detection with AST statement-list analysis and
  accurate finding locations.
- Avoid unused-variable warnings for exported bindings that may have external
  consumers.
- Load the CLI's displayed version from package metadata instead of a stale
  hard-coded version.

## 0.2.0 - 2026-10-03

### Added

- Project loading is separated from analysis and creates one shared TypeScript
  Program using the project's tsconfig where available.
- Project graph for modules, imports, exports, symbols, references, dependencies,
  and reliably resolved calls.
- Project-level unused-function and unused-export findings, plus structured
  static evidence and confidence on findings.
- Structured transformation plans validated against a temporary project copy
  for parsing and newly introduced TypeScript diagnostics before application.

### Changed

- Document the actual available analysis and mark duplicate-code and artifact
  analysis as planned rather than active capabilities.

## 0.1.4 - 2026-09-30

### Added

- Symbol-aware analysis for unused imports, variables, and parameters.
- Regression coverage for import references, lexical shadowing, destructuring,
  callback parameters, type-only usage, side-effect imports, and cookie-parser.

### Changed

- Import and local-binding analysis now uses the TypeScript compiler AST and
  checker rather than raw identifier-text counts.
- TypeScript is a runtime dependency because the packaged CLI uses its compiler
  API.

### Fixed

- Prevent false unused-import findings when an imported binding is referenced
  in the same file, including `cookieParser()` middleware usage.
- Keep imports unchanged when parsing or binding resolution is uncertain.
