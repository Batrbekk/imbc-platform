# Astra independent IMBC15 UI/composition review

Date: 2026-11-16. **UI-R1/P2 and UI-R2 history transport are closed on the promoted code pins.** No other actionable finding remains in this reviewed UI scope. Root promotion equality is verified; final composed local acceptance still requires Source's corrected actual browser proof. Backend/native and mounted API approvals remain separately documented in `2026-11-16-astra-imbc-records-review.md`.

## Finding and correction

The initial RecordsPage and actual AppShell discarded a dirty editor when a stale shared `/auth/me` query received503 on tab focus. No route transition occurred, so the unsaved-changes blocker could not prevent the loss. Independent regressions reproduced this in both the page and real mounted router. The explicit actor-probe503 recovery had worked; the ordinary background query was the missing case.

The correction retains the Outlet only for the records route, with a previously valid session and a transient failure. RecordsPage keeps the editor mounted in memory while hiding all Class C content and blocking writes. The error remains latched after a later Me200; one explicit Reload must prove the same actor, current private scope and exact record. A distinct subsequent failure establishes a new barrier. Authentication expiry and identity changes clear the old private draft. An accepted in-flight write does not repopulate private content before fresh authorization. Shared-shell behavior on other routes remains unchanged.

## Exact evidence

Initial Root48 manifest `/tmp/imbc-root-records-composed-20261116-01.json`: SHA256 `853c32a4a56334dfde4d2183e2eda2230e679a350cc86fc1ccacf5d199820d6f`, aggregate `59f27d6c2446c6881ed405f619fdf92d6774f72c52abf8e835aac51bd5957f07`.

Corrected owner26 aggregate: `c176071ea64dd33002aa4d0cedb3fbe2714524ba73813b81ae467d2ba35c236c`. Exactly four delta files were copied to a separate snapshot; the remaining original sources were retained:

| File | Corrected SHA256 |
|---|---|
| `apps/web/src/components/app/app-shell.tsx` | `d8af77df2d63994a18c617b56f3889eb6c96e2c3bf2f9d9b74fe3dc9cebe22ec` |
| `apps/web/src/features/imbc-records/page.tsx` | `110c535fe7e65c7fcb7c0355364da3180658268314fd5cd9c847dd5050db1b74` |
| `apps/web/src/router.tsx` | `475bb27da62d197c7b4d774488fba0d134b7c108bc771fcc4ea4bbf03d31b10c` |
| `apps/web/test/imbc-records-write.test.tsx` | `0f54acfa9f80638a164a872a099f719cf4c10fa1e3d07033366f5d53bf09480a` |

Snapshot `/tmp/imbc-astra-records-ui-corrected-20261116` has796 captured source/configuration/test/reference dependencies, declared snapshot-only contract aliases and linked local package dependencies. Exact hashes, aliases, test source and log hashes are in `final-source-manifest.json` and `fixed-ui-review-result.json`. All26 owner hashes matched before and after review.

**Independent Node26 results:709/709 tests,49 files; typecheck, lint and production build exit0.** This comprises695 owner tests and14 additional reviewer cases. The additional cases cover:

- write401/403/404: Class C disappears while same-actor recovery retains the draft;
- history401/403/404: previously displayed private list and history disappear;
- complete separate engagement before/after snapshots, source sets, corrected and added historical EOI dates and provenance in EN/RU/KK;
- wrong-organization metadata cannot release the barrier;
- original background503 page/router regressions, Me200-only refusal and one-click explicit recovery, followed by another failure;
- changed identity and expired authentication after a transient barrier clear the private draft.

The full gate also reruns precise UTC6 CAS, immutable unknown-outcome body/key retry, concurrent EOI-child retention, current versus retained product navigation, retired selected references, six-role containment, safe queue/company returns with filters, network-failure recovery and accepted in-flight response containment. It exercises the current common router/session integration, not only a detached editor.

Primary final log: `/tmp/imbc-astra-records-ui-fixed-whole.log`; companion `fixed-types`, `fixed-lint` and `fixed-build` logs share that prefix. Initial failing proofs remain in `/tmp/imbc-astra-records-ui-composed-20261116` and its `initial-ui-review-result.json`. An initial full-suite harness lacked the explicit Keycloak translation import; after adding that hashed dependency all691 initial tests passed. Extra test drafting initially had an invalid `sme` fixture enum and mock typo; corrected to canonical fixtures without product changes. Those logs remain preserved.

## Boundaries

Source's first browser run was paused on UI-R1; its29 HTTP checks are partial evidence only. This reviewer did not use CUA concurrently or change shared application code, Git, providers or accepted Survey reports. Corrected actual browser evidence remains pending. This does not accept real OIDC, external providers, production corpus, Azure, AGAR/CDP, whole Stage5 or production.

Earlier auth-correction promotion check, before the history delta:49 manifest SHA256 `35e8549acd9728fceea0e16fae67e1d1bd9a4ffc5a0205d0ede32a46f89a7630`, aggregate `4cdce7b0af9dbee727cd2c4261a04085be168e85487448890dc71070141ce81c`. All49 files exactly match both the independent tested snapshot and current worktree; backend23 is unchanged. Evidence: snapshot `root49-equality.json`. This required hash verification only, not repeating unchanged tests.

## UI-R2: first history request transport — closed

Source's actual browser/API run found that the client serialized an explicitly undefined optional cursor as `beforeId=undefined`. The real API correctly rejected it400, preventing initial history display. Root promoted exactly two files: `features/imbc-records/api.ts` SHA256 `d72a15c1203e1608f9f3463344d54de73385f73545a9514d871ede71434b8f07` and `test/imbc-records-read.test.tsx` SHA256 `446f374ebefa2e977e83a77e257577ddbc262e9f12dba506e6c1aa62ef24f013`. The query builder now omits an absent cursor before parsing/serialization.

Three additional independent cases exercise notes, engagement and product-context history, both initial `?limit=25` and next `?beforeId=<exact UUID>&limit=25`, validating the serialized query with the real server contract. All three fail against the preserved pre-fix source with an invalid beforeId and pass after correction. The first positive fixture had a mismatched history timestamp; correcting it to the exact after.updatedAt changed no product code. **83 affected tests passed**, comprising66 current records cases,14 previous reviewer cases and3 new transport cases. Independent typecheck/lint/build exit0. The full696 owner gate is Source's evidence; the prior independent709 auth-correction gate remains valid for its unchanged code and dependencies.

Current Root49 manifest SHA256 `e461228ee669864d23dfaf9fb628ce6cf5fd2515650eff04f3526f2bee9ea415`, aggregate `978ed5d4fd2fe8734c7f0436cf0992b158a39b50f7116ad265c57bd09eae1c79`: all49 current-worktree files match the independently tested `/tmp/imbc-astra-records-ui-history-20261116` snapshot. Evidence: `history-source-manifest.json`, `history-review-result.json`, `/tmp/imbc-astra-records-history-fixed-target-corrected.log` and `/tmp/imbc-astra-records-history-old-repro-corrected.log`. Backend23 and auth P2 code are unchanged.

Corrected final browser proof remains pending. Source reports that CUA Chrome kept document visibility forced to visible, so the browser run cannot establish a natural focus-refetch trigger. The independently controlled actual router/TanStack focus tests supply that specific proof; no natural-browser-trigger claim is made.

## Final Records local composition — accepted

Final independent artifact review joins the previously proven backend45 native/HTTP cases, actual AppModule13 cases/106 requests,709 auth-correction web cases and83 history-affected cases with Source's completed real API/browser evidence. **This accepts the bounded local IMBC-15 Records composition; it does not accept whole Stage5, revised file/LPS work, live providers or production.** Earlier pending-browser statements above describe their earlier checkpoints and are superseded for this slice only.

Source report `/tmp/imbc-stage5-records-browser-authfixed-20261116/REPORT.json` SHA256 `e4a32d2730709c53dcc91a5cb99914dbdb946d4f91d77402b15796fad7748379`; artifact manifest `e4712c1936b58ab12465c1c1c12259b1f3a3f32a16407d98e7d6d4a0e8d48e48`. Independently checked all49 listed artifact hashes, typed37 native controls,17 browser grid/navigation records, raw249 request/status totals, exact successful first/cursor history, retained-product COW proof, mutation/replay and cleanup evidence. Sample EN/RU/KK mobile screenshots show readable dialogs, readonly retained history and preserved recovery drafts. One KK animation-time geometry sample reports350.33px bounding width against358px scroll width; its screenshot/document fit, so the evidence does not support an absolute claim that every transient dialog measurement matched.

The actual browser covers SME/director EN/RU/KK at1280/390, four denied roles, Submitted/unassigned queue return with filters, CAS409, committed-response loss with exact replay, genuine persisted scope403 followed by transient auth503 and explicit same-actor/current-scope recovery, and current-product removal retaining immutable context/history. Raw249 includes the original repaired history400, expected refusals/faults and six redirected home404 outside the narrow stand. These are not hidden or counted as unexplained success. SessionService/me are fixtures; business controllers/guards/services and restricted PostgreSQL31 are real. Natural focus was not observable in CUA, and remains supported only by the separate independent deterministic router/library-event tests. No files, SMTP delivery, real OIDC or external services were exercised by this browser run.

The tested browser pin is history Root49 `978ed5d4…`. Final application manifest `/tmp/imbc-root-records-final-application-20261116-01.json` SHA256 `4c44553a9c2acc0370dcbe27395cb242eda862907db501b2bb2e44ed50f3d8ab`, aggregate `a752af9364f472fde9fbb5f97b3001b8f709188260311ba9de26e833d3f10b4a` uses its explicit sorted path-NUL-hash-LF algorithm. Every current file matches; its sole delta from the tested49 is one trailing space removed from dictionaries.ts line78. UI26, records DTO/service/native schema and mounted AppModule are unchanged. This whitespace-only delta needs no new behavioral test.

Cleanup artifacts confirm own servers/tab stopped, viewport reset, expert restored, app role dropped and zero other DB connections. Only canonical Send/Unlock notification jobs exist; no Records campaign or mail side effect was introduced. Machine closure: `/tmp/imbc-astra-records-final-composition-20261116/final-composition-review-result.json`. The official073fe16 source leaves IMBC-15 behavior intact but requires separate file-contract and LPS changes; existing Records acceptance does not imply completion of those changes.
