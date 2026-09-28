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

Only clearly safe findings can be applied automatically. Warning-level findings remain review items by default.

## CLI

```bash
cleaner .
cleaner . --diff
cleaner . --write
cleaner . --check
cleaner . --json
cleaner . --config cleaner.config.json
cleaner --help
cleaner --version
```

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

Until then, do not assume that the repository's code is automatically available for unrestricted reuse.

---

## A Note From the Maintainer

HoloBuild is being built as more than a utility.

It is an engineering experiment.

The objective is to make something useful while documenting the decisions, mistakes, experiments, and lessons that happen along the way.

If you find a problem, don't just work around it.

Open the issue.

If you have a better idea, don't just keep it to yourself.

Start the discussion.

And if you want to build with us:

**Welcome to the lab.**
