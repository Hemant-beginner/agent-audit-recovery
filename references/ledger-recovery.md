# Ledger Recovery

## Shape and identity

Treat `coverage-ledger.json` as a top-level array. Refuse object-shaped input instead of accessing a nonexistent `units` property.

Index units by `coverage_id` and reject duplicates. Preserve canonical references and semantic fields. After inserting, archiving, or updating any unit, sort the entire array with a code-unit lexicographic comparison of `coverage_id` and validate it with the installed validator.

## Merge invariants

For each result object:

1. Require `units` and `candidates` arrays.
2. Require each returned `coverage_id` exactly once in the ledger.
3. Require the ledger unit to be `in_progress` and owned by the result's agent.
4. Validate every check's owner, reviewed paths, method, result, invariant, and artifact shape.
5. Require `method: "source"` to have `artifact: null`.
6. Set aggregate `reviewed_paths` to the sorted exact union of check paths.
7. Copy checks to `local_checks`; do not synthesize checks from prose.
8. Set status from `disposition`, linked fingerprints, and unresolved facts without upgrading the claim.
9. Keep hardening and uncovered notes in parent bookkeeping for later critic planning.
10. Leave failed or malformed units unmerged.

The adapter performs transport and assignment checks. The installed validator remains authoritative for canonical IDs, state invariants, schema limits, and semantic collisions.

## Reassignment

Use two distinct paths:

- **No terminal evidence:** malformed or failed hunter output leaves the unit `planned`, with null owner and empty live evidence. Assign a fresh owner.
- **Terminal evidence reopened by a critic:** archive the exact prior `wave`, `status`, `agent_id`, `reviewed_paths`, `local_checks`, `result_fingerprints`, and `unresolved`, plus the source-backed `reassignment_reason`. Increment `wave`, assign a fresh owner, and clear live evidence.

Never copy archived checks, artifacts, or fingerprints into the new live attempt. Preserve strictly increasing attempt waves.

## Atomic update

The consolidation adapter defaults to staging. Review its report and run the installed validator before using `--write`. A write uses a temporary sibling file and rename; it does not update metadata, findings, notes, or reports implicitly.

After any write, re-read the ledger and validator output. Keep the source ref and assignment plan unchanged unless a new planning decision is explicitly approved.

## Incomplete states

Use the governing skill's exact incomplete reasons. Distinguish:

- completed result awaiting consolidation;
- malformed output awaiting fresh assignment;
- credit/quota failure with no result;
- deferred work that cannot reserve critics and validation;
- unvalidated candidates;
- source-only blockers that require sandboxed evidence.

Do not collapse these states into a generic “failed” label or claim clean coverage because all currently launched agents have returned.
