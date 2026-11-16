# Astra independent AGAR native/integration review

Date: 2026-11-16. **No actionable finding remains in the bounded native graph, tier3 writer, standalone controller and file-access composition reviewed here.** This is not full AGAR, actual AppModule, browser, provider, Stage5 or production acceptance. The earlier accepted three-file contract review remains separate.

## Source pins and scope

- Root9 v2 manifest: `/tmp/imbc-agar-root-integration-draft-20261116-01/OWNED-INTEGRATION-MANIFEST-v2.json`, SHA256 `2bc66af9bb2efc4b1ce6ee74475d7e0078704b595624916563cd946f9993a15d`. Native guard SQL SHA256 `c9b7246c07aa5d3dffb15bf408ac2d379ddb024f94ae9beda79de6962df48947`.
- Final owner18 manifest: `/tmp/imbc-stage5-agar-backend-draft-20261116-01/OWNER-MANIFEST.json`, SHA256 `2517f29c3e0c193c32df56e6c3d6195170a6e8765fa198c2844373efc39b1bf4`. Owner expansion SQL `c4598f824507e172c38841a06fec1efcae33d6c8919626f08c635dc5758af68f`; accepted AGAR contract `d6385e36a9a278582d39436b78eab5c5fbea676f5cb154d896a8684427dd6522`.

Root and owner hashes matched before and after review. Separate disposable snapshots preserve the initial predicate proof and composed runtime proof: `/tmp/imbc-astra-agar-graph-review-20261116` and `/tmp/imbc-astra-agar-tier3-review-20261116`. The latter's `integration-source-manifest.json` captures exact dependencies, local additive index exports and test source; `integration-review-result.json` captures source/log hashes. No shared application, SQL, Git or provider changes were made.

Static reading confirmed the canonical distinction: profile tier remains1/2, while tier3 belongs to identified product lines. Exactly report_issued, recommendations_in_progress and recommendation_issued qualify; percentage and nullable report do not gate qualification. Operator output contains only exact verified product IDs/nameEn/nameRu. Observers omit that key. AGAR/CDP reports remain Class C.

## Native graph concern resolved

The v1 native predicate trusted a matching seven-pointer catalog marker without the deeper relational graph. Root added the v2 SQL predicate mirroring the actual TypeScript validator. This reviewer applied actual shared migrations0–31 and the exact first v2 function on isolated restricted PG55435.

**130 tests passed.** Two real Submit→Review workflows produced14 immutable verified revisions and two closed assignments. All128 combinations of their seven current pointers were tested with FK/deferred constraints enabled and no trigger bypass:16 coherent combinations returned true,112 graph-incoherent combinations returned false, identically in SQL and the real TypeScript validator. The rejected cases cover a product site absent from exact Main, a product certificate absent from exact Certificates, and equipment referencing a product absent from exact Products. Unknown profile and missing current pointer also returned false. This is synthetic adversarial selection of legitimate immutable snapshots, not fabricated review decisions.

## Composed native, HTTP and files

**28 further tests passed; API typecheck exited0.** The owner expansion plus exact Root guards were applied as a disposable numbered migration through the real shared migrator over nonempty0–31 history, then replayed. The runtime used the real AgarCdpService and mandatory AgarCdpPublicationService, existing Review/DD catalog writer, owner controllers, Root file rule, FilesService, PostgreSQL queue and FileScanJob.

Checks proved:

- only the current verified product qualifies; retained old product records remain internal;
- all eight SME-selectable statuses use only workflow status for tier3, including100% with no file;
- four legal-FK cross-revision corruptions with a forged matching catalog marker produce zero expected, stored and public tier3 membership;
- omitted required membership and forged extra membership fail23514; runtime UPDATE/TRUNCATE are denied, and current policy tables remain read-only;
- new canonical Review/DD publication still works after installing the guards;
- six-role list/read/history/options, file GET/default/explicit/HEAD and unbound-file boundaries; manufacturer receives strict own-status Class A fields only;
- operator public product names and observer omission reveal no report, comment, author or execution percentage;
- real202 uploads and scan transitions yield metadata-only clean candidates; a saved v1 ignores a newer globally PASSED but uncaptured v2, which returns404 under the existing allowed-version contract;
- replaced/cleared report v1 remains available only to expert/director through immutable history, with retained FK protection;
- later scan rejection revokes bytes without rewriting history;
- fresh blocked account, changed role, moved organization and current policy denial defeat cached-session access, with file-denial audit; director writes fail403 and stale CAS fails409.

The first fixture attempts exposed no product defect: a second manufacturer account and second IMBC organization violated existing uniqueness; the helper was corrected to reuse the actual account and use an existing wrong-type organization for the adversarial move. Queue-schema privileges were initially omitted from the test role; restored per the established fixture. An uncaptured explicit version correctly returned404 rather than the draft assertion403. Fixture enum `virus` was corrected to canonical `malware`; unknown JSON typing was fixed only in test assertions. Initial logs remain retained.

## Remaining acceptance boundaries

Session resolution and the outer test guard policy are explicit local fixtures; business authorization reads actual current PostgreSQL policy/accounts. Object storage is in memory and antivirus is a stub that consumes the real uploaded bytes. The production AGAR AppModule mount, final migration numbering/grant registration, full owner acceptance rerun, actual AGAR UI/browser, real OIDC/S3/ClamAV/corpus and providers remain unproved here. No email is sent. All local HTTP servers, DB pools and temporary roles were closed after the suites.

Primary evidence: `/tmp/imbc-astra-agar-graph-second.log`, `/tmp/imbc-astra-agar-graph-proof.json`, `/tmp/imbc-astra-agar-files-final-corrected.log`, `/tmp/imbc-astra-agar-tier3-proof.json`, `/tmp/imbc-astra-agar-tier3-types-final.log`.

## Follow-up AGAR-U1 / P2: Unicode comment parity — closed after correction

Owner discovered an input-boundary mismatch while testing the next slice. This reviewer independently reproduced it on the preserved owner50 + Root9 source, using the actual AGAR HTTP controller, service, restricted PostgreSQL role and full native seals. The accepted DTO (`agar-cdp.ts` d6385e36…) counts Unicode code points through installed Zod, whereas `agar.expand.sql` c4598f82… uses `agar_cdp_utf16_length` in both the record constraint and operation seal. A valid comment containing 5,001 or 10,000 emoji passes the real input contract but returns HTTP500; both failed transactions preserve the previous row. Controls: 5,000 emoji and 10,000 BMP characters save200 with exact history, while 10,001 emoji is correctly refused400.

Action: align both native checks to the accepted 10,000-code-point contract, then rerun positive HTTP create/update and raw native boundary controls. No accepted DTO narrowing is required. Evidence: `/tmp/imbc-astra-agar-unicode-review-20261116`; `/tmp/imbc-astra-agar-unicode-original.log` (3 controls passed, 2 expected product failures, 28 unrelated cases filtered); five `/tmp/imbc-astra-agar-unicode-*.json` outcomes. The prior158 graph/files cases remain evidence for their exact tested scope; they do not establish this input boundary or full native/composed AGAR acceptance. No shared implementation was modified.

The subsequent analyst source073fe16c (16 November2026) removes malware scanning and its gates. Earlier scan-related evidence above remains a test of the earlier source; it is not relabelled as conformity to the revised file contract. A separate migration and evidence assessment is required.

Corrected frozen owner manifest `f43c9e8f138bdc4bcc467be5ec6b48ba8cf2c1fcb355be74576cf20c3ac5266b` changes the native parent/seal limit to PostgreSQL length, with matching schema CHECK; SQL SHA256 `7a79b10fd551bbcaaa6588bb3d15bac8751e70fab3b43fc993ce1ae6583a526c`, schema `b332928c1ce5bf4c124bf38d3a7d5817c20523ef6b5ef92317957cd58c9c6614`. Accepted d638 contract is unchanged. **Independent10/10 targeted cases and API typecheck passed.** The original five HTTP probes now pass; additional real POST5001/10000 and rejected10001 cases preserve original idempotent receipts, and exact raw sealed updates accept10000/refuse10001 with no failed-operation/audit residue. No permissive fake publication boundary was substituted: the copied Root native guards and actual publication service remained present. Snapshot `/tmp/imbc-astra-agar-unicode-fixed-20261116`; logs `/tmp/imbc-astra-agar-unicode-fixed.log` and `-fixed-types.log`; source/result `unicode-fixed-review-result.json`. Owner source hashes matched before and after. The28 unrelated cases were intentionally filtered, not reported as passed by this run. AGAR-U1 is closed; global073fe file-contract migration and actual AppModule registration remain separate open work.
