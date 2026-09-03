# Contributing to Cleaner

First: thank you for being interested in Cleaner.

This project is intentionally being built in the open.

The goal is not only to produce a useful developer tool, but to create a place where developers can experiment, challenge decisions, learn, and contribute meaningful improvements.

## Before You Start

Please read:

- `README.md`
- existing issues
- existing pull requests when relevant

If you are planning a significant architectural change, open an issue or discussion first.

For small bug fixes and documentation improvements, you can usually proceed directly.

---

## What Can I Contribute?

You can contribute without being an expert in every part of the codebase.

Examples:

### Code

- bug fixes
- scanner improvements
- parser improvements
- transformation logic
- CLI improvements
- error handling
- performance improvements

### Tests

- edge cases
- regression tests
- fixtures
- parser cases
- transformation cases

### Documentation

- installation instructions
- examples
- troubleshooting
- architecture explanations
- tutorials

### Research

- parser approaches
- AST tooling
- source transformation strategies
- language support
- safety considerations

### Community

- reproduce bugs
- review pull requests
- answer questions
- improve issue reports
- propose ideas

---

## Find Something to Work On

Look for:

- `good first issue`
- `help wanted`
- `documentation`
- `testing`
- `bug`

If you are unsure whether an issue is available, ask before starting.

Please avoid spending a large amount of time implementing a feature that conflicts with the project's direction.

---

## Development Setup

Clone the repository:

```bash
git clone <repository-url>
cd cleaner
```

Install dependencies using the project's configured package manager.

Run the development/test commands defined by the current project setup.

> The exact commands will be documented here once the implementation stack is finalized.

---

## Branches

Create a focused branch from the default branch.

Example:

```bash
git checkout -b fix/multiline-console-log
```

or:

```bash
git checkout -b feat/dry-run-mode
```

Keep branches focused on one logical change.

---

## Commits

Prefer clear commits.

Good:

```text
fix: handle multiline console.log statements
```

```text
test: add nested block cleanup fixtures
```

```text
docs: clarify dry-run behavior
```

Avoid commits such as:

```text
stuff
```

```text
changes
```

```text
fixed things
```

The exact commit convention may evolve, but meaningful history is encouraged.

---

## Pull Requests

Before opening a PR:

```text
run tests
inspect your diff
remove unrelated changes
update documentation if necessary
```

Your PR should explain:

### What changed?

Briefly describe the implementation.

### Why?

Explain the problem being solved.

### How?

Explain important implementation decisions.

### Testing

Explain what you tested and any edge cases considered.

---

## Keep Pull Requests Focused

Avoid combining unrelated changes.

For example, don't submit:

```text
fix parser
+ redesign CLI
+ rename 40 files
+ rewrite documentation
+ change formatting everywhere
```

as one PR.

Smaller PRs are easier to review, understand, and merge.

---

## Tests Are Important

Cleaner modifies source code.

That makes regression testing especially important.

When adding or modifying transformation behavior, include tests showing:

1. what should be detected
2. what should be changed
3. what must remain unchanged

If you discover a bug, ideally add a regression test before fixing it.

---

## Safety Expectations

Never intentionally introduce code that:

- deletes unrelated source code
- modifies files outside the requested scope
- silently performs destructive operations
- exposes secrets
- weakens security controls
- bypasses project safeguards

If you are unsure whether a transformation is safe, stop and discuss it.

---

## Architectural Changes

For larger changes, open an issue first.

Explain:

```text
Problem
→ Proposed approach
→ Alternatives considered
→ Risks
→ Expected benefit
```

This lets the community discuss the design before implementation becomes expensive to change.

---

## Review Philosophy

Code review is about the code, not the person.

A reviewer may disagree with an approach.

That does not mean the contributor did something wrong.

Likewise, contributors are encouraged to question review comments respectfully when they have technical reasons to do so.

---

## Maintainer Expectations

The maintainer should aim to:

- explain decisions
- respond to contributions
- avoid unnecessary gatekeeping
- give useful review feedback
- keep issues organized
- recognize contributor work
- make the project approachable for newcomers

---

## The Philosophy

Cleaner follows:

```text
BUILD
  ↓
BREAK
  ↓
LEARN
  ↓
REBUILD
```

A failed implementation is not automatically wasted work.

A bug that teaches us something can improve the project.

If you find something broken, tell us.

If you have a better approach, propose it.

If you want to experiment, experiment responsibly.

---

## Thank You

Every useful contribution matters.

That includes the person who submits a major feature and the person who reports a tiny edge case that nobody else noticed.

Welcome to the lab.
