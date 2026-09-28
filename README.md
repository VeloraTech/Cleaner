# Cleaner

Cleaner is a safe static-analysis CLI for JavaScript and TypeScript projects. It finds unnecessary code, noisy debug statements, and suspicious dead-file patterns, then reports them in a way that keeps the developer in control.

## What Cleaner does

Cleaner scans a project and surfaces issues such as:

- unused imports
- debug statements like `console.log` and `debugger`
- suspicious dead-code candidates
- likely dead files
- duplicate code candidates

It never modifies files by default. It reports findings first and only allows safe transformations in explicit modes.

## Why it exists

Most cleanup tools lean toward aggressive automation or blanket deletion. Cleaner intentionally favors correctness, explainability, and safety. It is meant to help developers review cleanup opportunities without silently rewriting code.

## Installation

```bash
npm install
npm run build
npx cleaner .
```

## 30-second example

```js
import jwt from "jsonwebtoken";
const value = 42;
console.log("debug");

debugger;

export function run() {
  return value;
}
```

Cleaner reports:

```text
SAFE unused-imports src/example.ts:1 - Unused import candidates detected during static scan.
SAFE console src/example.ts:1 - Console debug call(s) detected: 1.
SAFE debugger src/example.ts:1 - Debugger statement found.
```

## Supported languages

- JavaScript
- TypeScript
- JSX / TSX support is included in the project scanning model, with conservative scanning behavior.

## Safety philosophy

Cleaner follows a strict rule:

> When uncertain, do not modify.

Only safe, clearly evidenced findings can be applied automatically. Warnings and uncertain cases are reported instead of deleted.

## CLI commands

```bash
cleaner .
cleaner --diff
cleaner --write
cleaner --check
cleaner --json
cleaner --config cleaner.config.json
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
  "ignore": ["node_modules/**", "dist/**", "generated/**"]
}
```

## Limitations

This v0.1.0 implementation is intentionally conservative. It focuses on safe reporting and a small set of deterministic static checks rather than trying to be a universal code-quality platform.

## Contributing

Contributions are welcome. See the project docs for adding new rules, fixtures, tests, and CLI improvements.

## License

MIT

return token;
}

````

HoloBuild should eventually be able to identify the logging statements without disturbing the surrounding logic:

```js
function authenticate(user) {
  const token = createToken(user);

  return token;
}
````

The important engineering question is not simply:

> "Can we delete `console.log`?"

It is:

> "Can we determine what is safe to delete, explain it, and do it reliably?"

---

## Installation

Installation instructions will be added once the package/CLI distribution method is finalized.

For development, clone the repository and install its dependencies using the package manager defined by the project.

```bash
git clone <repository-url>
cd HoloBuild
```

Then follow the development setup documented in `CONTRIBUTING.md`.

---

## Development

The project is intended to be developed in small, understandable pieces.

A typical contribution flow is:

```text
pick an issue
    ↓
understand the current implementation
    ↓
create a branch
    ↓
make a focused change
    ↓
run tests
    ↓
inspect the diff
    ↓
open a pull request
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Testing

Every transformation should be tested against both:

1. code that should be changed
2. code that should **not** be changed

Examples of important cases:

```text
console.log("hello")
console.log(variable)
console.log(foo, bar)
console.log(
  "multiline"
)
```

and code where a log-like string is not actually a logging statement.

Tests should also cover:

- nested blocks
- functions
- conditionals
- loops
- comments
- strings
- unusual formatting
- syntax errors
- unsupported files
- ignored directories
- multiple statements
- multiline expressions

The exact testing framework depends on the implementation.

---

## Project Structure

The structure may evolve as the implementation becomes clearer.

A possible direction:

```text
HoloBuild/
├── src/
│   ├── scanner/
│   ├── parser/
│   ├── rules/
│   ├── transformer/
│   ├── reporter/
│   └── cli/
│
├── tests/
│   ├── fixtures/
│   ├── scanner/
│   ├── transformer/
│   └── cli/
│
├── docs/
├── .github/
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── SUPPORT.md
└── README.md
```

This is a proposed structure, not a requirement.

Architecture decisions should follow the actual implementation.

---

## Roadmap

### Phase 0 — Foundation

- [ ] Repository setup
- [ ] Basic project architecture
- [ ] Define supported environment
- [ ] Establish testing strategy
- [ ] Implement basic source scanning

### Phase 1 — First HoloBuild

- [ ] Detect `console.log`
- [ ] Report matches
- [ ] Implement dry-run mode
- [ ] Implement safe transformation
- [ ] Add fixtures and tests

### Phase 2 — Developer Experience

- [ ] Better CLI output
- [ ] Preview changes
- [ ] Ignore configuration
- [ ] Better error handling
- [ ] Recovery strategy

### Phase 3 — Extensibility

- [ ] Rule system
- [ ] Additional console methods
- [ ] Configuration
- [ ] Plugin/extensible architecture exploration

### Phase 4 — Community

- [ ] Contributor documentation
- [ ] Good first issues
- [ ] More language/framework support
- [ ] Community-driven rules
- [ ] Release process

The roadmap is intentionally flexible.

---

## Contributing

HoloBuild is open to contributions of different sizes.

You do **not** need to build an entire feature to contribute.

Useful contributions include:

- fixing bugs
- improving tests
- improving documentation
- reporting edge cases
- improving error messages
- proposing architecture changes
- adding fixtures
- improving CLI UX
- researching parser approaches
- adding cleanup rules
- reviewing pull requests

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before starting.

---

## Good First Contributions

If you are new to the project, look for issues labelled:

- `good first issue`
- `help wanted`
- `documentation`
- `testing`
- `bug`

A good first contribution should ideally be small enough to understand without learning the entire codebase.

---

## Security

HoloBuild operates on source code.

If you discover a security issue, please do not disclose sensitive details in a public issue.

See [`SECURITY.md`](SECURITY.md).

---

## Support

For questions, usage discussions, ideas, and non-sensitive problems, see [`SUPPORT.md`](SUPPORT.md).

---

## Community

The goal is to build a project where people can do more than submit code.

We want contributors to be able to:

- question decisions
- suggest alternatives
- experiment
- test ideas
- disagree respectfully
- learn from implementation failures

A contributor does not have to be an expert to be useful.

Sometimes the most valuable contribution is:

> "I tried this and it broke here."

That gives the project something real to learn from.

---

## License

A license will be added when the project maintainer chooses the appropriate open-source license.

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
