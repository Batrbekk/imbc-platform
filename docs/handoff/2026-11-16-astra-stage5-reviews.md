# Independent Astra review — Stage 5 review and assignment API/UI

Date: 2026-11-16. **APPROVED for the exact bounded local Stage5 slice below. No actionable finding remains open in this slice.** The three original findings and the dependent quarter-date regression were corrected and independently rechecked. This does not approve Survey, deployment, the complete v1.4 program, or production operation.

## Boundary and pinned sources

Baseline: `e1c564b5ccba09654103ff79e15e089de377e4da` (frozen DD checkpoint). The reviewer first isolated current source/tests and migrations0000–0027 in `/tmp/imbc-astra-stage5-review-20261116`, excluding raw analyst inputs and credentials. Corrections were copied by explicit manifests, with every source hash checked before copying and checked against the main checkout again after verification. API/web resolve the snapshot's own built contracts; other installed dependencies are linked locally.

Reviewed scope comprises the original16 backend artifacts and25 UI artifacts listed in the Stage5 handoff/plans; actual AppModule and auth integration; and the mandatory coordinated retention/email corrections. Final pins:

- Backend manifest: `/tmp/imbc-stage5-backend-code-manifest.json`,23 files including21 source/test files and two documents. Code aggregate `4de877d3608afe1019d983b42f81ae050e67e97c1b754ed30de0a593505e5cc2`.
- Root integration manifest: `/tmp/imbc-stage5-root-code-manifest.json`,20 source/test/migration files; manifest SHA256 `dce5ad08abf15ed3bb091164d422a039274a15db33b91f094608aa4bf2697f68`.
- Retention migration0028 SHA256 `295cd7851912beeecca9655cd3e5874c492905480517c3d9f0ae1d2babff6bc7`; snapshot SHA256 `af556c52eaec578db9fb988c0496f92e3b34e89be3e0ed8efe52e66e810701f9`. Snapshot metadata adds no table and changes only `review_assignment_section` versus0027.
- UI retention source/messages and authority-recovery fixes were copied from the UI owner's explicit manifests. Final test-only follow-up: `apps/web/test/review-workflow.test.tsx` SHA256 `c22bb904f6bc405bb782d046ff31156db4980b4c0c8679fe12f5e0e7926e421c`; UI plan SHA256 `3ecf2ea5849ab487f4435fcc0c519a0ff8549131cf22b9c23ffbd2cc9d913ff1`.
- Combined reviewed correction inventory: `/tmp/imbc-astra-stage5-final-pin.json`. Additional reviewer tests exist only in the temporary snapshot.

Primary requirements read: specificationv1.4 GEN08–11, REV01–09, MAN43–46, AUD01, NOT05/27/28/29, applicable file/frozen-data rules, and NOT31 for the touched acceptance-date behavior. Repository/web AGENTS, Stage5 backend/UI plans and pinned DBML were also read. Survey schema/contracts/module and reserved migration0029, deployment files, raw analyst/business inputs and broader v1.4 work are excluded.

## Findings and resolution

### P1 — Actual review notifications had no renderer — closed

Original reproduction: successful Submit result queued NOT05 with an exact assignment ID but empty params; the production default renderer supported only NOT02/03, so the real dispatcher permanently refused NOT05 before MailService. Injected-renderer enqueue tests had not proved delivery. Required NOT04/10 had the same missing-template seam.

Correction reviewed: real database-aware renderer; async dispatcher call with the job; WorkerModule factory injecting DB/environment; actual EN/RU/KK templates; exact seven decision IDs in queued NOT05 params; immutable closed-assignment/audit loader with strict profile, organization, source-map, decision and publication binding. Historical recipients remain tied to the submission. Current working revisions, later decisions, scanner changes or manufacturer edits do not replace a closed result's content.

Independent closure evidence: five actual SMTP scenarios passed using `createDatabaseNotificationRenderer`, NotificationDispatcher, MailService, Nodemailer, a restricted PostgreSQL app role and isolated Mailpit. No renderer or transport was replaced. Sixteen messages were captured: six localized initial results, two mixed pending-change results, four submission/unlock notices, two retained-rejection initial results and two retained-decision pending results. Checks include escaped comments, historical focal recipient, unchanged sections omitted, retained rejection comments included, accepted pending Production included even when `reviewRequired=false`, Verified retained, no operator/observer delivery, journal rollback on a real refused SMTP connection, successful retry and concurrent deduplication.

Evidence: `/tmp/imbc-astra-stage5-retention-workflow.log`; actual MIME, decoded scenarios and `not29-mailpit-index.json` under `/tmp/imbc-astra-stage5-mail-proof/`. Earlier missing-renderer reproduction is retained in `/tmp/imbc-astra-stage5-adversarial-api-final.log`. The stale unsupported-template fixture was changed from now-supported NOT04 to intentionally unsupported platform NOT01; its suite passes.

### P2 — Reassignment denial left stale mutation controls enabled — closed

Original anchor: `decision-editor.tsx:63` in the initial reviewed snapshot. A denied save403 restored Save without exposing Reload; other sections retained their stale controls. The backend still refused writes, but the required recovery behavior was missing.

Correction reviewed: terminal401/403/assignment-change latch propagates across the workbench, disables all section/result mutations, stops automatic reads, preserves dirty drafts and requires an explicit fresh GET proving the same assignment and current expert. A failed reload keeps the barrier and hides business content. A lost successful-save response still preserves intent and resolves through exact CAS.

The original failing independent regression now passes, together with owner regressions and the separate lost-response probe. Independent Chrome proof exercised failed Save403, disabled cross-section/result controls, preserved comment, and refused explicit reload403. Twelve API/eleven review requests included only the two intentional refusals; mutations were Open and the rejected Save. Proof: `/tmp/imbc-astra-stage5-ui-browser/terminal-403-draft.jpg`, `terminal-403-reload-refused.jpg`, `requests.json`.

### P2 — Untouched rejected decisions were lost across Unlock→Send — closed

Original anchors: `profile-unlock.service.ts:99` and `profile-submit.service.ts:183` before correction. MAN43 and NOT29 preserve decisions on untouched sections without an accepted-only qualifier. MAN44 separately defines the narrower Returned path. An actual manufacturer Unlock followed by editing Production and Send copied untouched rejected Contacts to a new revision and returned `decision:null`, `reviewRequired:true`. Append-only history alone did not satisfy preservation. Original failure: `/tmp/imbc-astra-stage5-retention.log`.

Correction reviewed: nullable exact source-assignment provenance in the immutable map; descending immutable source-chain resolution with final own decision priority; unchanged rejected, verified and partial item decisions retained after Unlock. `reviewRequired` describes whether completion is needed. A retained section decision may coexist with required completion; item-only history may be retained without a section decision. Real manufacturer edits and changed mandatory requirements invalidate the affected candidate. The normal Returned path retains verified decisions only. Candidate acceptance hints remain accepted-only. Historic notification provenance is separate from current Send scan/candidate checks. File decisions preserve the existing exact-version semantics, bounded to the historical assignment chain and captured version.

Independent real-PostgreSQL probes all passed:

- The original untouched rejected Contacts reproduction preserves its exact revision, decision and comment.
- Item-only document decisions survive two Unlock cycles and a former reviewer's role change to administrator; a new active SME completes the review. Historical source role does not erase valid old decisions.
- An incomplete retained section remains editable with the exact old comment/CAS. A wrong token rolls back; completion followed by another Unlock keeps the source's newer own decision.
- Canonical editing invalidates changed Contacts while untouched rejected Production keeps its decision and a null acceptance hint.
- A newly mandatory document blocks Send atomically; after removing that synthetic requirement, the unchanged original rejection is retained.
- Unchanged rejected Documents retain captured passed v1 even when latest v2 is pending.
- Initial and pending retained-decision results render and deliver the correct actual emails.

The current-source workflow also passes owner cases for document/certificate/file partial chains, old blocked SME, and historical notification loading after later scan rejection. SQL controls pass wrong source/scope/review-result source/obsolete assignment/working candidate/scan rejection, immutable history and migration replay. Constructed cross-section capture controls are explicitly DB compatibility evidence; they are not described as canonical manufacturer Send, whose file-owner purposes are disjoint by section kind.

UI closure: unchanged Rejected displays its actual status, old section comment and item outcomes without an editing form; partial retained decisions remain editable and send the original exact CAS. Two independent partial UI cases pass. Independent Chrome observation of a retained rejection allowed Submit result directly to Returned without a new section-decision POST:11API/10review, no errors, only Open and Submit result as mutations. Proof: `/tmp/imbc-astra-stage5-ui-browser/not29-kept-rejection.jpg`, `not29-result-returned.jpg`, `not29-requests.json`. This browser test used a synthetic BFF; PostgreSQL retention is established by the separate actual-service tests.

### Dependent NOT31 quarter-date regression — closed

Static review identified that acceptance still used `accepted.some(section.reviewRequired)` to move the profile's quarter date and audit value. Retained accepted pending changes can now have `reviewRequired=false`, despite being real accepted changes. The correction compares accepted revisions with the previous verified map. An independent actual lifecycle beginning with a historical profile creation date verifies that accepted retained Production advances both the persisted quarter date and audit snapshot to the acceptance day. This preserves the existing core behavior; it does not claim implementation of quarterly workers.

## Final independent verification

Node26 runtime: `/Users/batyrbekkuandyk/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin`. Database: dedicated `imbc-eondiris-test-pg`, port55435, `imbc_auth_test`; credentials derived privately and never logged. This is separate from the coordinator's source database on the same instance and from other API runners.

| Verification | Result | Evidence |
| --- | --- | --- |
| Actual workbench/HTTP workflow, owner cases plus15 independent cases | 50/50,26.58s | `/tmp/imbc-astra-stage5-retention-workflow.log` |
| Ten other affected API suites, including actual migrator/DDL controls | 149/149,27.94s | `/tmp/imbc-astra-stage5-retention-related.log` |
| Current API total across11 suites | **199/199** | Above two runs; no failing probe excluded |
| Web workbench/assignment/queue/shell/filter/DD target | **153/153**, six files,8.90s | `/tmp/imbc-astra-stage5-retention-ui-final.log` |
| Auth/review/submission contracts | **86/86**, three files | `/tmp/imbc-astra-stage5-retention-contracts.log` |
| Snapshot contracts, API and final web builds | PASS | `/tmp/imbc-astra-stage5-retention-{contract-build,api-build,web-build}.log` |
| Snapshot web typecheck | PASS | `/tmp/imbc-astra-stage5-retention-web-types.log` |
| Actual default-worker SMTP scenarios | Five passed,16 captured messages | Mailpit proof directory above |

The reviewer also checked administrative metadata containment, actual persisted six-role HTTP authorization, canonical assignment/mirror behavior, UUID-sorted current actor/target locks, denial auditing, take/open/reassign races, exact seven frozen sections, retired selected contact labels, numeric captured file versions, complete atomic section/item decisions with one section comment, CAS rollback, safe pending publication and the preserved DD projection rebuild hook. Original independent lock/audit/result-versus-reassign probes pass on the final snapshot.

Owner evidence is additional, not substituted for independent verification: backend151 tests/eight files and35 workflow cases; full web536 tests/42 files with types/lint/build; root actual current-source24 cases and migration/mail checks. The coordinator's broader full API run and complete production program are outside this report's acceptance claim.

The temporary review Mailpit used the same image as the existing local service, only127.0.0.1 ports18196/18197 and no relay. Every captured recipient ended in `.local`. All16 final messages were archived, then only the reviewer-created container was removed. Browser tabs and fixture server were closed. No source fixes, staging, commits, existing-service changes, VM/deployment/provider operation or non-local mail were performed by this reviewer. The only main-checkout write is this report.

Browser evidence: ![Retained rejection submits a Returned result](/tmp/imbc-astra-stage5-ui-browser/not29-result-returned.jpg)
