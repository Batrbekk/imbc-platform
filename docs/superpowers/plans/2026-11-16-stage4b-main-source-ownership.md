# Stage 4b Main source ownership and refresh

Status: local implementation, registered migration 0026 and affected checks are ready for independent Astra review after LPS 0025 checkpoint de5f923. This does not claim production or live-source completion. The API prepares local canonical values; only the worker process registers the recovery loop.

## Requirements and boundaries

The full current MAN-06–12/21/25, DATA-01 and IMBC-07 requirements, full Main/site/source DBML field sets, and 13 November replies govern this change. Legal name/form/director/date/address, founders and the full OKED list belong exclusively to Adata. No separate legal-field confirmation, manual shareholders or competing e-Ondiris OKED is introduced. Adata unavailable is distinct from a received empty value, and no source failure is a due-diligence finding.

Editable company phone/email use one distinct validated e-Ondiris value first, then one distinct validated Adata value if e-Ondiris has no valid value. Conflicting valid values remain an issue, rather than selecting a row by position or silently falling through. A captured contact survives later absence/unavailability until a valid replacement or manufacturer correction; a producer's explicit NULL remains a correction.

This work owns Main handlers/source adapters, exact revision copying, initial section-core source preparation, new technical ownership/snapshot/outbox components, source-COW Main integration, and isolated source tests. Due-diligence evaluation, paid-provider calls, Adata job/scheduling/allowance and Azure belong to other owners. The provider access protocol remains unresolved; all source fixtures are synthetic local recorded responses.

## Storage and provenance

`adata_main_snapshot` captures only the allowed normalized Main legal facts, complete ordered OKED/founder lists and all distinct validated company contact candidates, with the actual attempt/BIN/profile/organization/completion timestamp and a content hash. There is no hidden/raw provider-body copy. An existing received attempt cannot silently supply different facts under the same immutable snapshot identity. PostgreSQL guards bind snapshots to the actual received receipt, completion timestamp, BIN and organization, independently check the returned basic.biin against that requested BIN, and enforce the complete allowed legal JSON field inventory. Migration 0026 initializes every pre-existing contact/site provenance as legacy_unknown, including frozen revisions and NULL values; it changes no business value and infers no previous source ownership.

Four new tables belong to the exact Main content graph: `main_source_pin`, `main_contact_ownership`, `main_site_ownership`, and `main_site_source_binding`. Submitted, verified, rejected and superseded versions retain their original pins and ownership. Before/after audit includes the complete rows and immutable snapshot links. Source snapshots are append-only; technical per-revision ownership can change only while its content revision is working.

Each contact field has its own owner: unclaimed initial blank, unknown legacy provenance, manufacturer, Adata or e-Ondiris. Unknown legacy nullable values are preserved. A manufacturer Save compares each normalized value with the canonical value its editVersion identified; only changed fields become manufacturer-owned. Saving the website does not adopt phone/email or site fields.

Each production site has stable identity and address/city/region ownership separately. e-Ondiris never infers a city/region. A source registration binds to one site identity; unchanged exact addresses may share one site. A source address relocation changes a source-owned address while preserving manufacturer city/region corrections. A conflicting relocation of a shared site remains flagged. Deleting a site records persistent suppression for its registration bindings, so another pull cannot re-add that registration or auto-associate a newly materialized product with a deleted site. Missing source rows do not delete sites or binding history. Existing manual/registry product identities keep their explicit local site associations, including NULL.

## First-read and Save coherence

The old virtual Adata overlay could change between GET and Save. The section core now permits local initial materialization before metadata and overview, inside actor → own profile → all sections locks. It rechecks the actual active assignment, and permits only a fresh unfrozen working initial Draft revision. Canonical Main values, exact source pin, ownership, completeness/editVersion and full system before/after audit commit atomically. Repeated GET is a no-op and does not silently repin latest Adata.

Save uses its editor revision's canonical values. A cold client that did not read the pinned version receives 409/reload. Source refresh after a GET creates a new COW working revision/editVersion; it does not reinterpret a stale submitted NULL against a newly selected source value. Legacy rows without provenance never acquire presumed source ownership just because a value is NULL or happens to match a source.

## Source transactions and recovery

The existing e-Ondiris pipeline applies the same Main planner inside its accepted whole-BIN COW transaction, preserving published pointers, local product associations, field corrections and before/after audits. Main-only `MainSourceRefreshService` handles new Adata results/quarterly refresh through the same retained-candidate resolver and seven actual completeness handlers. Active assignments, Submitted/Under review or pending sections defer without Send, unlock, publication, notification or profile-status changes.

The exact Adata terminal transaction calls `requestMainSourceRefresh(tx, profileId, organizationId, attemptId)`. It accepts only the owning Adata check's actual latest terminal attempt, writes the local retry outbox, and takes no profile/COW lock. The requested/applied watermark is the exact tuple (attempt ID, actual terminal completed_at, terminal state). Already applied identical terminal events are no-ops; an old/wrong-scope attempt cannot rewind the requested pointer. AdataScheduler legitimately reuses a not_configured/quota_exhausted attempt ID, so a subsequent received event with the same ID must requeue. PostgreSQL timestamps retain microseconds throughout pins, revision copying and worker failure CAS; JavaScript Date precision does not decide event identity. Recovery reads fresh source receipts under profile/section/BIN/source locks before locking the Main outbox. Terminal worker receipt → outbox and recovery source → outbox follow the same order, avoiding an attempt/outbox cycle. Latest-attempt selection belongs to scheduling before the terminal worker; terminal enqueue must not add an attempt → profile path.

The coordinated existing Adata job now calls the callback in its exact received/unavailable/not_configured/quota_exhausted terminal transaction. Receipt, prefills, outbox and audit roll back together on a failed enqueue. The registered minute recovery worker rereads fresh receipts after profile/section locks; fair NULLS FIRST ordering, isolated per-profile failure handling, bounded SQL and CAS on the complete event tuple prevent one failed profile or a stale acknowledgement from suppressing new work. Profile GET never calls a connector, increments allowance or sends mail.

## Sanitized provider adapter contract

A future Adata result sanitizer must retain the named Main subset used by `normalizeAdataMain`: `basic.biin` (exact requested string BIN), `basic.name_ru/name_kz`, `legal_form`, `fullname_director`, `date_registration`, `legal_address/legal_address_kz`, fallback `oked`, complete ordered `okeds/secondary_okeds` entries with `i/name_ru`; `founders.founders_dtl[].name`; and `kzCoContact.phones/emails` as strings or `{ contact }` entries. Optional absent/invalid blocks become absent values. A missing/null returned BIN is accepted only for {} or an object with all-null blocks and no Main facts. It creates no new legal snapshot: previous checked legal facts and their readAt remain, while the latest receipt state/completion/outbox watermark advance. Nonempty facts require the exact 12-digit string BIN, including leading zeros, with no numeric conversion or format repair. This binding adds no checksum hardgate for imported identifiers; a matching BIN with explicit blank source fields remains a real source change. No source alias, code-width repair, translation, IIN, shares, report payload or unrelated provider metadata belongs in the immutable Main snapshot. Legal text and full lists are preserved within the original transport byte boundary; conflicting names for one OKED code or unrepresentable legal text are rejected rather than silently changed.

## Verified acceptance gates

- Registered migration chain through 0026, including a real pre-26 frozen legacy migration case, uses only the owned local port 55435. Other agents' databases and Azure remain untouched.
- New checks: 28 pure ownership/allowed-capture/identity cases, 34 actual PostgreSQL profile/worker/runtime-role cases and one legacy migration case. Canonical first GET, exact A editor versus B source, cold/stale Save 409, verified legal/readAt preservation through empty/all-null no-data receipts, matching-BIN explicit blank facts, full 75-row legal lists, allowed-only capture, explicit corrections/deletion suppression, immutable sources, frozen children, atomic callback rollback, exact microseconds and both real same-ID scheduler/job retry paths are covered.
- Final affected profile/product/Main/contact/core/submit/review/unlock/onboarding/Adata/client/parser/notification/queue runner: 12 files, 260 passed (11:30:01–11:31:01), using the current identity/no-data guards. Independent source regression: 24 profile + 17 immutable storage + 65 pure source + 3 worker checks passed. Queue regression: seven passed with real local PostgreSQL queue cases. Notification worker's three cases overlap the affected runner; the final new 63-case runner passed at 11:49:39 (28 pure + 34 PostgreSQL profile + one migration) after the independent Astra shared-site repair, and the final 109-case source runner passed at 11:30:44. The three notification-worker cases overlap the affected runner; the combined runners cover 429 distinct test cases, not 432.
- The 10000-site HTTP draft and 1001-registration source batch pass. Deferred site checks validate the affected current identity/registration, while Main/pin checks still validate the full final graph, avoiding a complete site scan for every site row.
- Current API typecheck/build, Drizzle no schema changes, requirements map and diff whitespace checks pass. The new 63-case runner uses the registered migration chain and repaired source logic. The earlier 109-case source gate is retained, with its affected 24-case profile subset freshly rerun after the repair. Independent GPT-6 Astra re-review is bounded Approved: the reviewer independently passed63/63 and four additional planner controls for NULL/missing peers, a later consistent relocation and a manufacturer-corrected address. The four provenance tables participate in the exact revision copy/audit graph; stable business IDs/source snapshot IDs and full timestamp precision remain preserved. Three real two-connection tests observe the source reader blocked on the terminal writer via pg_blocking_pids, then verify bounded terminal enqueue/commit and fresh atomic capture for initial GET, e-Ondiris and Main-only recovery. Profile/section locks already use FOR NO KEY UPDATE and remain exclusive among writers while compatible with first-outbox FK KEY SHARE; source receipt SHARE locks remain intact.
- Independent Astra review is complete; the coordinator is recording the reviewed checkpoint. Approved e-Ondiris production transport metadata/endpoints and real recorded upstream access are unavailable; daily transport remains explicitly disabled. Due-diligence/provider quota work and later production stages are owned by the coordinator and are not marked complete by this Main delivery.

## Review handoff

Migration 0026 contains six new technical tables and all receipt/scope/frozen/provenance guards. The generated composite adata_main_snapshot(id, organization_id) unique index precedes the generated composite foreign key; schema/snapshot show no drift. The abandoned unregistered prototype SQL was removed; only the registered migration is authoritative. After independent approval, the three suites are promoted to `.test.ts` and use the standard API runner. Their PostgreSQL files remain serialized by EONDIRIS_TEST_DATABASE_URL; the profile suite keeps its bounded30-second case timeout locally. The temporary draft-only configuration is removed.

Owned additions: main-source-ownership schema, main-source-materializer/ownership/refresh/worker/module, 0026 SQL/snapshot, three registered Main-source suites, and this handoff. Owned integration changes: schema export/app-role/journal, queues/WorkerModule, Main handler/source/section preparation/revision graph, e-Ondiris Main planning, and four existing profile/worker test files. The Adata job/parser/client/stub changes belong to the coordinator and must be included together in the reviewed checkpoint. No Azure operation, paid source call or commit was performed by this owner.

The local PostgreSQL test processes are closed and port 55435 is released for the coordinator/reviewer. No additional migration generation or owned-file mutations are in progress. The three registered suites run with `vitest run test/main-source-ownership.test.ts test/main-source-profile.test.ts test/main-source-migration.test.ts` and the isolated EONDIRIS_TEST_DATABASE_URL. Global migration 0026 files are released for review/checkpoint; the coordinator controls the next 0027 generation.

Exact source-owner file manifest (repository-relative for staging):

```text
apps/api/drizzle/0026_stage4b_main_source_ownership.sql
apps/api/drizzle/meta/0026_snapshot.json
apps/api/drizzle/meta/_journal.json
apps/api/src/database/app-role.ts
apps/api/src/database/schema/index.ts
apps/api/src/database/schema/main-source-ownership.ts
apps/api/src/jobs/queues.ts
apps/api/src/modules/e-ondiris/profile-refresh.service.ts
apps/api/src/modules/profiles/main-information.handler.ts
apps/api/src/modules/profiles/main-source.ts
apps/api/src/modules/profiles/profile-sections.service.ts
apps/api/src/modules/profiles/revision-copy.ts
apps/api/src/modules/profiles/section-handler.ts
apps/api/src/modules/profiles/main-source-materializer.ts
apps/api/src/modules/profiles/main-source-ownership.ts
apps/api/src/modules/profiles/main-source-refresh.service.ts
apps/api/src/modules/profiles/main-source-worker.module.ts
apps/api/src/modules/profiles/main-source-worker.ts
apps/api/src/worker/worker.module.ts
apps/api/test/e-ondiris-profile.integration.test.ts
apps/api/test/notification-worker.test.ts
apps/api/test/profile-main-contacts.integration.test.ts
apps/api/test/profile-sections.integration.test.ts
apps/api/test/main-source-migration.test.ts
apps/api/test/main-source-ownership.test.ts
apps/api/test/main-source-profile.test.ts
docs/superpowers/plans/2026-11-16-stage4b-main-source-ownership.md
```

## Astra shared-site repair

Astra independently passed the initial 60 cases and reproduced one P2: r901 and r902 shared source site A; a newer accepted capture changed r901 to B but explicitly set r902 address NULL. The old planner moved the site to B while retaining r902 immutable binding to A, so the unchanged database provenance guard correctly rejected the whole transaction.

The planner now indexes all previous bindings by stable site identity and treats a NULL/absent peer as retaining the previous address. A conflicting relocation becomes an explicit source_site_ambiguous issue; the old shared address and each registration binding are retained. It does not split identities, change manual associations, weaken a database guard or modify historical source content. Nonconflicting source Main/product/legal facts and the accepted/applied watermark still advance atomically.

Before the fix, the new actual NULL-peer capture→store→recovery case failed, while its missing-peer control passed. After the fix, both actual cases and the pure NULL-peer case pass; the complete new suite is 63/63. They verify legal B advances, verified Main/products/source provenance/readAt stay unchanged, a manual product retains the shared site identity/note, and applied source hash matches accepted scope. The missing-peer control confirms the store still retains its previous current source row. Current typecheck/build, Drizzle no changes and diff checks pass. The affected existing 24-case e-Ondiris profile suite passed at 11:50:30 for the final review handoff; prior broad unaffected gates are not needlessly repeated. Only the planner, its two test files and this document changed for this repair.

Repair handoff: all local runners closed after 63/63 Main and 24/24 affected EO checks; port 55435 is released for Astra quick recheck. No staging/commit/migration/schema/VM changes were made for this repair.

Independent re-review outcome: Astra closed the shared-site P2, independently passed63/63 plus four extra planner controls, and found no remaining P1/P2 within this checkpoint. Production transport/browser/load acceptance remains separate. All55435 clients were closed before test promotion.

Post-promotion standard-runner evidence: three registered files,63/63 passed at11:59:14–11:59:24 on isolated55435. Only test registration and the local bounded timeout changed after the reviewed implementation.
