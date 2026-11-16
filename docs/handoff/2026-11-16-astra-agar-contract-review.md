# Independent Astra review — AGAR/CDP contracts

Status: **corrected frozen contract draft approved within the DTO/predicate scope; no AGAR/CDP implementation or runtime approval**. IMBC15 runtime review is separate and resumes when its backend pin is ready. Existing accepted Survey/review reports remain unchanged.

## Exact scope

Reviewed Root’s `/tmp/imbc-stage5-agar-contracts-20261116-01/packages/contracts/src/agar-cdp.ts` and its focused test against the complete IMBC-21–26 requirements, DBML473–488/1421–1435, DBML source reconciliation and catalog product projection, and 13 November replies17–18. The independent immutable snapshot is `/tmp/imbc-astra-agar-contract-review-20261116/manifest.json`; primary sources and the existing canonical product contract are preserved in `review-dependencies.json`.

Initial `agar-cdp.ts` SHA-256: `30cf5f17fa92b78a26eed0b0468ad7deb59533e9fb5fffdd8e3d47b6c6c92c70`. Subsequent Root formatting or fixes are not implicitly included.

The owner’s 37 focused tests passed independently. Fifteen additional contract probes yielded three passes and twelve expected failures exposing the gaps below: `/tmp/imbc-astra-agar-contract-review-20261116/initial-contract-probes.log`. The passing controls include an unchanged valid history, unavailable migrated report metadata with no invented version, and exhaustive acceptance of all 10,001 exact hundredths from 0.00 through 100.00. The test harness uses copied source and linked existing dependencies; its tsconfig extends a local copied base. No SQL, application source, provider or Git changes were made.

## Required contract changes

### P2 A1 — An undocumented 100-product cap truncates the public representation

The initial `catalogTier3ProductsSchema` applies `.max(100)` to the whole company’s qualifying stable product identities. IMBC-21/22 and the DBML have no such company limit. The existing canonical `productsWriteSchema`/`productsReadSchema` also permit more than 100 product lines. A valid company with 101 qualifying records therefore cannot pass the proposed operator projection DTO.

Independent probe: 101 distinct valid UUIDs fail parsing. Remove the arbitrary bound, or design explicit complete pagination if that is intended; silently clipping the operator list would not satisfy “which product lines are tier 3.” A page-size limit for the separate paginated own-status/SME lists is appropriate and is not this finding.

### P2 A2 — History accepts unrelated or rewritten record identities/provenance

The proposed history item validates each view independently but has no relation checks. It accepts an update whose `after` belongs to a different record, profile, organization or product. It also accepts rewritten kind, source, original actor and creation time, an update with `before: null`, and a creation with a populated `before`. These are directly contrary to the current contract’s immutable association/provenance interpretation. The accepted Survey history contract already enforces scope and action correlation.

Independent negative cases all currently pass the schema. Add a named history-entry schema with exact before/after association and immutable-fact checks, plus action/previous-value correlation. Current request provenance must not become an arbitrary historical toggle; any future Stage9 transition that attaches an actual manufacturer request needs a separately defined trusted event rather than a blanket client-supplied flag. This is a DTO integrity finding, not a claim that an unimplemented backend already permits cross-profile writes or leaks.

## Canonical interpretation

- IMBC-23 and the DBML explicitly say that new work is AGAR and a finished CDP stays CDP. Therefore a normal new expert-work input without a selectable kind is faithful. Read/update support must still retain existing CDP records and their complete status, execution, evidence and history; declaring only AGAR implemented would narrow Release1 incorrectly.
- The nine stored statuses and exactly three tier3 statuses match IMBC-21/24 and DBML. Paused/discontinued, a visit, execution100 or an uploaded report cannot independently establish an issued milestone. No compulsory transition graph is specified.
- Report absence is legal for a qualifying status. Present attachments still need exact saved file/version pins and file safety. The copied contracts permit null reports and reject mismatched metadata pins. Unavailable migrated metadata can retain its raw object identity without inventing a captured version.
- Decimal strings preserve optional 0..100 values to at most two fractional digits without numeric coercion or guessed historical scale. Migration of the workbook’s ambiguous0/1 scale remains a separate approved reconciliation task.
- Manufacturer own status is a strict allowlist excluding Class C report/comment/execution/source/history. The operator tier3 projection contains stable product identities only. Observer omission and actual scope/policy checks require the eventual composed DTO/service; a standalone array cannot prove those runtime boundaries.
- A status-only predicate is useful but is not full publication eligibility. The eventual writer must require established record/product meaning and the current coherent verified product graph, exclude unresolved migration, and preserve current visibility/DD rules. Report absence must not become an extra tier gate.
- Manufacturer online AGAR requests belong to Release2/Stage9 with the actual approved current-product/STR association. Normal new SME input must not fabricate `requestedByManufacturer` or a requested status. Trusted historical request provenance may be established during approved reconciliation. This does not authorize a fake current request endpoint or a blanket assumption that every historical record was unrequested.
- One-record-per-stable-product uniqueness and preservation of finished CDP leave repeat new work for that same product as an explicit future model decision. The contract must not silently rewrite CDP into AGAR or add duplicate current records.

This review does not approve SQL/native seals, stored request provenance, captured file history, actual authorization, projection rebuilds, UI, migration of the source corpus or whole AGAR/Stage5/production. Those require separate concrete implementation and runtime evidence.


## Corrected frozen draft recheck

**A1 and A2 are closed for the corrected contract scope.** Root’s final three-file manifest was verified before copying and again after the independent run, with zero drift in either the upstream frozen files or copied files:

| Artifact | SHA-256 |
| --- | --- |
| `packages/contracts/src/agar-cdp.ts` | `d6385e36a9a278582d39436b78eab5c5fbea676f5cb154d896a8684427dd6522` |
| `packages/contracts/src/index.ts` | `dd49b73453696cfb293c85bec699a93a40b9bb9950e780ed4b2253e672d8f20a` |
| `packages/contracts/test/agar-cdp.test.ts` | `66e3f3159194ac00adccdc4388ac63bbe975443db77c444647d7ad4324ee19a6` |

The corrected operator projection is an uncapped array of strict `{productLineIdentityId,nameEn,nameRu}` items, with case-insensitive duplicate-identity rejection. An independent 101-product positive case now passes. Six separate private-field additions are refused. Names must be supplied by the eventual exact verified product projection; this contract alone does not prove their source.

History now correlates action with presence of a previous value, preserves record/profile/organization/product/kind/source/original-actor/creation identity between before and after, and binds every entry in a page to the same original record. The independent original negative cases now pass, with an additional mixed-page test. The initial requested-boolean immutability case was deliberately replaced with a positive trusted-future-request history shape: actual Stage9 request provenance must be established by the server event, not permanently forbidden by a generic historical boolean comparison. Expert input still cannot supply that flag.

Independent Node26 result: **62/62 tests pass (39 owner +23 independent), full copied-contract typecheck passes**. The exhaustive 10,001-hundredths test, unavailable migrated report control, all status/report/percentage and strict own-status controls remain included. Logs: `/tmp/imbc-astra-agar-contract-review-20261116/corrected-contract-probes.log` and `corrected-typecheck.log`. Machine result: `corrected-review-result.json`. All 36 copied source dependencies are pinned in `corrected/dependency-manifest.json`; the original failing snapshot/log remain preserved.

No further actionable finding remains in this corrected DTO/status-predicate draft. Approval is limited to these exact contracts, tests and export. It does not establish server request provenance, native seals, authorization, file bytes/pins in storage, projection source/visibility, UI, migration, whole AGAR, Stage5 or production acceptance.
