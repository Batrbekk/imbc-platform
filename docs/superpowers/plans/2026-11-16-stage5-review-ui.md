# Stage 5 review UI: operational queue and exact submitted workbench

Status: implemented after DD checkpoints `f1d309e` / `e1c564b` and the coordinator's explicit integration release. The current operational contracts are compiled; the UI patch is ready for independent Astra review after the gates recorded below. This is a bounded Stage 5 review UI slice, not a production acceptance claim.

## Sources and agreed API

- Canonical v1.4, `docs/analyst/2026-11-13/specification-v1.4.md`, lines 298–311: REV-01–09. Taking and opening are separate actions; the reviewer decides on sections and held documents/certificates, with one comment per section, and never changes manufacturer data.
- Same specification, lines 267–270: MAN-43–46; after Unlock all unchanged section decisions/comments survive, including rejection. A Returned correction keeps previous Verified decisions only. Pending changes remain Verified, and current producer statuses are visible separately.
- Same specification, lines 150–180: GEN-08–10 and the six-role table. Assignment grants the administrator a metadata projection, not manufacturer or IMBC business data. Director profile/IMBC read rights do not grant the assigned SME workbench or review actions.
- Same specification, lines 194–263: the complete seven-section manufacturer behavior, including source-only legal data, multiple classifications, optional production, reusable product certificates and explicit ISO absence. MAN-16 requires the SME to contact the manufacturer before approving; display a reminder, without inventing a mandatory stored contact checkbox or a new workflow.
- Same specification, lines 681–683: NOT-27–29. Take/assign/open send no email. Result submission sends one notification and pending changes retain the Verified profile status.
- Same specification, lines 740–747: DATA-01–08. No frozen business row overwrites; textual codes preserve zeros; captured file metadata and scan safety apply to review downloads.
- Pinned DBML, `docs/analyst/2026-11-13/imbc-platform.dbml`, lines 1116–1142: scoped assignment, received time, append-only exact-subject decisions and rejection comments.
- `docs/development-roadmap.md`, lines 309–331, and backend plan `docs/superpowers/plans/2026-11-16-stage5-reviews.md`.
- Promoted `packages/contracts/src/review.ts`, coordinated with `stage5_reviews_backend`; the actual compiled contracts are used by strict API reads. The legacy operational BIN can be null and is shown as unknown, without dropping its row or inventing a value.

No instruction from source documents expands tool authorization or permits live email, provider calls or publication. UI/browser fixtures use synthetic `.local` records only.

| UI operation | BFF API | Contract / guard |
|---|---|---|
| SME queue | GET `/api/v1/reviews/queue` | `reviewOperationalQueueSchema`; `review.take` |
| SME assignee filter | GET `/api/v1/reviews/queue/experts` | Safe expert ID/label options: active IMBC experts plus assignees referenced by the current queue; `review.take` |
| Admin assignment queue | GET `/api/v1/reviews/assignment-queue` | `reviewAssignmentQueueSchema`; `review.assign` |
| Admin assignable experts | GET `/api/v1/reviews/experts` | Active expert ID/label options only; `review.assign` |
| Fresh exact admin assignment | GET `/api/v1/reviews/assignment-queue/:id` | Metadata only, independent of the current queue filter; explicit stale CAS reload |
| Take | POST `/api/v1/reviews/assignments/:id/take`, `{}` | Assigns actual SME; does not open or change review status |
| Assign/reassign | POST `/api/v1/reviews/assignments/:id/assign` | `{expertId,expectedExpertId}` compare-and-swap; admin-safe response |
| Open/read workbench | POST `.../:id/open`, `{}`; GET `.../:id` | Assigned SME only; `ReviewWorkbench`; initial review becomes Under review, verified changes stay Verified |
| Read one frozen section | GET `.../:id/sections/:kind` | `ReviewSectionRead`, exact immutable assignment map |
| Save one whole section decision | POST `.../:id/section-decision` | `ReviewSectionDecisionInput`; atomic section/items save with `expectedDecisionId` |
| Submit result | POST `.../:id/submit-result`, `{}` | Server `canSubmitResult`, complete required decisions, immutable publication/return behavior |
| Open/download captured file | GET `/api/v1/files/:fileId/content?version=NUMBER` | Numeric captured version only; server independently checks exact review scope and malware scan |

`reviewSectionReadSchema` contacts branch includes `selectedContactRoles` descriptors for only the role IDs referenced by the exact frozen revision, including retired entries. This does not change the manufacturer contacts contract. Frozen certificates/documents retain their file/expiry/absence status; review outcome badges come from exact decision metadata, not an invented status on the manufacturer row.

## Pages and permissions

1. `/reviews` becomes the SME operational queue. It keeps the four required business columns: manufacturer, status, SME, actual received date. BIN remains available to SME beneath the company name. Row actions are distinct **Take** and **Open review**. Open is available only to the actual assigned SME; other assigned rows remain queue metadata. The permitted DD link remains separately available to SME.
2. `/reviews/assignments/:assignmentId` is the assigned SME workbench. The route opens that precise assignment, never a current profile selected by a URL profile ID. Open requests are idempotent server operations; no automatic mutation retry after a transport error. An explicit retry/reload resolves an unknown response. A stale/closed/reassigned assignment stops decision actions and does not issue manufacturer edit requests.
3. `/admin/reviews` is the administrator assignment queue. It has manufacturer name, status and assigned SME with assign/reassign controls. It never renders BIN, registration/receipt dates, contacts, sections, files, company/DD links or profile-download hooks. Technical assignment/profile/expert IDs are used for routing and compare-and-swap only.
4. Manufacturer, operator, observer and director do not mount operational queue/workbench queries. The root owns strict server/prefix route guards; UI checks are hints and query containment. Admin mounts only its projection. Director continues separate permitted company/DD reads.

Rows with `unresolved=true`, null assignment ID or null receipt time remain visible with a translated explanation. They offer no take/open/assign action and never substitute registration date for receipt time. Backend actions remain explicitly refused until canonical assignment reconciliation. Normal empty results, loading, failed reads and filtered-empty results are distinct states.

## Queue state and pagination

Use URL state, matching the strict backend query parser: trimmed manufacturer `q`, CSV `status` (`submitted`, `under_review`, `pending_changes`), CSV `assignee` UUIDs/`unassigned`, SME-only inclusive Almaty `receivedFrom`/`receivedTo`, `offset` and `limit` (default 25, maximum 100). Values within each dimension are OR; dimensions combine with AND. Unknown or malformed URL input is not forwarded. A reversed date range is explained and never submitted as a successful search.

Filter changes reset offset in the same URL update. Back/forward and a copied URL reproduce the state. Admin parsers do not accept or send received-date filters. A query key contains every effective filter and the projection role; old private SME data cannot fill an admin table. While placeholder data is being replaced, row mutation controls are disabled. Matching totals drive paging; clamp/reload an empty page after take/reassignment changes the result set. Preserve the queue URL through workbench navigation and return.

Safe SME option labels include inactive historical assignees present in the current queue, allowing their rows to be filtered. Admin can assign only active candidates. IDs do not appear as fallback names. Reassignment dialog preserves the selected expert after a stale CAS response, shows the newly loaded assignee, and requires explicit confirmation against the fresh token.

## Exact frozen section surface

Read all seven mapped section responses once per assignment to construct a pure local label graph; TanStack Query batches independent reads. Validate branch kind/revision against the workbench map. No current/working profile query, source refresh or manufacturer editor choice endpoint is used. A failed related section yields an explicit unavailable label/retry instead of resolving a later version.

- Main: reuse `LegalInformationCard` with its exact source payload, then pure company phone/contact email/website and ordered production-site cards, using selected region descriptors.
- Contacts: ordered full name/position/email/phone/role/focal-point cards from the frozen contacts payload and exact selected contact-role descriptors.
- Personnel: entered counts, derived total and nonresident subset, frozen organisation-chart/CV files. Do not mount the current organisation-chart sample widget in the review surface.
- Products: every stored manual/migrated/registry line, source provenance, EN/RU names, type and A–E group, textual TN VED/KPVED and source names, capacity/source units, DVC, register state/number/date and ENSTRU, note, selected site and shared product certificates. Labels for linked sites/certificates resolve only in this assignment's Main/Certificates revisions.
- Production: area/workshops/utilisation with exact decimal strings, selected processes, ordered general/equipment photos, equipment name/type/quantity, and linked product names from this assignment's Products revision. Empty or incomplete optional production remains readable and does not invent completeness requirements.
- Certificates: grouped company/product/other rows, exact type/custom name/number/issuer/dates/file, expiry status and distinct ISO absence. An absent ISO has no invented held certificate/file decision.
- Documents: exact type/custom name/file for every row and captured required-set descriptors. Missing/unavailable file state is explicit.

Reuse existing Base UI card/field/reference primitives. Inspection found that `ProfileAttachments` can still mount own-profile metadata hooks even when disabled, so the implemented `ReviewFiles` is a pure presenter of exact captured `ProfileFile[]`; it mounts no metadata polling/upload hook. Do not mount complete manufacturer forms: Main/Contacts/Certificates/Documents still mount current dictionary hooks, Contacts renders disabled editing controls, and Personnel mounts the current sample query. Existing disabled reference-list primitives are acceptable when supplied selected metadata and when no edit/picker branch is mounted.

Full text must remain selectable/readable, wrapped with `min-w-0` and `overflow-wrap:anywhere`; readonly textareas with hidden overflow must not truncate long source values. New pure display fields may use semantic `dl`/paragraphs inside existing cards. Localized reference names use `entryDisplayName`, dates/numbers use `useFormat`, decimal quantities use `format.decimal`, and stored names/user text are never translated. Unknown references get a human label, never a UUID.

All file links show original name, scan state/reason, byte size, uploaded date and captured numeric version. Links are plain anchors. No content link when `scanState !== passed`, missing version, or `canDownload=false`; no latest fallback. A separate **Open** anchor may use the same captured URL in a new tab with safe `rel`, and **Download** retains the captured link. Browser storage never holds profile data.

## Review decisions and stale intent

Each section shows its stored exact outcome/comment/time and whether it requires a fresh decision or reuses an unchanged decision. Only `reviewRequired=true` gets an editor. After Unlock an unchanged Rejected decision remains Rejected with its original comment and applicable item outcomes; a generic kept marker does not imply verification. Returned corrections retain previous Verified decisions only. Unchanged sections remain fully readable and cannot inherit an unsaved new outcome.

A partial source may retain its exact section decision with `reviewRequired=true` when required item decisions are missing or incoherent. Its existing outcome and single comment remain the editor baseline, and the atomic completion uses that decision's exact ID for CAS; the SME does not have to repeat the section choice. A source's later OWN section decision takes precedence over an inherited earlier decision. Once the batch is complete, another unchanged Unlock/Send retains that final OWN decision and its item outcomes readonly. Frozen item membership is immutable: a newly required document or changed requirement baseline causes COW and a new revision, rather than adding an item to the old frozen revision while retaining its decision ID.

The section editor contains a section Verify/Reject choice, applicable held document/certificate choices, optional file choices if the SME explicitly uses them, and **one section comment**. There are no per-field/per-item comment fields or one profile-wide replacement comment. Every held document/certificate requires an item outcome for an atomic section save; a Verified section requires all such items Verified. ISO absence is reviewed within the section only. Files do not require an invented mandatory click for every photo; an explicit rejected file prevents section verification according to server validation. Rejection at section/item level requires the one comment. All outcomes are saved atomically in one request.

`expectedDecisionId` comes from the exact current server section decision, null for the first save. Local edits have a separate dirty draft, never overwrite the saved badge. A stale 409 preserves the comment/outcomes, disables Save, and offers explicit Reload. Reload refreshes server metadata/token and comparison, retaining dirty intent; it does not silently reapply or submit it. Reassignment/unlock/closed errors disable review mutations and offer return/reload. A successful save marks exactly the acknowledged section as saved and invalidates workbench/section queries; a delayed response never updates a different assignment or supersedes edits made while the request was pending.

Switching sections preserves each dirty section draft in memory and keeps final result submission disabled; returning to the queue or unloading uses the existing unsaved-intent guard. Dialogs return focus to their trigger. No unsaved draft enables final result submission. Submit is enabled only when the server reports `canSubmitResult=true`, all local drafts are clean, and no request/read verification is pending. The final confirmation describes initial verification/return versus accepted/rejected pending changes without claiming operator publication before the server result. Submit has one pending operation; after acknowledged closure render the result and return-to-queue action without reopening the closed workbench.

Pending-change results retain Verified. The server determines dependency-consistent publication and returned/retained candidate sections; UI displays actual `publishKinds`/`retainKinds` with localized section names and does not reinterpret an accepted dependent section as rejected. Operator-visible previous values are never substituted into the SME's submitted section display.

## Ownership after DD checkpoint release

New compiled files:

- `apps/web/src/features/reviews/api.ts`, `params.ts`, `data.ts`, `queue.tsx`, `assignment-dialog.tsx`, `workbench.tsx`, `section-read.tsx`, `decision-editor.tsx`, `feedback.tsx`.
- `apps/web/src/routes/app/review.tsx`, `review-assignments.tsx`.
- `apps/web/test/review-workflow.test.tsx`, `review-assignment.test.tsx`, `support/review-workflow.ts`.

Minimal coordinated existing-file edits: `routes/app/reviews.tsx` delegates to the new operational queue; `src/router.tsx` adds two lazy routes; `components/app/app-shell.tsx` adds an admin assignment navigation item after Accounts; all three messages add a `reviewWorkflow` namespace plus `nav.reviewAssignments`; update existing `test/reviews.test.tsx` for actual receipt date/filter behavior while retaining required business columns/DD navigation coverage. The coordinator additionally authorized the stale start-page/navigation fixtures in `test/app-shell.test.tsx`, the SME-only status filter case in `test/filter-select.test.tsx`, and only the six-role queue-link block in `test/diligence.test.tsx`. Frozen DD record/history/403/409/provenance tests and DD/LPS feature sources are unchanged. Contracts/auth/API/schema/AppModule remain other agents' ownership.

## Acceptance evidence

1. Six-role query containment and route guards; admin network/DOM fixtures have no private fields, dates, company/DD/file links or operational endpoints.
2. Complete name/status/assignee/receipt-range URL filters, AND/OR semantics, copied-link/back/forward parity, malformed filters, matching totals and stable pagination. Received date differs intentionally from registration date; unresolved null stays unknown.
3. Take and Open are separate requests/actions; no optimistic Under review before open acknowledgement. Stale admin CAS preserves intent and refreshes assignee explicitly.
4. Every frozen section field/group/file is readable with long/null values, retired references and textual leading zeros/exact decimals. Foreign/current-working fixture data must not appear. Site/certificate/product labels come from the exact seven-section map.
5. ISO absence has no item/file approval; held cert/docs require choices; optional production/photos have no fabricated completeness/mandatory-click requirement; unpassed files have no links/verified actions.
6. One section comment and one atomic save payload; no manufacturer PUT/upload/source requests. Stale CAS, delayed-save/new-local-edit, reassignment/unlock, audit failure and cancellation preserve or clearly discard intent.
7. Saved decisions only enable one final Submit result. Initial return/resubmit, retained unchanged decisions, changed-section-only pending review and deferred accepted dependencies show actual backend state. Mutation failures do not produce a fake success.
8. Meaningful React+BFF fixture tests, whole web tests/types/lint/build, key/placeholder parity in en/ru/kk, then observed loopback browser desktop1280/mobile390 in all locales. No live IdP/mail/Adata/VM calls. GPT-6 Astra reviews the exact patch after gates; broader Stage 5 site-survey/AGAR/IMBC workflows remain independent tasks.

## Implementation verification, 2026-11-16

- Node 26, `pnpm --filter @imbc/web test`: **42 files / 524 tests passed**. The new assignment/workbench tests add 36 cases; the four original queue cases remain business assertions against the canonical API. Coordinated queue-shell/filter/DD integration target: **137 passed**. A pre-existing Catalog pagination case failed during the first concurrent full run and passed both the isolated run and the final full run without Catalog source/test changes.
- Whole web `typecheck`, `lint`, and `build`: **passed**. Exact owned source/test inventory is 14 new web files plus 10 existing web files; this plan is the 25th owned artifact. API/contracts/auth changes are coordinated independent ownership, not part of this UI manifest.
- Observed Chrome loopback fixture at 1280×900 and 390×844: EN, RU, KK; Take acknowledged separately before Open; seven frozen sections; exact decimal and leading-zero values; numeric captured file version links; section CAS 409 retained choices/comment through explicit reload and successful save; admin assignment dialog keyboard close returned focus; mobile editor/dialog had no horizontal clipping; director/operator workbench URLs redirected to their allowed dashboard.
- Pending-change result submission was observed as **Verified**, with actual acknowledged published-section labels. Browser fixtures made 66 API requests / 56 review requests; one intentionally simulated CAS 409, no unexpected API errors. No own-profile uploads, dictionary/sample/current working queries, live API/provider/email/VM calls. The temporary server and tab were closed and viewport reset; CUA completion was recorded.
- Local proof files: `/tmp/imbc-stage5-ui-smoke/desktop-queue-en.png`, `desktop-products-en.png`, `desktop-queue-ru.png`, `desktop-admin-kk.png`, `mobile-editor-en.png`, `mobile-documents-ru.png`, `mobile-certificates-kk.png`, `mobile-admin-assignment-kk.png`; request summaries `first-wave.json` and `final-wave.json`. `desktop-result-en.png` captured the acknowledged result while its confirmation dialog was finishing its closing animation, so it is supporting evidence rather than the main layout proof.
- Independent Astra review is the next checkpoint. No staging, commit, deployment, or production acceptance was performed by this UI task.

### Scoped Astra authority finding follow-up

The independent reviewer reproduced a section POST 403 after reassignment that left Save available. The fix is limited to `features/reviews/data.ts`, `decision-editor.tsx`, `workbench.tsx` and `test/review-workflow.test.tsx`, plus this documentation. A terminal 401/403 or `assignment_changed` now latches an assignment-wide authority barrier, marks the exact metadata stale, stops automatic metadata/section reads and disables every section/result mutation. The source draft is retained. Explicit Reload performs a fresh exact GET, checks the same assignment and actual assigned expert before accepting metadata, and retains the barrier on denied/closed/foreign-expert response; confirmed refusal hides business reads while keeping the dirty comment mounted and the queue-return action available. Result submission refusal also closes its confirmation and blocks further actions.

Six new cases cover section 403, closed 409, cross-section/result blocking, authorized rebase preserving the draft, result 403, a foreign-expert fresh response, and lost save response/CAS resolution (the parameterized terminal case contributes two tests). Final whole web: **42 files / 530 tests passed**; whole web types/lint/build passed. The focused pre-final review target passed 45 cases; the final full run includes the additional foreign-expert case and the final exact-read checks. Logs: `/tmp/imbc-stage5-ui-authority-{target,full,types,lint,build}.log`. Astra independently approved the fix: 145 scoped UI cases / 6 files and build passed; its observed loopback browser made 12 API / 11 review requests with only intentional section POST and explicit GET 403s, kept the draft, blocked all writes and hid business reads after refusal. Reviewer browser/server/tab were closed. No provider/VM/PG work was needed for this bounded authority fix.

### MAN-43 / NOT-29 unchanged rejection follow-up

The primary specification distinguishes Unlock from a Returned correction. `reviewRequired=false` is now rendered as an existing unchanged decision, without assuming an accepted outcome. The navigation and section badge show actual Verified/Rejected status alongside a generic kept marker; original comment/time and readonly document/certificate/file item outcomes remain visible. The retained explanatory label was corrected in EN/RU/KK. No frozen business data, capture metadata, current-source query or decision identity was changed. All required current decisions, including an unchanged retained rejection, may permit Submit result; its actual server Returned/Verified outcome is displayed without fresh clicks on unchanged sections. Email relevance is determined by the backend against the verified baseline; the UI creates no section-level mail operation.

The four new UI cases cover retained rejection in EN/RU/KK, original item/comment and numeric file evidence, readonly controls, and one Submitted result returning Returned without section saves. The focused review target passed **50 cases**; final whole web **42 files / 534 tests**, types/lint/build and diff check passed. Logs: `/tmp/imbc-stage5-ui-retained-rejection-{target,full,types,lint,build}.log`. Independent semantic recheck is pending; exact additional patch is `decision-editor.tsx`, `workbench.tsx`, `test/review-workflow.test.tsx`, the three `reviewWorkflow.retainedHint` messages and this plan. Survey's ten new unmounted feature files and separate plan remain outside this review checkpoint; they add no running route, translation namespace or test yet.

### Partial Unlock completion regression follow-up

This follow-up changes only `test/review-workflow.test.tsx` and this plan; the reviewed UI source and translations remain frozen. Two new cases cover a retained Rejected section with its original comment and an undecided already captured document: choosing the item alone completes the batch with the old exact section CAS. The second case starts from a legitimate individual-Core partial source with a later OWN section decision/comment, completes the batch against that OWN ID, then opens a separate next assignment that keeps the completed new OWN decision, comment and item outcomes readonly. It issues no section-decision POST in that unchanged next cycle. Neither fixture adds a document or changes membership in an existing frozen revision.

Focused review tests: **3 files / 52 passed**. Whole web: **42 files / 536 passed**; types, lint and build passed. Logs: `/tmp/imbc-stage5-ui-partial-unlock-{target,full,types,lint,build}.log`. No new browser run was necessary for the test/documentation-only delta; Astra's independent retained-Rejected browser acceptance remains separate evidence. Survey remains held and unmounted. Backend SQL/mail/public-model acceptance is coordinated independently by the parent.
