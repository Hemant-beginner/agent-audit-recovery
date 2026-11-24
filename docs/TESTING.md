# Testing Guide

Use synthetic fixtures when testing this skill. Never contribute real transcripts, target source, credentials, local paths, or private audit evidence.

## Static checks

Check script syntax:

```bash
node --check scripts/recover-agent-results.cjs
node --check scripts/consolidate-ledger.cjs
node --check scripts/validate-windows.cjs
```

Check package structure:

- `SKILL.md` exists and its folder name matches the frontmatter `name`.
- Frontmatter starts and ends with `---`.
- `name` matches `^[a-z0-9-]+$`.
- `description` is one line and no longer than 1024 characters.
- `SKILL.md` has fewer than 500 lines.
- Every relative Markdown link resolves.
- No unresolved placeholder markers remain.
- No README, changelog, or installation guide appears inside the installed skill directory; repository-level documentation belongs at the package root or under `docs/`.

## Transcript recovery fixtures

Create a JSONL fixture with these cases:

1. an `Agent` call and matching valid result;
2. a `Read` call whose result contains `units` and `candidates` but must be ignored;
3. explanatory prose before one valid JSON object;
4. malformed JSON with a missing quote;
5. a credit-limit error;
6. an expected owner with no result;
7. two valid results for the same owner;
8. an `Agent` prompt with no assignment path;
9. repeated records for one tool-use ID.

Expected behavior:

- only the valid correlated result is written under `results/`;
- malformed and quota output is preserved under `raw/`;
- unrelated file reads never become results;
- missing and duplicate owners appear in `manifest.json`;
- requested incomplete recovery returns exit code `2`;
- no existing staging directory is overwritten.

Example valid result shape:

```json
{
  "units": [],
  "candidates": [],
  "hardening": [],
  "uncovered": []
}
```

Use nonempty units when testing consolidation; the merge adapter intentionally rejects results with no assigned units.

## Ledger fixtures

Build a minimal ledger from the governing skill's schema. Include:

- two units deliberately stored in reverse `coverage_id` order;
- one live `in_progress` unit owned by `hunter-a`;
- one terminal unit that must not be merged again;
- checks whose path union differs from the unit-level path list;
- a source check with a non-null artifact;
- an unknown returned coverage ID;
- a mismatched owner;
- a candidate fingerprint not linked from any returned unit;
- an exact duplicate candidate already linked elsewhere in the ledger.

Expected behavior:

- valid merge stages successfully and sorts the complete ledger;
- aggregate `reviewed_paths` equals the sorted exact check-path union;
- checks move to `local_checks` without semantic changes;
- source checks require `artifact: null`;
- duplicate, unknown, mismatched, malformed, or unlinked results fail without replacing the ledger;
- the installed semantic validator rejects unsorted IDs;
- `--write` validates the original and temporary merged ledger before rename;
- failed writes leave no temporary sibling behind;
- `--write` and `--out` cannot be combined.

## Windows validator fixtures

Test the adapter against the installed governing validators:

1. a known-good ledger returns `0` and prints `PASS`;
2. an unsorted ledger returns nonzero and reports the ordering error;
3. an object-shaped ledger returns nonzero;
4. a known-good findings document returns `0` when the report schema is available;
5. a malformed findings document returns nonzero;
6. a missing validator export fails clearly;
7. a non-file input fails;
8. a document over 5 MiB fails before semantic validation.

The adapter must invoke installed semantic functions unchanged. Do not weaken validators to make fixtures pass.

## Privacy and secret scan

Before publication, scan every package file for:

- real names and usernames;
- email addresses and account identifiers;
- local filesystem paths;
- session IDs and transcript excerpts;
- target repository names and private run identifiers;
- credentials, tokens, passwords, and private keys;
- embedded audit findings or evidence;
- non-English documentation.

Generic words such as `token`, `credential`, and `session` are allowed when they describe security concepts or CLI arguments. Review matches in context rather than relying only on keyword counts.

## Publication verification

After uploading:

1. confirm repository visibility and ownership;
2. inspect the remote file tree;
3. fetch the committed files and compare hashes with the validated local package;
4. verify that Git history contains no earlier unsanitized state;
5. open the rendered README and documentation links;
6. rerun syntax and synthetic fixture checks from a clean checkout.
