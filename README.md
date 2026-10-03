# Cleaner

[![npm version](https://img.shields.io/npm/v/%40coachlogic%2Fcleaner?label=npm)](https://www.npmjs.com/package/@coachlogic/cleaner)
[![npm downloads](https://img.shields.io/npm/dm/%40coachlogic%2Fcleaner)](https://www.npmjs.com/package/@coachlogic/cleaner)
[![license](https://img.shields.io/github/license/VeloraTech/Cleaner)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/VeloraTech/Cleaner)](https://github.com/VeloraTech/Cleaner)

Cleaner is a local-first, project-level static-analysis CLI for JavaScript and TypeScript. It uses one shared TypeScript analysis program to map modules and references, find unnecessary code, and apply only validated safe cleanup edits.

## What Cleaner does

Available in this milestone:

- load project files, Cleaner configuration, ignore rules, and TypeScript configuration
- build a project graph of modules, imports, exports, symbols, references, dependencies, and resolved calls
- detect unused imports, local variables, parameters, functions, and exports
- flag and safely remove standalone console/debugger statements
- report unreachable-statement and legacy-file candidates
- attach static evidence, confidence, and source locations to findings
- preview structured edits and validate proposed output in a temporary copy before applying it
- create a cleaned copy by default; modify source only in explicit write mode

Duplicate-code detection, artifact analysis, runtime observation and runtime
evidence, automated test execution during validation, and advanced
simplification are not part of this release. These and the broader Cleaner 2.0
vision remain future work; this release provides the static-analysis foundation.

It prioritizes correctness and transparency over aggressive cleanup.

## Why it exists

Developer tooling should help people understand what may be unnecessary, not guess and delete. Cleaner favors:

- static evidence
- explicit review
- dry-run by default
- local execution
- no cloud dependency
- no telemetry

## Installation

```bash
npm install --foreground-scripts @coachlogic/cleaner
```

The install prints the available starter commands. npm normally buffers output
from dependency lifecycle scripts, so a plain install may not display the
message. To install without foreground lifecycle output, then view help:

```bash
npm install @coachlogic/cleaner
npx cleaner --help
```

If Cleaner is already installed and you want to print the install message again:

```bash
npm rebuild @coachlogic/cleaner --foreground-scripts
```

npm's lifecycle banner shows the command `node postinstall.cjs`, followed by
Cleaner's instructions. It does not print the script source inline.

Preview findings without writing output:

```bash
npx cleaner . --diff
```

To create a cleaned copy, run `npx cleaner .`; Cleaner writes to `dist/` and
leaves the source untouched. You can pin common commands in your project's
`package.json`:

```json
{
  "scripts": {
    "cleaner:preview": "cleaner . --diff",
    "cleaner:check": "cleaner . --check",
    "cleaner:copy": "cleaner ."
  }
}
```

Then run `npm run cleaner:preview`, `npm run cleaner:check`, or
`npm run cleaner:copy`.

For repository development:

```bash
npm install
npm run build
npm link
cleaner .
```

## Distribute a tarball

Create a build artifact locally:

```bash
npm pack
```

This creates a versioned archive, for example `coachlogic-cleaner-0.1.5.tgz`.
Share the generated file; another user can install it with:

```bash
npm install ./coachlogic-cleaner-0.1.5.tgz
npx cleaner .
```

Public publishing is handled by the tag-driven GitHub Actions release workflow,
not from developer workstations. After publishing, users can install it with
`npm install @coachlogic/cleaner` and run it with `npx cleaner .`.

## Creating a release

Update `package.json` and `package-lock.json` to the intended release version,
commit that change, then create and push the matching tag:

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: prepare release"
git tag vX.Y.Z
git push origin HEAD
git push origin vX.Y.Z
```

The tag must exactly match the package version. GitHub Actions validates the
tag, runs tests and build/package checks, creates a GitHub Release with the
`.tgz` and its SHA256 checksum, then publishes `@coachlogic/cleaner` to npm via
OIDC. See [docs/releasing.md](docs/releasing.md) for one-time setup and details.

For local development cleanup, use the confirmation-protected reset command:

```bash
npm run reset-project
```

It removes only known disposable build, test, temporary, and local tarball artifacts.
Use `npm run reset-project -- --yes` only in an automated job that intentionally
wants those listed artifacts removed.

## Quick example

```ts
import jwt from "jsonwebtoken";
const value = 42;
console.log("debug");
debugger;

export function run() {
  return value;
}
```

Cleaner reports findings like:

```text
SAFE unused-imports src/example.ts:1 - Unused import candidates detected during static scan.
SAFE console src/example.ts:3 - Console debug call(s) detected: 1.
SAFE debugger src/example.ts:4 - Debugger statement found.
```

## Safety model

Cleaner follows a strict safety rule:

> When uncertain, do not modify.

Cleaner reads your source and writes a cleaned copy by default. Source files are
never modified during ordinary usage. Only clearly safe findings are applied to
the generated copy; warning-level findings remain review items.

```bash
cleaner src
```

This produces `dist/src`, preserving the source directory structure. A custom
output base works the same way:

```bash
cleaner src --output cleaned
```

This produces `cleaned/src`. Existing unrelated files in the output directory
are preserved. Cleaner rejects output paths inside the input tree to prevent
recursive output such as `dist/dist`.

## CLI

```bash
cleaner .
cleaner . --diff
cleaner . --write
cleaner . --check
cleaner . --json
cleaner . --output cleaned
cleaner . --config cleaner.config.json
cleaner --help
cleaner --version
```

- `--diff` analyzes and displays safe proposed changes without creating output.
- `--check` analyzes without creating output and returns `1` when findings exist.
- `--write` explicitly requests source modification and requires confirmation.
- `--force` bypasses that confirmation only when source modification was requested.
- `--output <directory>` chooses the output base; use `-o` as the short form.

Selecting the source directory as the output is blocked unless you confirm with
`y`, or explicitly use `--force`. Non-interactive source modification fails
instead of hanging or proceeding implicitly.

For the complete command reference, development scripts, packaging workflow,
and exit behavior, see [docs/cli.md](docs/cli.md).

## Configuration

```json
{
  "rules": {
    "unused-imports": true,
    "unused-variables": true,
    "unused-functions": true,
    "unused-parameters": true,
    "unused-exports": true,
    "console": true,
    "debugger": true,
    "dead-code": true,
    "dead-files": true
  },
  "ignore": ["node_modules/**", "dist/**", "coverage/**"]
}
```

Cleaner also accepts `duplicate-code` and `artifacts` as planned rule IDs, but
they are disabled by default and do not produce findings. Console calls are
removed only when they are standalone statements in a safe statement list;
calls embedded in expressions or unbraced control-flow bodies are preserved
and reported as warnings. Dead-code, unused-function, and unused-export
findings are review-only and are never automatically removed. Unused-export
results are project-local candidates; Cleaner cannot know every external entry
point or consumer.

## Supported languages

- JavaScript
- TypeScript
- JSX / TSX support is included in the scanning model, with conservative behavior.

## Limitations

This is the first project-level `0.2.x` milestone, not a universal code-quality
suite or semantic optimizer. Some warning-level rules remain heuristic and
non-fixable; automatic transformations are limited to findings Cleaner can
prove safe. Cleaner does not run project tests during transformation validation.

## Repository layout

```text
cleaner/
├── src/
│   ├── cli/
│   ├── config/
│   ├── core/
│   └── ...
├── tests/
├── fixtures/
├── docs/
├── package.json
├── cleaner.config.json
├── README.md
├── LICENSE
└── .gitignore
```

## Contributing

Contributions are welcome. A good contribution usually includes:

- a small, focused rule or detection change
- fixture coverage
- tests for positive and negative cases
- documentation updates

## License

MIT
