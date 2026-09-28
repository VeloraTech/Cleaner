# CLI reference

```bash
cleaner [path]
cleaner --diff
cleaner --write
cleaner --check
cleaner --json
cleaner --config <path>
cleaner --help
cleaner --version
```

- `cleaner .` scans the current project and prints a summary.
- `--diff` previews the proposed changes.
- `--write` applies safe transformations.
- `--check` returns `0` if no actionable findings are found and `1` when findings are present.
- `--json` emits machine-readable results.
