# Independent Astra review — IMBC notes, engagement and product context

Status: **frozen IMBC15 native/API/contracts and Root mounted AppModule composition approved within the independently checked local scope; UI acceptance remains open**. This is a separate IMBC-15 review. The accepted SME review and bounded local Site Survey reports/pins are unchanged.

## Scope and evidence

Reviewed the canonical v1.4 specification (GEN-08..13, IMBC-15, DATA/MIG and AUD requirements), DBML canonical records and references, the records implementation plan and UI plan, and the owner’s changing backend draft at `/tmp/imbc-stage5-records-draft-20261116-01`. Scope is notes, historical engagement and product context only. AGAR/CDP, actual source-corpus reconciliation, the whole Stage 5 and production are excluded.

The initial ten-file snapshot is `/tmp/imbc-astra-records-static-20261116/manifest.json`. Source/plan/shared-runtime dependencies are separately preserved in `review-dependencies.json` under that directory. All findings below refer to this initial snapshot unless marked otherwise. Later owner edits are not implicitly approved.

| Initial artifact | SHA-256 |
| --- | --- |
| SQL0031 draft | `0a815f86c40150334f7015b52edbd827e1be7bf40c304ff7e5d887f562b041ec` |
| Contracts | `77aeb4ee12d54fd635af592def0f86d3bd6a099fa8f51484b41e7e56b3b3baed` |
| Service | `0cd49ff893474d46f054a7e6fc812027310651a61920a824146d53e4e71eb46f` |
| Scope | `a1ecb13c0e077de25edb4ada607a26ad2c168d5dfcc454f054a7e6e12f5e037a` |
| Store | `763b1973ddd5bbda1e9ad284b6b686ce4458a072e92197b9ac95fe99fa44a0a0` |

No SQL0031 was applied during this review. A six-case independent Node 26/contracts + PostgreSQL built-in-expression probe ran in a read-only transaction on dedicated port 55435. It evaluated the exact initial CHECK expressions against synthetic values; it did not create records, seals or migrations. Logs are `native-shape-probe.log` and `native-shape-probe-first.log` in the snapshot directory. The first log preserves the thrown URL error; the subsequent probe caught and classified it so all six cases could finish.

## Findings and owner follow-up

### P2 R1 — A reserved product identity can acquire context without established product meaning

Initial `apps/api/src/modules/imbc-records/imbc-records.service.ts:208` and SQL0031’s product-context seal check only the identity’s profile and organization. `product_line_identity` has no reverse constraint requiring a canonical `product_line`. A reserved identity can therefore pass the API and native association checks while never appearing in the current product options. The plan explicitly requires established canonical product meaning and rejects orphan UUID association.

Owner accepted this gap and is adding an exact canonical `product_line → section_revision → profile_section(kind=products)` association for first creation, scoped to the same profile and organization. An already established context and its immutable replay/history must survive later removal of a working product row. This must not introduce an invented Verified/current/public-visibility requirement. **Open until frozen API and native SQL negative/positive probes.**

### P2 R2 — Malformed profile scopes bypass the denied-request audit

Initial `apps/api/src/modules/imbc-records/imbc-records-scope.ts:31` throws the generic `notFound()` for an invalid profile UUID. The outer handler audits only `RecordsDenied` and `RecordsScopeMissing`; common `actorTransaction` audits only its private actor-denial error. Consequently the malformed route returns 404 with no scoped denial audit, unlike a syntactically valid missing/foreign scope. GEN-08/AUD-01 and the plan require refused scope requests to be audited.

Owner accepted the change to the same typed scoped exception used for missing profiles. **Open until an HTTP 404 plus exact post-rollback audit assertion on the frozen implementation.**

### P2 R3 — Invalid folder URLs throw instead of producing validation errors

Initial `packages/contracts/src/imbc-records.ts:15` chains `.url()` with a refinement that calls `new URL(value)` without guarding invalid input. Zod runs this refinement even when its preceding URL check has failed. Independent `safeParse` with `folderUrl: 'https://'` throws `ERR_INVALID_URL` rather than returning an unsuccessful parse. The normal API parser would therefore expose a 500 instead of validation 400 for an ordinary malformed field.

The independent first-run stack and six-case follow-up reproduce this against the copied contract and actual installed Zod on Node 26. Owner has received the input and proof. **Open until malformed text/host input is safely rejected by contracts and HTTP, with no write/audit-operation residue.**

### Native constraint/DTO mismatch — full sealed-DML proof pending

The exact initial SQL folder CHECK accepts a credential-bearing HTTPS URL, whereas the strict DTO rejects it. The exact initial note CHECK uses `btrim`, so tab-only and newline-only bodies pass SQL but fail the strict note DTO. All three mismatches were independently confirmed with PostgreSQL’s actual expressions and the copied contract. Ordinary valid URL/note controls pass both. Bare `https://` itself does not pass SQL; its problem is the throwing DTO above.

The SQL seal compares snapshots and SQL-produced views but does not execute the strict DTO validator. A fully matching raw audit/seal/row could therefore store one of these values and produce a record the API refuses to parse. This complete raw-transaction path has not yet been run; it is a targeted native-integrity acceptance concern rather than a claimed runtime exploit. Owner was asked to test the fully sealed path, not merely unsealed DML.

## Bounded design observations

- Current options select the exact internal product candidate graph, scoped by canonical profile/organization, independent of public visibility or assigned review. The intended first-association guard needs to be distinguished from historical stable identity reads.
- Historical EOI dates are aggregate child intents under one engagement CAS. There is no mail, queue, Survey, publication or LPS side effect in the reviewed service/store. Unknown nullable values remain distinct from false.
- API input is strict and excludes supplied author, source, organization and migration-only note-kind flags. Exact UTC microsecond CAS and idempotency fingerprints are represented explicitly. Replays return the stored operation receipt.
- The native design binds an operation to a newly inserted audit row by current transaction/xmin, full before/after normalized snapshots and actor/action/scope. Parent/child DML requires that operation; deferred completion checks the final aggregate. Append-only normalized history pins dictionary and EOI identities.
- New acquisition dictionary values are intentionally absent. Only DBML-approved priorities 1–6 are seeded. Existing retired references are retained/readable, with new retired selections rejected.
- Read consistency remains a specific runtime probe: `referenceOptions` counts and fetches items in different READ COMMITTED statements, while the profile lock does not serialize dictionary changes. A controlled dictionary insert/delete between these statements can test whether the response’s count and items refer to one coherent version. This was sent as a review target, not a confirmed runtime finding.

## Required independent acceptance after the frozen manifest

1. Copy all exact source/schema/contracts/journal/snapshot/app-role dependencies and verify hashes before/after tests. Run the actual shared production migrator through 0031, including nonempty 0030 upgrade and replay; preserve legacy/unresolved rows and previous review/DD/Survey/file/audit state.
2. Run restricted-role HTTP across all six roles and persisted role/state/organization/policy changes; verify Class C scope, missing/foreign/malformed audit behavior, zero-state DTOs and actual AppModule provider composition.
3. Reproduce R1–R3 on the initial pin where useful, then assert repaired API and native behavior. Include exact retained-product history/replay after current-row removal and independent product/reference options scope.
4. Exercise concurrent SME CAS, identical/different idempotency intent, immutable receipts after later edits, aggregate source/date swaps, historical child provenance and lost commit acknowledgement retry.
5. Attempt fully correlated raw DML with invalid author/action/scope/current transaction/snapshots/child pins/DTO-invalid text and URL values. Verify missing final DML and injected intermediate failures roll back row, children, operation and audit atomically.
6. Review the eventual UI separately, including director read-only behavior, admin/other-role containment, safe route return, dirty intent recovery and exact metadata/provenance. No UI/runtime acceptance is implied by this backend draft review.

No approval of a mutable implementation, shared composition, whole Stage 5 or production is granted by this initial report.


## Intermediate retained-navigation and grammar recheck

This is a second immutable snapshot of the still-changing owner draft, **not the final acceptance pin**: `/tmp/imbc-astra-records-static-20261116/current-navigation-grammar/manifest.json` (11 files). Contract SHA `cb3b2c95a31a650985e10dcb17a9104e2c9a47d015983936a80c0d59ade9c5ce`; service SHA `593202f07b0bb5addc71b74fb9aef7dcdba75714eab948f44bd520c064f6c8b5`; SQL draft SHA `841e8af669961fbe74a212d561535ebcf4f50ee10473b5535b27e01397adc646`.

Static review of `context-products` confirms that stored context rows drive membership independently of the current products list. Descriptors are selected only through exact stable identity/organization/profile and canonical product-section joins, preferring the selected internal revision and otherwise a retained canonical row. When no product row survives, names and revision remain null and `isCurrent` is false. Existing context reads/edits/history remain reachable. Exact-ID lookups are bound to the requested profile, with opaque refusal when an ID is absent; no public visibility or review assignment fallback is used. These are source observations; the owner’s new deletion/navigation test has not yet been independently run against a final pin.

Both current product and reference option count/items are now assembled in one SQL statement/CTE, addressing the earlier potential READ COMMITTED split-response issue. The approved priority1–6 entries moved to `reference-data/release/imbc_priority.json`; SQL0031 defines the dictionary but no longer seeds those business entries. Existing approved `programme.json` retains LC/LPS. The real reference loader owns parsing, release/specification provenance, insertion and replay. Actual loader/migrator composition still awaits final runtime proof.

### P2 R4 — URL grammar still differs between API and native SQL, and excludes valid HTTP(S) forms

The intermediate DTO uses an ASCII host class with JavaScript Unicode case-insensitive matching (`/iu`), while SQL uses PostgreSQL’s case-insensitive regex. Independent read-only PostgreSQL expression probes show that `https://K.local/folder` and `https://ſ.local/folder` pass the DTO but fail the SQL constraint. The API can therefore accept input that the native write rejects. No SQL0031 was installed to establish this expression mismatch.

The same custom grammar rejects ordinary bracketed IPv6 authorities, trailing-dot DNS hosts and Unicode IDN hosts even though they are valid absolute HTTP(S) URLs without userinfo; the source/earlier safe-URL contract provides no ASCII-DNS-only restriction. The safe parser should preserve ordinary supported URL forms while rejecting actual authority credentials and keeping SQL/API behavior aligned. A query string containing credential-like text or an `@` is not authority userinfo and must not be misclassified.

Owner and Root received the exact 22-case result in `grammar-result.json` and `native-shape-probe.log` under the second snapshot. Uppercase HTTP/HTTPS schemes, punycode, query strings containing `user`, `password` or `@`, actual userinfo rejection, empty hosts, highest/invalid ports, tab/newline/BOM-only notes, and 10,000/10,001 emoji length boundaries now have matching SQL/DTO results. The two Unicode case-fold inputs retain a native mismatch; the four valid IPv6/trailing-dot/Unicode-host controls are consistently but unnecessarily rejected. There was no URL navigation, DNS resolution or network fetch.

R1–R3 owner fixes and retained navigation still require the final frozen native/API/migrator proof. R4 is open pending a corrected grammar and independent recheck. No shared source, accepted AGAR pin, Survey pin, Git or provider was changed.


## Final frozen native/API recheck

**R1–R4 and the fully sealed native text/URL concern are closed for this exact backend draft.** No remaining actionable finding was observed in the reviewed native/API/contracts scope. This supersedes the earlier open static status; earlier findings and first-run logs are retained as evidence.

The frozen owner manifest is `/tmp/imbc-stage5-records-draft-20261116-01/OWNED-MANIFEST.json`, SHA-256 `9ec503eec0888ac8435ab46fefa6ac891108f012287f1b8a12a9be8076cd8d7c`. Exact key files:

| Artifact | SHA-256 |
| --- | --- |
| SQL0031 | `ee3b4b281fcd84f5b020311a4f44a127e8ab259f578ee445d225638252168b00` |
| Records contracts | `35ca2d3ea56571ec9f423dfeb1657c95d61474952003c79253ef3d3e5808bf41` |
| Records service | `593202f07b0bb5addc71b74fb9aef7dcdba75714eab948f44bd520c064f6c8b5` |
| Owner integration test | `d9ee28d5bcce8fe9182d6713fa3055a49fdc394b3fbad519a7a1db43b27621af` |

Independent runtime snapshot: `/tmp/imbc-astra-records-runtime-20261116`. Its `source-manifest.json` pins 535 copied application/contracts/migration/reference/test dependencies, with zero drift during capture. All production sources already matched the final owner pin; only the owner's final test addition was copied after the first exploratory run ended. `owner-final-manifest.json` and `final-pin-deltas.json` record this distinction. Post-run verification found zero drift in both owner frozen files and copied dependencies (except that explicit test update). No owner source was edited.

### Independent results

- **41/41 actual PostgreSQL/API tests:** 15 final owner cases plus 26 independent adversarial cases, `/tmp/imbc-astra-records-final-native-api.log`. The independent fixture invokes the actual shared production `applyMigrations`, with a journal-bounded temporary folder for the old boundary.
- **4/4 additional nonempty actual-migrator tests:** `/tmp/imbc-astra-records-final-nonempty-upgrade.log`. Before0031, actual Submit/Review decisions, DD override and real Survey publication created canonical history, exact file pins and a pending outbox. Unresolved legacy records and a synthetic existing notification-journal row were also preserved. All **128 old table hashes, including55 nonempty tables/207 rows**, survived0030→0031; replay preserved them. Hash artifact: `/tmp/imbc-astra-records-upgrade-hashes.json`. This includes application and pg-boss tables while excluding the expected dictionary definition/policy release rows. The journal row is preservation evidence only, not a sent-email claim.
- **380/380 contracts tests across19 files:** `/tmp/imbc-astra-records-final-contracts.log`.
- **API typecheck passed:** `/tmp/imbc-astra-records-final-api-types.log`.

Machine result: `/tmp/imbc-astra-records-runtime-20261116/bounded-native-review-result.json`. Independent added tests are `apps/api/test/astra-imbc-records-adversarial.integration.test.ts` and `apps/api/test/astra-imbc-records-nonempty-upgrade.integration.test.ts` inside that disposable snapshot only.

### What the actual checks established

- New context association rejects reserved/orphan and foreign product identities in HTTP/native SQL. Once established, context/read/history/idempotent receipt remains available after all current product rows are removed. The retained-navigation endpoint returns actual scoped descriptors or honest null names/revision; no public visibility or review assignment is required.
- All six roles were exercised on real guarded standalone controllers. SME/director reads remain ClassC, director mutation is refused, and other roles receive403. Persisted state/role/organization/policy checks defeat cached actor data. Malformed/missing/foreign scopes return opaque404 with exactly one post-rollback denied route audit.
- A fully correlated low-level audit+seal+row positive control succeeds, while malformed business values, wrong author/kind/source/scope/action/actor/current transaction, forged complete before snapshots, duplicate/foreign children, altered historical EOI provenance and missing final row/children fail atomically. Native source/history FKs and restricted privileges prevent deletion/rewrite; whole-record truncation remains denied.
- Four injected failure boundaries (audit, seal, row, children) roll back parent, children, operation and audit together. Parallel identical-key creates produce one immutable receipt; two SME CAS writes produce one winner. Reusing a key for another profile or operation conflicts; another actor owns its own key scope. A later edit does not rewrite the original receipt.
- Actual PostgreSQL COMMIT followed by an injected lost acknowledgement replays the single committed result. Actual ROLLBACK followed by a lost acknowledgement leaves no operation and permits safe same-intent retry. The first exploratory lost-COMMIT test failed only because Drizzle wraps the injected error; the assertion was corrected in the reviewer test, without product changes. First log retained at `/tmp/imbc-astra-records-exploratory-adversarial.log`.
- Controlled SQL barriers show that actor blocking and selected-dictionary retirement wait for the in-flight authorized transaction. A later request observes the blocked actor or retired new selection. Current count/items option DTOs use one SQL statement.
- Safe HTTP writes normalize uppercase schemes, IPv6, IDN, trailing-dot hosts and the two Unicode case-fold cases to compatible stored hrefs. Credential-like query text remains valid while actual authority credentials, malformed hosts and forbidden controls are rejected. HTTP result, SQL validity, idempotent replay and immutable history agree. Full raw SQL transactions reject the previously accepted invalid folder and whitespace-only note values. Historical read schemas do not transform stored values.
- Approved programme/priority release-loader replay preserves existing data. New restricted records writes work after0031; prior Review/DD/Survey services still produce valid canonical state and tier2/outbox after the additive migration. IMBC15 edits introduce no email, campaign, Survey, LPS or public ranking side effect.

### Composition boundary

The frozen draft contains schema/index/journal/app-role/dictionary integration proposals, but **does not register the new records controllers/service in Root's actual AppModule**. Real HTTP evidence above uses the actual controllers/guards/service with the explicit standalone test composition and fixture authentication. It does not prove that production routes are mounted. Root must register the module/providers, then provide a composed pin for a separate ActualAppModule DI/HTTP recheck. UI work is also separate.

Owner independently reports a full API gate of2128 passed/108 skipped, contracts380 and targeted71; that is corroborating owner evidence, not counted as an Astra full-API run. Its frozen `ACCEPTANCE.json` SHA is `4ebb0adc5c4fc652cdf3b04220c4c8bffa0a4c483f12c1300b4c797447e538cb`.

No approval is granted here for whole mounted application/UI, actual OIDC, source-corpus reconciliation, AGAR/CDP implementation, full Stage5 or production/providers. Accepted Survey and AGAR contract pins remain untouched. All reviewer pools, pg-boss fixtures and local HTTP servers used in these tests were closed; dedicated55435 remains available for the composed recheck.


## Root AppModule composition recheck

**Mounted records API composition is approved within the explicit local test boundaries.** This closes the AppModule registration limit of the preceding native review. UI/browser integration remains separate.

Root's23-file promotion manifest `/tmp/imbc-root-records-promotion-20261116-01.json` has SHA-256 `88c7dad6f94424021dc08b173625a0aa9660b5048f2999dcf3d14ea98d6697dd`; actual `apps/api/src/app.module.ts` SHA is `b36ac394b841c2988150d9a2368864ef60df051a3be6d692a3b4c6c2fad4225d`. Exact source and closure dependencies are copied to `/tmp/imbc-astra-records-composed-20261116`, with `root-promotion-manifest.json` and `source-manifest.json` (537 dependencies including the actual shared web API client). Pre/post checks show zero Root23 or copied-dependency drift. Test-only tsconfig/Vitest source aliases are separately preserved from their original source copies.

Independent result: **13/13 AppModule tests and API typecheck pass**, `/tmp/imbc-astra-records-appmodule-final.log` and `/tmp/imbc-astra-records-appmodule-types.log`. The actual mounted server handled **106 HTTP requests**:40 responses200,2 responses201,60 expected403,1 expected401 and3 expected404. Exact method/path/role/status trace: `/tmp/imbc-astra-records-appmodule-http.json`. Machine result: `/tmp/imbc-astra-records-composed-20261116/composed-review-result.json`.

This test creates the real `AppModule` with `NestFactory`, initializes/listens with the production `configureHttp`, and verifies the four actual registered records controllers reference the actual injected `ImbcRecordsService`. The production `DatabaseModule` pool connects as the restricted fixture role. Shared `applyMigrations` and `applyAppRoleGrants` initialize the isolated database; the actual `PolicyModule`, global `SessionGuard`, exception filter, audit service, records service and stores run unchanged.

The mounted checks cover note list/create/read/update/history and immutable replay; engagement create/read/history with canonical URL storage; product-context write/read/history; all three current/retained/reference-option routes; empty initial aggregates on a non-visible/unassigned Draft profile; director read-only access; refusal of manufacturer/operator/observer/administrator access; persisted role/state/org and policy changes beyond the initialized guard; and opaque missing/foreign/malformed scopes with their real audit records.

Explicit test boundaries:

- `SessionService.resolve` is the bounded authentication fixture, returning contexts for actual persisted test accounts. This is not actual OIDC/session-store acceptance.
- External initialization in `InfraModule.onModuleInit` and SMTP verification in `MailService.onApplicationBootstrap` are skipped. All business providers are still constructed; no records service/controller is substituted. Queue/mail send methods assert they are never called. This test does not establish Valkey, queue startup, SMTP, S3, ClamAV or provider availability.
- Nest's empty200 representation of a null aggregate is handled by the actual shared web `api.ts`, which returns null after an empty successful JSON response. This real client path passed for both empty engagement and product context. The first reviewer test incorrectly called raw `Response.json()` and also counted an unauthenticated401 as a known-user scope audit; both assumptions were corrected only in reviewer tests. Initial log/trace are preserved. The three authenticated missing/foreign/malformed scopes each have their expected audit. No production fix was needed.
- An initial reviewer typecheck caught JSON values typed unknown and missing copied web dependency resolution; the test now validates the actual DTO schemas and explicitly resolves web dependencies. Final typecheck passes. These were harness corrections, not product findings.

No remaining actionable finding was observed in this Root23 mounted API scope. The earlier45 native/380 contracts evidence remains applicable because the underlying frozen records sources are unchanged. The immutable pre-composition report is preserved at `/tmp/imbc-astra-records-runtime-20261116/native-review-report.md` for its previously published hash. All local HTTP/application pools and fixture roles were closed/cleaned. UI/browser composition, real identity/external providers, source-corpus reconciliation, AGAR implementation, fullStage5 and production remain open.
