# NDA, release policy and initial registration retry

Current implementation checkpoint follows `03c4722`/`0b3dbec` stage3c. The owner authorised continuation through the full production plan with several agents and an independent GPT-6 Astra reviewer. Existing Azure dev VM only; provided production servers and operational acceptance remain separate.

## Recorded code

- `c7e6dab`:59 explicit files, canonical account NDA evidence0022, release policy0023 and safe MAN-02 registration retry.
- `22a72d7`: the existing dictionary UI test waits for the newly refreshed row.
- `c31796d`: generic invitation compensation retains committed identities after lost acknowledgements.
- `6dad01a`:11 explicit files, bounded e-Ondiris capture/normalisation/immutable snapshot store/product reconciliation. Schema is not yet wired into the main migration or worker/profile graph.

NDA evidence retains original tick time/IP before password setup, links all account versions to the profile, preserves existing status/content, and provides strict own-account current-version GET/POST. Unresolved old evidence is preserved through the explicit R1 bridge. NDA UI and final contract retirement remain separate.

Policy has one75-row release dataset. SQL rows are authoritative and loaded before API/worker startup; empty/unknown/ambiguous rows fail closed. UI hints derive from the same dataset. Actor/file operations recheck SQL; guard-only routes update permissions with restart/rollout. Class G permits only SME mutations and SME/operator/director reads/dashboard. No administrator or manufacturer visibility/NDA condition grants LPS access. LPS API/UI remain unimplemented.

MAN-02 retries the same BIN/login email only with persisted initial-state predicates and strict current IdP user/credential proof. A password credential denies retry even without a timestamp; unknown proof produces a controlled failure. Profiles, all five statuses and NDA facts remain unchanged. The first and legacy manufacturer jobs recheck before delivery. Registration compensation waits the original identity lock and preserves any committed account after a lost COMMIT acknowledgement; uncertain lookup defers guarded cleanup. The later `c31796d` closes the same COMMIT-acknowledgement defect in generic invitations:9 additional PG cases and204 targeted regression cases passed; Astra separately approved that scope. These9 cases are not added to the2468 baseline below. PostgreSQL cannot make the external IdP change after the final check atomic; that boundary is explicit.

The source layer stores only21 approved registry fields, excludes hidden/localisation inputs from storage/hash, and requires trusted complete-BIN observation metadata. No feed order or file mtime becomes a version clock. Legal name/full OKED remain Adata-owned; registry renames colliding with manual identities produce ambiguity without partial application. The upcoming0024 integrates FK/BIN binding, durable outbox, source COW and worker, preserving verified/frozen/retained revisions and manufacturer corrections. The real daily transport remains unconfirmed and disabled.

## Verification

| Gate                                   | Result                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Main API regression                    | 93 files passed,1697 tests;17 source-store tests skipped by its separate DB variable |
| Separate immutable source-store PG18.6 | 17/17 passed again on55435, isolated `imbc_eondiris_test`                            |
| Total API cases for these checkpoints  | 1714/1714 across the two isolated runners                                            |
| Contracts                              | 334/334                                                                              |
| Web                                    | 396/396                                                                              |
| Requirements checker tests             | 24/24                                                                                |
| Sum of the four sets                   | 2468/2468                                                                            |
| Types/build/lint/generate/map/diff     | Passed;90 schema tables, no additional migration generated                           |

The main API log is private `/tmp/imbc-api-policy-man02-final.log`; web log `/tmp/imbc-web-policy-gate.log`. GPT-6 Astra approved NDA0022, policy0023, bounded source layer, and MAN-02 after two P2 fixes. Reviewer PG evidence is attributed to the implementers; its independent contract/seam runs are not double-counted. Working draft source-profile/LPS tests are excluded from these counts. The separate generic invitation fix is identified above rather than double-counting its204 shared regression cases.

One existing web test now waits for the newly fetched All-tab row rather than a row already visible in the previous tab;396 tests passed after that correction. Production UI behaviour was unchanged.

## Runtime and remaining delivery

Azure still has the preserved old public stack and the separate3b K3s build `8d48bbd` through0019. These code checkpoints are not deployed. Same-VM restore now compares27 catalog sets and has20 successful negative controls with unchanged data hashes; ordinary DDL repairs pg_dump's lost pg-boss partition array/PK declarations. Astra approved actual replay on the same target; portable source flags and a new-target capture/apply/compare are still being closed before the next R1 copy. No0011–0023 migration or edge cutover has run on the old VM application.

Next:0024 source integration and remaining source ownership, DD, SME/operator/director/observer/LPS cabinets, update schedules, migration, exports/subscriptions/pull API, forecast/STR/KTRE, complete CI/secrets/observability, actual load/security/restore/role/file/OIDC acceptance and IMBC UAT. See [the complete plan](../superpowers/plans/2026-11-16-production-delivery.md). This is a tested implementation checkpoint; the full production objective remains active.
