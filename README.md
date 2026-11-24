# Multi-Agent Audit Recovery

A reusable, source-first playbook for recovering interrupted multi-agent security audits.

Use this skill when agents have returned results that were never saved, a coverage ledger is inconsistent, hunter output is malformed, Windows rejects validator input, or agent credits run out before consolidation. It complements an existing audit workflow; it does not replace the governing skill's evidence, sandbox, coverage, or independent-validation rules.

## Features

- Correlate JSONL transcript results with the exact agent call and assignment owner.
- Reject false positives from unrelated file reads and tool results.
- Preserve malformed and quota-limited output without repairing it.
- Merge valid hunter results into a top-level coverage-ledger array.
- Enforce lexicographic `coverage_id` ordering and exact reviewed-path unions.
- Stage ledger changes by default and validate before an explicit atomic write.
- Run installed semantic validators through a bounded Windows adapter.
- Resume safely without silently spending additional agent credits.

## Package layout

```text
.
├── SKILL.md
├── LICENSE
├── README.md
├── docs/
│   ├── USAGE.md
│   ├── SECURITY.md
│   └── TESTING.md
├── references/
│   ├── ledger-recovery.md
│   ├── transcript-recovery.md
│   └── windows-validation.md
└── scripts/
    ├── consolidate-ledger.cjs
    ├── recover-agent-results.cjs
    └── validate-windows.cjs
```

## Requirements

- Node.js 18 or newer.
- An existing audit output directory using the supported coverage-ledger contract.
- The governing audit skill and its installed validators.
- Authorization before rerunning agents, spending credits, or changing retained audit state.

The scripts do not install dependencies or execute target code.

## Installation

Copy this directory into a skill location supported by your agent platform. For Qoder CLI user-level installation, use the platform's documented skills directory, then reload the skills list.

Keep the directory name `multi-agent-audit-recovery` and preserve the `SKILL.md` filename.

## Quick start

### Recover transcript results

```bash
node scripts/recover-agent-results.cjs \
  --transcript /path/to/session.jsonl \
  --out /path/to/new-staging-directory \
  --expect hunter-a,hunter-b
```

Review `manifest.json`, accepted results, and rejected raw output before copying anything into the audit run.

### Stage a ledger merge

```bash
node scripts/consolidate-ledger.cjs \
  --ledger /path/to/coverage-ledger.json \
  --result /path/to/hunter-result.json \
  --agent hunter-a \
  --skill-dir /path/to/governing-skill \
  --out /path/to/staged-ledger.json
```

Validate the staged ledger:

```bash
node scripts/validate-windows.cjs \
  --skill-dir /path/to/governing-skill \
  ledger /path/to/staged-ledger.json
```

Use `--write` instead of `--out` only after reviewing the staged result and obtaining any required approval. Writes validate both the original and merged ledger before replacing the original through a temporary sibling file.

## Documentation

- [Usage guide](docs/USAGE.md) — inputs, commands, exit codes, and recovery sequence.
- [Security guide](docs/SECURITY.md) — trust boundaries, safe-use rules, and limitations.
- [Testing guide](docs/TESTING.md) — synthetic fixtures and regression checks.

## Safety summary

Treat transcripts and agent results as untrusted data. Do not execute target code to simplify recovery. Do not repair malformed output, synthesize evidence, or treat a validator pass as audit completion. Keep source-only mode when the required OS sandbox is unavailable.

## License

Released under the [MIT License](LICENSE).
