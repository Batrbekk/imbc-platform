# Stage 4a local-copy/profile integration

Status: application/worker wiring and registered migration 0024 implemented; 24 PostgreSQL integration checks and 163 affected profile/onboarding/queue cases passed. Independent GPT-6 Astra review is bounded Approved after three P2 fixes. Integration cases are promoted to the default test inventory. The full release/runtime gate and Stage 4b remain. This is separate from the Astra-approved parser/immutable storage layer. No approved source protocol or successful live daily copying is claimed.

## Canonical decisions

The current 13 November v1.4 MAN-06/09/10 text and DBML govern legal data/full OKED: exclusively Adata. The older change-log discussion about competing legal sources does not override these current requirements. e-Ondiris supplies only its allowed immutable DBML facts, product source data, initial production-address/company-contact defaults and register summary.

No positional mappings, source-label commodity guesses, region inference, localization, barcode/AGSK-3/NTIN/comments/raw hidden-body storage or live endpoint guesses are introduced. Unknown TN VED/KP VED references retain source code/name and null dictionary IDs. Capacity remains literal source text with units.

## Source-COW transaction

The queue sends only a BIN. `EOndirisProfileRefreshService` locks the profile, then all seven sections in the existing section-core order, then rechecks the active assignment in a separate statement. It defers every active assignment, submitted/under-review status or pending section without writing a new working revision, unlocking, sending or publishing.

After lock waits it acquires the BIN advisory/scope lock and reads the current source watermark and immutable versions. It never materializes facts from a stale queue payload. The source ingester takes BIN/scope/outbox locks and never takes a profile lock, avoiding the profile/source lock-order cycle. Outbox writes stay on the ingester's exact connection/transaction. Fresh accepted captures reset pending retry time; old/replayed source events do not rewind a watermark.

The baseline uses the existing working → pending → retained candidate → verified resolver. An accepted but unpublished candidate is preserved when no working/pending pointer exists. Unique MAN-25 manual name/TN VED matching preserves product identity, site identity, shared certificate links, manufacturer note and position. A registry rename collision with another manual identity blocks the whole candidate. An absent/inactive source registration is not deleted.

Every changed section is copied by the existing exact content graph into a new `source_refresh` working revision. A prior working revision is captured/frozen as `superseded` history, including exact file-version captures and retained file history with system actor. Submitted/verified/candidate revisions are copied without changing their metadata/content. Main/products before and after values are recorded in append-only audit with one operation ID, accepted source watermark, source/target revision IDs and source provenance. Completeness is calculated by all seven actual section handlers. Only working pointers and draft completeness change; verified pointers, catalogue rows, assignment decisions, profile/review statuses and notifications remain unchanged.

The durable `e_ondiris_profile_refresh` operational outbox records requested/applied scope metadata, attempt state and target revision. A deferred/ambiguous candidate remains retryable. Recovery selects never-attempted requests first, then the oldest attempt with a BIN tie-break, so repeated deferred low BINs cannot monopolize every batch. Failure rolls back COW, source materialization and acknowledgment, and does not stop unrelated BINs. A separate bounded retry transaction stamps only the exact selected observation/hash/last-attempt tuple; a newer accepted pending reset or another completed attempt wins. PostgreSQL timestamp text preserves microseconds for this comparison. Worker output contains operational status/counts, including failed count, without raw errors, responses or company contacts.

An existing product identity always retains its local site association, including an explicit null saved by the manufacturer or carried by a replaced manual duplicate. Only a genuinely new registry identity may receive an automatic unique exact-address site match.

## Initial Main defaults and later ownership gap

`planEOndirisInitialMain` performs a deliberately bounded initial prefill only on a never-saved working revision (editVersion zero, savedAt null). It preserves all existing values and existing sites. Source contact values pass the actual strict Main write validators; malformed/conflicting phone/email values produce diagnostics rather than arbitrary defaults. Source addresses are added once with stable site identities; region/city stay null. Products reuse an existing site only on a unique exact address match, preserving an existing local association first.

The readonly register summary is COW-updated from local retained snapshots. No observed record means unknown/preserved summary, not invented exclusion. A consistent earliest inclusion date is used. Legal fields/full OKED/website are copied unchanged.

**Open Stage 4b requirement:** later contact/site refresh needs durable per-field source/manufacturer ownership. A global editVersion or savedAt heuristic is insufficient: changing a website must not permanently prevent refresh of an untouched source phone. Explicit manufacturer clears/corrections must retain ownership. The current helper is an initial-only safety boundary and does not complete the full MAN-06/08 daily field-refresh model. Ownership should be persisted and derived from actual per-field edit/source differences, including first-read/first-save prefill provenance; do not guess ownership of existing nullable values.

## Integration SQL and remaining shared patches

`storage-expand.sql` creates the canonical immutable records and accepted whole-BIN scope state. `profile-expand.sql` adds the operational outbox and:

1. Replaces the old NULL-only product source-placeholder check with a nullable FK and source discriminator constraint. Historical nullable source links remain compatible; no upstream historical snapshot is invented for a frozen legacy row.
2. Binds every linked product to its owner's BIN and exact immutable source facts; changing an organization's BIN cannot invalidate existing linked history.
3. Checks TN VED dictionary identity and exact KP VED code/name pairs with deferred parent/child constraints, so parent-first COW/materialization can finish before commit validation.
4. Extends the technical revision metadata check to `superseded`; the existing frozen-content/revision/pointer guards protect old working history and prevent selecting it as a working pointer.

Implemented shared integration after the root checkpoint:

- Both source schema files are exported. `profile-content.ts` has named FK `product_line_e_ondiris_snapshot_fk` and source check, with historical nullable compatibility. Migration 0024/journal/snapshot contain generated canonical DDL plus the immutable/COW/source-binding/profile-created guards; a second Drizzle generation reported no schema changes.
- Application grants permit record SELECT/INSERT and `UPDATE(is_current)` only; business-fact UPDATE, DELETE and TRUNCATE are denied. Operational scope/outbox updates and append-only audit/file history are preserved. Actual runtime-role store/COW tests passed.
- API imports only the pure `EOndirisModule`; worker imports `EOndirisWorkerModule`. All loops/schedules are registered only by the existing worker process. The daily connector is explicitly disabled, and pg-boss output retains safe disabled/unavailable/quarantine counts/status rather than discarding them.
- The database profile-created trigger writes a local-only pending outbox from an already accepted source scope in the creation transaction, requeuing an earlier `no_profile` state without another pool/profile lock. Recovery materializes after commit and retries deferred/ambiguous scopes.

Remaining release work:

- Keep approved transport access/observation/coverage metadata unresolved until provided. A recorded/local import and a running cron do not establish successful live daily updates.
- Complete Stage 4b ownership and actual integrated API/browser/runtime acceptance, then obtain independent Astra review of the remaining integration.

## Verification

`test/e-ondiris-profile.integration.test.ts` belongs to the default `**/*.test.ts` inventory. It uses only the isolated local PostgreSQL 18.6 source database on 55435 and the registered migration chain through 0024. `EONDIRIS_TEST_DATABASE_URL` makes the default runner serialize files sharing that database. It never resets other agents' databases or Azure.

Nineteen draft checks cover actual Main/Products handlers and ProfileSectionsService writes, source-only payload rejection/local association edits, stable identities/shared certificates/sites, source COW of old working and verified versions, exact classifications/BIN binding, complete before/after audits, manufacturer contact clears/address corrections, contact ambiguity, disabled/recorded feed workers and whole-BIN page rejection. A profile-lock race proves that newer source metadata is reread after waiting. Real seven-handler Send creates an all-retained active assignment with Verified status and no pending pointers; source materialization defers, then after closing the assignment uses the retained unpublished candidate rather than losing its local note or changing the prior verified pointer. Registered-migration cases cover initial local outbox creation, application-role restrictions and 1,001-row exact product/classification materialization.

Five additional real PostgreSQL cases close the Astra findings: explicit null site association survives both existing registry and manual replacement paths; two eligible batches reach a healthy later BIN after 26 deferred low BINs; a pending extract causes a complete Main/products rollback but healthy work continues, repeated failed attempts preserve microsecond CAS, and passed scan permits retry; a newer source reset survives a stale failure stamp. All 24 integration cases passed. The separate 17 immutable-store cases run serially in the same source runner. API typecheck includes new services/module/integration files. No live source/server operations are performed by this bounded patch.

Affected regression: 163 cases passed in nine actual profile/Main/Products/Submit/Review/Unlock/onboarding/queue test files using a separate `imbc_auth_test` database inside this agent's own local container/port 55435. The parent's databases on 55432/55433/55434 are untouched. The notification worker's existing unit case also asserts safe e-Ondiris job output, and all three cases passed.

Final bounded handoff gates: API `typecheck` and `build` passed; `check-requirements.mjs --map docs/development-roadmap.md` passed (288 requirements, one stage per ID); `git diff --check` passed. Repeated Drizzle generation after the registered 0024 migration reported **No schema changes, nothing to migrate**. GPT-6 Astra independently reviewed the scoped schema/transaction/worker patch and five added scenarios, read the 24/24 runtime log, and closed all three P2 findings; no independent PG/VM rerun is claimed. These checks do not replace integrated browser/runtime acceptance or Stage 4b ownership.

After promotion, the default runner passed **44/44** in three files: 24 profile-source integration, 17 immutable storage and three notification worker cases. The source files ran sequentially against their guarded database. API typecheck/build, requirements map and diff check passed again. The unrelated new LPS contract export was built separately and is outside this checkpoint's Git inventory.

Owned migration/integration patch inventory (21 files):

- `apps/api/drizzle/0024_stage4a_eondiris.sql`, `drizzle/meta/0024_snapshot.json`, `drizzle/meta/_journal.json`.
- `apps/api/src/database/schema/e-ondiris-outbox.ts`, `schema/index.ts`, `schema/profile-content.ts`, `database/app-role.ts`.
- `apps/api/src/modules/e-ondiris/e-ondiris.module.ts`, `e-ondiris-worker.module.ts`, `initial-main.ts`, `profile-outbox.ts`, `profile-refresh.service.ts`, `profile-expand.sql`, `worker.ts`.
- `apps/api/src/app.module.ts`, `jobs/queues.ts`, `worker/worker.module.ts`.
- `apps/api/test/e-ondiris-profile.integration.test.ts`, `apps/api/vitest.config.ts`, `test/notification-worker.test.ts`.
- This integration plan.

The approved immutable normalization/storage files from base commit `6dad01a` are unchanged. Other agents' deployment and LPS files are outside this patch inventory.
