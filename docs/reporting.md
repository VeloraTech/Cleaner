# Reporting and schema

Cleaner emits findings as structured records with the following shape:

```json
{
  "rule": "unused-imports",
  "file": "src/example.ts",
  "line": 1,
  "severity": "SAFE",
  "message": "Unused import candidates detected during static scan.",
  "fixable": true
}
```

Supported severities:

- SAFE
- WARNING
- INFO
- ERROR

This schema is intentionally simple and versioned by the project release version. The CLI output stays readable for humans while the JSON output remains machine-readable and stable for CI or tooling.
