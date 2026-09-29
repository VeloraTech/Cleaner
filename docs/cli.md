# CLI reference

Cleaner analyzes your project and writes a cleaned copy by default. Source files
are never modified unless you explicitly choose the source location and confirm.

```bash
cleaner [path] [options]
```

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
