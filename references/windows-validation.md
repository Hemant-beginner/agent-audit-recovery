# Windows Validation

## When to use

Use the adapter only when the governing skill's Node validators expose semantic functions but their command-line input path rejects Windows files, for example because `O_NOFOLLOW` or `O_NONBLOCK` is unavailable.

Confirm the installed files export `preflightJsonText` and `validateDocument`, and that command-line execution is guarded by `require.main === module`. If the validator API differs, stop and inspect it rather than guessing.

## Trust boundary

The adapter is for trusted, parent-authored run documents. It performs a normal read after checking that the path is a regular file no larger than 5 MiB. It does not reproduce POSIX descriptor-relative no-follow promotion and must not be used to validate attacker-controlled scratch output or justify executing target code.

Keep all installed semantic checks unchanged. Do not edit validator constants, bypass schema loading, filter error messages, or convert failure into success.

## Usage

```text
node scripts/validate-windows.cjs --skill-dir <governing-skill-dir> ledger <coverage-ledger.json>
node scripts/validate-windows.cjs --skill-dir <governing-skill-dir> findings <findings.json>
```

The ledger path calls `preflightJsonText(contents)` followed by `validateDocument(document)`. The findings path loads the governing skill's `report-schema.json` and calls `validateDocument(document, schema)`.

Require a zero exit status and a `PASS` line. Preserve all `ERROR:` lines when fixing the document. Record the adapter path, governing skill directory, regular-file/size boundary, and unchanged semantic exports in `run-metadata.json` under `validator_note`.

A validator pass establishes document validity only. It does not establish complete coverage, independent verification, safe execution, or audit completion.
