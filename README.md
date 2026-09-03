# Cleaner

> A developer tool for removing unwanted `console.log` statements from a codebase without turning cleanup into a manual hunt.

**Cleaner** is an experimental developer tool built around a simple idea:

> Your development logs are useful while you're building. They shouldn't have to follow you into every file forever.

The project is being developed as an open-source laboratory for exploring developer tooling, source-code transformation, safe automation, and the engineering decisions behind them.

---

## Why Cleaner?

`console.log()` is useful.

During development, it helps you inspect values, understand execution flow, and debug problems. The problem starts when temporary logs remain scattered throughout a project.

A typical cleanup can become:

```text
search
→ inspect
→ delete
→ search again
→ miss one
→ repeat
```

Cleaner aims to turn that into a deliberate, inspectable operation.

The goal is **not** to blindly delete code.

The goal is to build a tool that can:

- find targeted logging statements
- understand where they occur
- show what it intends to change
- remove them safely
- preserve unrelated code
- make the operation reversible where possible
- give developers confidence in what happened

---

## Project Philosophy

Cleaner is being built around the philosophy:

> **Build. Break. Learn. Rebuild.**

This is not just a slogan for the project.

The project itself is an experiment.

We want to discover:

- How should a cleanup tool understand source code?
- How much should it automate?
- When should it refuse to modify a file?
- How can developers preview changes before applying them?
- What happens when syntax is unusual?
- How should different languages be supported?
- Where is the boundary between a useful developer tool and a dangerous code transformer?

Some answers will be obvious.

Others will be discovered by building, breaking things, testing assumptions, and rebuilding better solutions.

---

## Status

> **Early-stage / experimental**

Cleaner is not currently presented as a production-safe universal code cleaner.

Expect:

- incomplete features
- changing APIs
- experimental architecture
- bugs
- breaking changes
- unfinished documentation

If you want to experiment with developer tooling, this is exactly the stage where contributions can have meaningful influence.

---

## What Cleaner Is

Cleaner is intended to become a developer-facing source cleanup tool.

A future workflow may look like:

```bash
cleaner scan
```

```text
Scanning project...

src/App.jsx
  line 14  console.log(...)
  line 29  console.log(...)

src/services/auth.js
  line 41  console.log(...)

3 removable logs found.
```

Then:

```bash
cleaner clean
```

could provide a preview:

```text
3 changes detected.

Would you like to apply them?

[preview] [apply] [cancel]
```

The exact command interface is intentionally not finalized yet.

**Do not assume the examples above are the final CLI API.**

---

## Design Goals

### 1. Safety first

Source code should never be modified casually.

The tool should prefer:

```text
inspect
→ understand
→ preview
→ confirm
→ modify
```

over:

```text
find
→ delete everything
```

### 2. Predictability

If Cleaner says it found three targets, developers should be able to understand exactly what those three targets are.

### 3. Minimal changes

Cleaner should modify only what it is responsible for.

Unrelated formatting and source code should remain untouched whenever technically possible.

### 4. Developer control

Automation should assist the developer rather than hide what is happening.

### 5. Extensibility

The architecture should make it possible to support additional logging patterns, languages, frameworks, and cleanup rules later.

---

## What Cleaner Should Eventually Handle

The scope may evolve, but the project can explore:

- `console.log`
- `console.info`
- `console.warn`
- `console.error`
- configurable logging patterns
- JavaScript
- TypeScript
- JSX
- TSX
- source scanning
- dry runs
- previews
- safe transformations
- backups/recovery
- ignore patterns
- configuration files
- CI usage
- editor integration
- custom cleanup rules

Not every item belongs in the first release.

The roadmap should be driven by real implementation experience and contributor feedback.

---

## Example

Given:

```js
function authenticate(user) {
  console.log("Authenticating user:", user);

  const token = createToken(user);

  console.log("Token created");

  return token;
}
```

Cleaner should eventually be able to identify the logging statements without disturbing the surrounding logic:

```js
function authenticate(user) {
  const token = createToken(user);

  return token;
}
```

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
cd cleaner
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
cleaner/
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

### Phase 1 — First Cleaner

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

Cleaner is open to contributions of different sizes.

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

Cleaner operates on source code.

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

Cleaner is being built as more than a utility.

It is an engineering experiment.

The objective is to make something useful while documenting the decisions, mistakes, experiments, and lessons that happen along the way.

If you find a problem, don't just work around it.

Open the issue.

If you have a better idea, don't just keep it to yourself.

Start the discussion.

And if you want to build with us:

**Welcome to the lab.**
#   H o l o B u i l d  
 