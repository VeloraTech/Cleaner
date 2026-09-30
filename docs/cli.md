# CLI reference

Cleaner analyzes your project and writes a cleaned copy by default. Source files
are never modified unless you explicitly choose the source location and confirm.

```bash
cleaner [path] [options]
```

## Common commands

```bash
cleaner .
cleaner src
cleaner src --output cleaned
cleaner src --diff
cleaner src --check
cleaner src --json
cleaner src --config cleaner.config.json
cleaner src --write
cleaner src --write --force
cleaner --help
cleaner --version
```

`cleaner .` uses the current directory as input. `cleaner src` writes a cleaned
copy to `dist/src`. The `--output` option changes the output base while keeping
the input directory name and structure.

Options:

```text
	-o, --output <dir>    Output base directory (default: dist)
			--diff            Show proposed changes only
			--check           Check without writing output
			--write           Enable explicit source modification workflow
			--force           Skip confirmation for explicit source modification
			--json            Emit machine-readable results
			--config <path>   Load rule and ignore settings from a JSON file
```

- `cleaner src` writes a cleaned copy to `dist/src`.
- `cleaner src --output cleaned` writes a cleaned copy to `cleaned/src`.
- `--diff` and `--check` are read-only and do not create output directories.
- `--write` targets the source directory and requires interactive `y` confirmation.
- `--force` is accepted only for that explicit source-modification workflow.
- Output paths that overlap the source tree are rejected unless the user explicitly selected the source itself.
- JSON mode writes only the scan result to standard output.

Repeated runs do not recursively scan Cleaner-owned `dist` output because the
default ignore configuration excludes it. Existing unrelated output files are
preserved.

## Development commands

Run these from the repository root:

| Command                          | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `npm install`                    | Install dependencies.                                                      |
| `npm run build`                  | Compile TypeScript into `dist/`.                                           |
| `npm test`                       | Build and run the complete test suite.                                     |
| `npm run release:check`          | Run local tests, build, and package-content validation without publishing. |
| `npm start`                      | Run Cleaner against the current directory.                                 |
| `npm run check`                  | Run `cleaner --check` against the current directory.                       |
| `npm run clean:local`            | Remove common local build and temporary artifacts.                         |
| `npm run reset-project`          | Show disposable artifacts and ask before removing them.                    |
| `npm run reset-project -- --yes` | Remove listed disposable artifacts without prompting.                      |
| `npm pack`                       | Build and create a local `.tgz` package.                                   |
| `npm run pack`                   | Alias for `npm pack`.                                                      |
| `npm link`                       | Expose the local `cleaner` command globally for development.               |

After `npm link`, use `cleaner --help` or `cleaner .` from another directory.

## Packaging

`npm pack` creates a file named from the scoped package, for example
`coachlogic-cleaner-0.1.4.tgz`. Install that local package elsewhere with:

```bash
npm install ./coachlogic-cleaner-0.1.4.tgz
npx cleaner .
```

Public releases are published automatically by GitHub Actions when a matching
version tag is pushed. See [docs/releasing.md](releasing.md) for tag creation and
the required npm trusted-publisher setup.

After publication, users can run `npm install @coachlogic/cleaner` and
`npx cleaner .`.
