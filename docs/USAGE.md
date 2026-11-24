# Usage Guide

## When to use

Use this skill for an interrupted multi-agent audit with one or more of these conditions:

- an agent returned a structured result but the result was not persisted;
- a coverage ledger and durable agent results disagree;
- hunter JSON is malformed or wrapped in explanatory prose;
- a validator refuses Windows input despite exporting semantic functions;
- agent credit or quota exhaustion interrupted a wave;
- completed results need consolidation before any paid rerun.

Load the governing audit skill first. This skill supplies recovery mechanics only.

## Required inputs

Prepare these values before recovery:

| Input | Purpose |
|---|---|
| Audit output directory | Contains metadata, ledger, plans, prompts, and agent scratch directories. |
| Governing skill directory | Supplies the authoritative ledger contract, result schema, validators, and report schema. |
| Source ref and scope | Establishes whether recovered evidence still applies. |
| Expected agent IDs | Defines which transcript results are required for a complete recovery. |
| Explicit write approval | Authorizes replacement of retained run state when required. |
| Explicit rerun approval | Authorizes new agent calls and any additional credit spend. |

## Recovery workflow

### 1. Establish the resume boundary

Read `run-metadata.json`, the current ledger, wave plans, and assignment prompts. Compare the source ref, target, scope, profile, and write ownership with the proposed recovery action.

Stop and re-plan if the source changed, the worktree is dirty, scope or profile changed, or a prior ledger is incompatible. A matching source ref alone does not prove that every reviewed path is unchanged.

Inventory these states separately:

- durable valid results;
- completed but unmerged transcript results;
- malformed results;
- quota or credit failures;
- terminal ledger units;
- outstanding critics, validators, candidate validation, and reports.

### 2. Inspect durable results first

Look under each assigned `agents/<agent-id>/scratch/` directory. Parse existing results and correlate their IDs and owners with the assignment. Do not assume that a missing file means no result was produced or that a file named `result.json` is valid.

### 3. Recover missing transcript results

```bash
node scripts/recover-agent-results.cjs \
  --transcript /path/to/session.jsonl \
  --out /path/to/new-staging-directory \
  --expect hunter-a,hunter-b
```

The output directory must not already exist. The adapter writes:

```text
<staging-directory>/
├── manifest.json
├── results/
│   └── <agent-id>.json
└── raw/
    └── <agent-id>.txt
```

The adapter:

1. indexes `Agent` tool calls and their IDs;
2. derives one owner from an exact `agents/<agent-id>/prompt.md` path;
3. accepts only the matching `tool_result`;
4. parses one JSON object beginning at the first `{`;
5. requires top-level `units` and `candidates` arrays;
6. rejects malformed JSON, trailing content, ambiguous owners, and quota errors;
7. reports duplicate owners instead of selecting one silently.

Exit code `0` means every requested owner was recovered. Exit code `2` means requested recovery is incomplete. Exit code `1` means the command could not run safely.

Review `manifest.json` before promoting accepted results. Copy only accepted files into their assigned scratch directories under the governing write-isolation rules. Never recursively copy the staging directory.

### 4. Consolidate one hunter result

```bash
node scripts/consolidate-ledger.cjs \
  --ledger /path/to/coverage-ledger.json \
  --result /path/to/hunter-result.json \
  --agent hunter-a \
  --skill-dir /path/to/governing-skill \
  --out /path/to/staged-ledger.json
```

The merge requires:

- a top-level ledger array;
- unique returned coverage IDs;
- a live `in_progress` assignment owned by the specified agent;
- nonempty checks with valid owners, paths, methods, invariants, and results;
- `artifact: null` for source checks;
- aggregate `reviewed_paths` equal to the exact union of check paths;
- valid dispositions, unresolved facts, and fingerprint links;
- every new candidate fingerprint linked from a returned unit.

Exact duplicate candidates already linked elsewhere in the ledger are allowed. The adapter sorts the full ledger by `coverage_id` after merging. It leaves metadata, findings, reports, and notes unchanged.

Collect hardening and uncovered output in the current wave's parent-owned recovery notes. Do not convert those notes into findings.

### 5. Validate and write

Validate a staged ledger:

```bash
node scripts/validate-windows.cjs \
  --skill-dir /path/to/governing-skill \
  ledger /path/to/staged-ledger.json
```

Replace the original only after review and approval:

```bash
node scripts/consolidate-ledger.cjs \
  --ledger /path/to/coverage-ledger.json \
  --result /path/to/hunter-result.json \
  --agent hunter-a \
  --skill-dir /path/to/governing-skill \
  --write
```

`--write` and `--out` are mutually exclusive. A write validates both the original and merged ledger, writes a temporary sibling, validates that sibling, and renames it over the original. Re-read the final file and validator output.

### 6. Reassign malformed or failed work

For malformed output without terminal evidence:

1. preserve the raw output;
2. exclude it from consolidation;
3. leave affected units `planned` with null owner and empty evidence;
4. assign a fresh canonical owner;
5. re-establish evidence independently.

For a critic reopening a unit with terminal evidence, follow the governing `attempts` contract. Archive the exact prior record and reassignment reason, increment the wave, use a fresh owner, and clear live evidence. Never copy archived checks or artifacts into the new attempt.

For quota failures, preserve the error as diagnostic text and treat it as no result. Verify the source ref and assignment before requesting authorization for a rerun.

### 7. Resume under credit limits

Recover and consolidate completed work before spending anything. Reserve mandatory post-wave critics, the distinct final-clean critic, and candidate/final verification before launching hunters.

If reserves cannot be funded, do not launch hunters. Defer untouched units with the exact budget reason. If not all candidates can be validated, stop hunting and keep unvalidated units as candidates under the governing incomplete-run rule. Never place unvalidated candidates in final findings or claim complete coverage.

## Supported ledger contract

The supported format is the top-level array used by the governing audit lineage in this package. IDs are lexicographically sorted and unit states follow that skill's contract. Object-shaped ledgers and other audit formats are rejected rather than reshaped silently.

See [ledger recovery](../references/ledger-recovery.md) for merge and reassignment invariants.

## Windows validator adapter

```bash
node scripts/validate-windows.cjs \
  --skill-dir /path/to/governing-skill \
  findings /path/to/findings.json
```

Use the adapter only for trusted parent-authored documents when the installed validator exports `preflightJsonText` and `validateDocument` but its platform input path is unavailable. The adapter enforces a regular-file check and 5 MiB limit, then invokes the installed semantic functions unchanged.

See [Windows validation](../references/windows-validation.md) for the trust boundary.

## Completion checklist

Do not report recovery complete until all applicable checks pass:

- source ref, scope, profile, and ownership still match;
- every accepted result maps to the correct call, owner, wave, and assignment;
- malformed and quota outputs remain preserved and excluded from evidence;
- terminal units contain owned evidence and exact path unions;
- archived and live attempts remain distinct;
- the ledger is sorted and passes the installed validator;
- outstanding critics, validation, reports, and incomplete reasons are explicit;
- no target code or unrelated file was modified.
