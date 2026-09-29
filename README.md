# Cleaner

Cleaner is a local-first static-analysis CLI for JavaScript and TypeScript projects. It helps developers find unnecessary code, debug artifacts, and suspicious cleanup candidates without blindly editing source files.

## What Cleaner does

Cleaner is designed to:

- scan JavaScript and TypeScript projects
- detect unused imports and variables
- flag console/debugger statements
- report dead-code and dead-file candidates conservatively
- respect ignore rules and config options
- preview changes in diff mode
- apply only safe transformations in explicit write mode

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

This creates `cleaner-0.1.0.tgz`. Share that file, and another user can install it with:

```bash
npm install ./cleaner-0.1.0.tgz
npx cleaner .
```

To publish the package to npm instead:

```bash
npm login
npm publish --access public
```

After publishing, users can install it with `npm install cleaner` and run it with `npx cleaner .`.

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
    "dead-files": true,
    "duplicate-code": true,
    "artifacts": true
  },
  "ignore": ["node_modules/**", "dist/**", "coverage/**"]
}
```

## Supported languages

- JavaScript
- TypeScript
- JSX / TSX support is included in the scanning model, with conservative behavior.

## Limitations

This is intentionally a v0.1.0 implementation. It does not attempt to be a universal code-quality suite or a full semantic optimizer. It is a conservative cleanup tool focused on safe, explainable findings.

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
