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
- `--config <path>` loads rule and ignore settings from a JSON config file.

`--diff` and `--write` operate only on the safe transformations currently supported by
the scanner. All other findings remain report-only. JSON mode writes only the scan
result to standard output so it can be piped to another tool.
