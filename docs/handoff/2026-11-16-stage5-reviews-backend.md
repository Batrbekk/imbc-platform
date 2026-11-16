# Stage5 review backend handoff

State: bounded backend implementation and migration0028 local verification complete; independent Astra and coordinator acceptance remain pending. NOT05 uses an immutable context/payload bridge through the actual database renderer. NOT29 retains untouched rejected/partial decisions after Unlock with explicit source provenance; NOT31 uses actual changed revisions for the quarter anchor. Stage5 is not accepted yet. Base checkpoint: `e1c564b` on `feat/stage-3-profile`. No Git staging, commit, provider call, runtime deployment or non-local mail was performed by this agent. The coordinator’s migration0028 was applied only on the isolated PostgreSQL test database.

The production program remains unfinished outside this bounded REV01–09 backend scope. UI, external runtime/OIDC/browser/storage/notification delivery and migration/reconciliation acceptance are separate gates. The detailed contract and requirement mapping is in `docs/superpowers/plans/2026-11-16-stage5-reviews.md`.

## Behaviour

- SME queue uses canonical `manufacturer_profile` and actual active `review_assignment`, actual receipt time, bounded name/status/assignee/date filters and consistent count/page SQL. Unresolved legacy submissions remain visible with NULL assignment/receipt/BIN where unknown. No guessed expert, receipt or frozen map is created.
- Administrator queue, exact conflict reload and Assign/Reassign expose only name/status/assignee and technical metadata. Assignment options require persisted active IMBC experts. SME filter labels also retain exact inactive current assignees.
- Take assigns only; Open explicitly starts initial/resubmitted review. Pending Verified changes remain Verified. Take/Open enqueue no notification.
- Read/Open uses the existing exact seven-section locked graph and actual typed handlers. No manufacturer save, latest working data, source refresh, sample request or current dictionary fallback is performed. Contacts include labels scoped to actual frozen role IDs, including retired entries. Attachments retain exact captured version numbers.
- One section decision appends all applicable held certificate/document decisions and its section decision in one transaction. The server derives rejected-item comments from the single section comment. Foreign/duplicate/omitted subjects, ISO absence, stale decision UUID, failed scan/verification or final audit failure refuse/roll back the whole batch.
- Actor and optional target account locks are ordered by UUID before profile/assignment locks. Exact persisted `review.take`, `review.assign`, `profile.read` or `profile.verify` policy is checked in the same transaction. Scope/assignee denials are audited after rollback.
- Existing immutable publication, initial return/resubmit, safe pending-change publication and atomic NOT05 enqueue remain in the core, including the reviewed DD catalog publication callback.
- Canonical assignment expert is authoritative; mirror mismatch does not grant access. Explicit same-SME Take/Assign repairs only the profile mirror. Assign's expected expert compares to the canonical assignment, not the stale mirror. Diagnostics and full before/after audit cases prove that contract.

## Local evidence

- Node26 contracts build and full contracts suite: 376/376 passed in18 files (including concurrent coordinator Survey foundation).
- Node26 API types and build: passed.
- Real PostgreSQL55432 combined review/core/producer/HTTP target: 120/120 passed in six files, 34.04 seconds.
- Final focused workbench suite: 24/24 passed, including real persisted six-role/organisation HTTP cases, actual full AppModule review provider instantiation, failed captured scan, atomic database audit rollback, administrator/SME take/open/decision races, same-SME retention and mirror repair.
- First full API on55432 reached 1924 passed /133 skipped but committed DD guards refused their exclusive55433 requirement, with secondary setup-cleanup errors. That attempt was not accepted and remains recorded. Complete unchanged default-scope retry on reserved55433 passed 1982 tests /76 guarded skips in 110 files (106 passed/4 skipped), 244.79 seconds. This full result predates the subsequent mandatory notification/NOT29 fixes; no DD guard was weakened.
- NOT05 context/payload extension: actual restricted-role PostgreSQL target61/61 passed (29 workflow,19 core,13 recipient cases),22.73 seconds; API types passed. The loader validates exact unique closure,7finaldecision IDs,map/publication/status and legacyemptyparams; queue contains no comments/names/addresses. Canonical no-edit Returned resubmit COWs a new revision, HTTP publication succeeds, old rejected content/decision/mail context stays unchanged. No technical-state defect was confirmed and no frozen-state guard was changed.
- Final NOT29/NOT31 gate on fresh PostgreSQL55432 through0028:151/151 passed in eight suites,49.24 seconds, including35 actual workbench/lifecycle cases. It proves untouched Rejected retention, old-SME deactivation/new active SME, item-only document/certificate/file history across repeated Unlocks, partial section/comment/CAS retention, source final-own priority, edited-only invalidation, completed accepted-change quarter anchor and historical mail after later scan rejection. Earlier34-case gate passed all own cases and exposed two adjacent stale semantic assertions; those were corrected to assert the required new retention/anchor behaviour, without disabling a test or guard.
- Independent Astra actual default SMTP/renderer proof, NOT29 semantic closure and the post-fix complete API gate are coordinated by the parent; they must pass before checkpoint.

The DI case uses the actual complete AppModule/provider graph and synthetic loopback-only configuration, then closes before app.init/listen. Review HTTP tests use actual controllers, guards, filters and persisted PostgreSQL services; session resolution is the explicit test stand. This does not claim real OIDC/runtime boot acceptance. Every synthetic email uses `.local`; no real delivery worker was started.

## Owned manifest

1. `packages/contracts/src/review.ts`
2. `packages/contracts/test/review.test.ts`
3. `apps/api/src/modules/reviews/reviews.service.ts`
4. `apps/api/src/modules/reviews/reviews.controller.ts`
5. `apps/api/src/modules/reviews/review-scope.ts`
6. `apps/api/src/modules/reviews/review-assignment.service.ts`
7. `apps/api/src/modules/reviews/review-workbench.service.ts`
8. `apps/api/src/modules/reviews/review-actions.controller.ts`
9. `apps/api/src/modules/profiles/profile-review.service.ts`
10. `apps/api/test/reviews.integration.test.ts`
11. `apps/api/test/reviews.http.test.ts`
12. `apps/api/test/review-workflow.integration.test.ts`
13. `apps/api/test/profile-submit.integration.test.ts` — actual queue fixture and unchanged Unlock frozen-subject/map assertions.
14. `apps/api/test/profile-sections.integration.test.ts` — queue fixture signature only, actual expert/pool/audit.
15. `docs/superpowers/plans/2026-11-16-stage5-reviews.md`
16. `docs/handoff/2026-11-16-stage5-reviews-backend.md`
17. `apps/api/src/modules/reviews/review-result-notification.ts` — mandatory NOT05 immutable context/payload bridge.

18. `apps/api/src/modules/profiles/profile-submit.service.ts` — explicit immediately previous Unlock source, partial frozen retention and acceptance-only candidate hint.
19. `apps/api/src/modules/profiles/profile-unlock.service.ts` — preserved frozen subjects with only fully coherent Verified acceptance hints.
20. `apps/api/src/modules/profiles/profile-candidate.ts` — private immutable source field.
21. `packages/contracts/src/profile-submission.ts` — partial retained decision acknowledgement.
22. `packages/contracts/test/profile-submission.test.ts` — strict server-decided retention/partial DTO cases.
23. `apps/api/test/profile-review.integration.test.ts` — correct accepted-change quarterly date after Unlock result publication.

Coordinator integration outside this manifest: AppModule controllers/providers, frontend access routes in auth contracts and their tests. Shared file/auth/schema/transaction/renderer globals were not edited by this agent. Root owns SQL0028, its journal/snapshot and actual localized SMTP renderer tests. SQL SHA256:`295cd7851912beeecca9655cd3e5874c492905480517c3d9f0ae1d2babff6bc7`; snapshot SHA256:`af556c52eaec578db9fb988c0496f92e3b34e89be3e0ed8efe52e66e810701f9`. No raw restricted business documents belong in this checkpoint.

## Commands and private test resource

Use Node26 from `/Users/batyrbekkuandyk/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin`. Test PostgreSQL is `imbc-test-pg`, port55432, `imbc_auth_test`; credentials are derived privately from Docker inspect and never written to Git/output. Vitest serializes files when TEST_DATABASE_URL is present. Do not reset/reuse the database until the owning gate is complete and the coordinator has released it.

Target files: reviews.integration, review-workflow.integration, reviews.http, profile-review.integration, profile-submit.integration and profile-sections.integration. Full command: `pnpm --filter @imbc/api test` with the private test URL. Local logs live outside Git at `/tmp/imbc-stage5-review-final-target.log`, `/tmp/imbc-stage5-workflow-final-roles.log` , `/tmp/imbc-stage5-full-api.log` (failed wrong-port attempt), `/tmp/imbc-stage5-full-api-55433.log` (1982 pass) `/tmp/imbc-stage5-result-mail-loader-final61.log`, `/tmp/imbc-stage5-retention28-workflow33.log` (old publication assertion), `/tmp/imbc-stage5-retention28-workflow34.log` (two adjacent old assertions) and `/tmp/imbc-stage5-retention28-final-combined.log` (151 pass).

The separately guarded e-ondiris integration suite still selects migration0026 while instantiating the current Submit service. Its current-runtime setup must advance to0028 for its separate source acceptance run; the dedicated migration0026 upgrade proof remains separate. The default full API gate does not execute that guarded source environment, so it cannot claim that additional acceptance.
