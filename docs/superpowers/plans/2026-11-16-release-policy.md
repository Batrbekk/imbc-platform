# GEN-10: release policy, canonical data class G

Authorised scope: continue the full v1.4 plan with several agents and independent GPT-6 Astra review, on the existing Azure dev VM only. This slice implements canonical DBML `policy_rule`; it does not claim production/UAT acceptance.

## One dataset and two evaluators

`packages/contracts/src/policy-rules.ts` contains the single75-row release dataset. Action/class names and scopes are shared. Strict validation rejects unknown/duplicate/ambiguous rows; explicit deny wins and no role receives every known right. `policy.ts` derives UI permission hints from this dataset; it no longer contains a separately maintained permission matrix.

Migration0023 adds the seventh data class `g_lps` and the canonical table. The production migration runner commits Drizzle's DDL transaction before atomically seeding/replacing rows from this release dataset. PostgreSQL does not permit using a newly added enum label within its uncommitted DDL transaction. An unchanged release preserves existing rule UUIDs; a changed release replaces the table as one transaction under a table lock. No UI or runtime CRUD edits the rules. Application grants allow SELECT and revoke INSERT/UPDATE/DELETE/TRUNCATE.

The global `PolicyModule` loads and validates SQL rows before API/worker startup. Missing, empty or invalid data fails startup; there is no static matrix fallback. `SessionGuard` uses this startup snapshot. Mutating actor checks under locks and file-record selection load SQL rules inside their operation snapshot; catalogue focal-point and organisation-chart sample selection also use SQL. A release requires restart/rollout to update guard-only requests such as search/dashboard. This is startup loading with operation rechecks, not system-wide hot reload.

Existing own-organisation, visible-profile, current-NDA and account-event scopes remain enforced by record services. The explicit `account_events` condition preserves the administrator's narrower audit scope; the DBML condition field is text. Class G allows SME read/CRUD/dashboard, operator and director read/dashboard, and denies manufacturers, observers and administrators. No manufacturer visibility/NDA condition gates G; class E dictionary rights do not confer G access. The LPS register itself remains a later implementation.

## Verification and remaining delivery

- 83 real PostgreSQL18.6/HTTP tests passed: fresh production migration with enum/seed, all release rows and denied pairs, all six roles on the actual guard with audit, idempotent seed UUIDs, persisted deny versus prior cached allow, locked-actor recheck, invalid/empty startup, and read-only application grants.
- 64 affected HTTP/file/guard seam tests and245 affected PostgreSQL integration cases passed. All334 contracts tests and web typecheck passed.
- GPT-6 Astra Approved for this slice; independently143 contract cases and64 affected seam cases passed. The reviewer read the PG evidence/tests without claiming an independent PG run.

Migration0023 is local implementation only. Azure still runs the isolated3b build through0019 and the preserved older public stack; no0022/0023 migration or edge cutover has been performed. MAN-02 registration retry, source-COW integration, LPS API/UI, broader final release gates and real operational acceptance remain separately tracked.
