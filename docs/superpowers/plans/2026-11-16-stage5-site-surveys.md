# Stage 5: site surveys, requests, tiers and NOT-11

Status: implementation in progress. This document describes the full slice, not an acceptance claim. Requirements are IMBC-01/02/03/05/20, OPR-09/10/12/13, NOT-11/34, GEN-08/09/10/11/13, AUD-01/02 and MIG-08/14 in v1.4 and DBML revision `8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6`. Survey work does not complete all Stage 5: normalized engagements, notes and product-level AGAR/CDP remain separate work. Whole production delivery includes all stages and Release 2.

Implementation checkpoint: [records, uploads, exact company/file access and durable generations](../../handoff/2026-11-16-stage5-site-surveys.md). Owner26/31/28 PG/HTTP and independent Astra102 combined checks have concrete scopes; current-company policy additionally passed40 independent cases. Scheduler/NOT11 delivery is bounded accepted with owner32 actual SMTP/PG and independent Astra49+14 checks. Current full API2113PASS/108 separate-environment skips, contracts376, global types/build/lint passed. Final corrected UI630 and independent635web/376contracts/41company-and-AppModule-DI passed; original browser34HTTP/198responses and supplemental18GET return proof retain explicit auth/storage/antivirus boundaries. Both navigation P2 findings are closed and final composed review is Approved. Exact Git delivery checks passed; checkpoint `3eeab65120e9feb5cb02ce2c97ff383b422cb8e9` was published with remote match. WholeStage5 and production remain open.

## Business behavior

An active SME may record several historical or current visits against any existing manufacturer profile. New expert records require actual visit dates, yes/no result and a signed, scanned Class C survey report. Expiry and comment are optional. No automatic one-year/two-year term is added. Editing retains the original source, recorder and recording timestamp; the full previous and new records are audited. A recorder may end a record by changing its result or expiry, without deleting history.

The mark is true when **any** record has result yes, an exact PASSED signed report and either no expiry or an expiry after today's Asia/Almaty date. A newer no/expired/unsigned record cannot cancel an older valid record. The newest eligible visit supplies the displayed date; an unresolved historic date remains unknown. Tier 1 follows verification and tier 2 follows this mark, including when DD currently hides the profile from operators. Tier 3 belongs to an approved AGAR/CDP product and is not a company-wide survey tier.

A manufacturer may request a survey only for its own verified profile. The request has no product, creates no survey record and sends no email. The SME has a request list. Repeated transport of one request must have an explicit idempotency identity rather than produce accidental duplicates; a later intentional request must remain possible.

## Record access and the explicitly permitted company projection

SMEs edit/read, directors read; use persisted active IMBC accounts and canonical `imbc_records.edit/read`, not caller role claims. Other roles cannot read the full Class C record, comment, result, actor, source or history. The manufacturer sees its tier and its own request only.

Primary OPR-09/10 explicitly places the survey report and dates on the company page; OPR-12 excludes DD/AGAR/CDP reports and notes, but not the survey report. GEN-13/OPR-13 give observers the same visible verified company content with enumerated exceptions. This specific allow-listed projection is compatible with section 4's refusal of access to the whole survey record, just as IMBC-09 permits DD date/enhanced summary without disclosing its closed record. The DBML comment note agrees. Independent GPT-6 Astra reviewed this interpretation against the full primary context on 16 November; that interpretation is not implementation acceptance.

Operator/observer may therefore read dates and the selected current signed report only on an actually visible verified profile, with persisted `catalog.search` (the current canonical company-page action, scope `visible`) checked on each request. File access must re-resolve current eligibility and the exact PASSED pin: an old URL or stale catalog row cannot disclose a replaced/ineligible report. No history, Class C comment/result/author/source or general Class C download permission is granted. Selection is deterministic by newest eligible visit, then recording timestamp and UUID. Broad derived wording in the roadmap does not remove the explicit OPR-10 field exception.

## Schema and preservation

Expand migration 0029 introduces canonical singular `site_survey_record` and `site_survey_request`, composite profile/organization FKs, exact report file-version pins, microsecond `updated_at`, transaction-bound full audit seals, durable derived survey state and a notification outbox. Migration0028 is reserved for mandatory MAN43/NOT29 review retention. Legacy plural records/notices and every old file/FK stay intact. Unknown original dates/source meanings/file-version links require reconciliation; no current/latest file version, new date, author, expiry or delivered email is invented. Stage 8 owns approved legacy/workbook/PDF mappings. A raw retained file object ID is not signed-report evidence.

Database guards validate complete before/after rows before DML, prevent operation reuse across transactions and compare final state at commit. Original recorder/source/date/identity/scope are immutable on edit. Operation/history/request evidence is append-only, and runtime roles cannot delete/truncate it. All trigger functions have a fixed trusted search path. Report guards serialize against upload/cleanup and allow retaining an unchanged captured PASSED version after a later rejected upload.

## Delivery order

1. Typed input/read boundaries and effective-survey rules; exact date, tenant, purpose, Class C and version evidence.
2. Reviewed 0029 schema/audit guards and preservation checks on an isolated PostgreSQL database after Stage 5 review gates finish on migration 0028.
3. SME/director API, exact-version report capture/upload/access/history and own verified manufacturer request/list; BFF routes, strict DTOs and audited denied access.
4. Canonical tier and verified catalog projection. Track survey generations independently of visibility so temporarily hiding and showing the same already-notified survey does not send another notice.
5. Durable NOT-11 publication: first visible surveyed generation sends once; a survey first recorded while invisible sends once after later visibility; another valid record while still surveyed sends nothing; expiry sends nothing; becoming surveyed again, including reactivating the same record, creates a new generation. Observe expired previous state even if its scheduled job was delayed. Notification dispatch rechecks current generation, visibility and validity. Only operator accounts not blocked are recipients; manufacturer/IMBC/observer are not recipients.
6. Almaty expiry scheduling and replay/race-safe queue handling, EN/RU/KK templates and Mailpit-only automated tests.
7. SME/director record/history screens and manufacturer request action in EN/RU/KK; selected report/dates on the authorized operator/observer company page. Independent GPT-6 Astra backend/UI review, full affected tests/builds and actual browser scenario before committing this slice.

## Required evidence

- Actual PG/HTTP rights for all six roles, own/foreign tenant, blocked/inactive/policy-revoked actors and safe denied audit.
- Multiple visits, old/no-expiry and same-day expiry, unknown retained legacy values, exact clean-version capture and history after replacement, stale microsecond CAS and concurrent capture/edit/scan/cleanup.
- Complete audit before/after, no direct unaudited mutation, no reused operation, rollback on audit/projection/outbox failure, no foreign file/profile pin and no app-role delete/truncate.
- Survey requests: own verified only, empty product-free body, deliberate new request possible, retry idempotence, no survey created/no notification job.
- NOT-34 complete truth table including invisible-to-visible, DD hide/show without survey end, multiple concurrently valid records, first expiration and reactivation of the same record, stale queue generation and duplicate dispatch. Test all recipient roles/states and actual `.local` Mailpit messages.
- Browser desktop/mobile EN/RU/KK with real PostgreSQL API, exact report version and role-denied behavior. Actual storage/ClamAV/Office corpus, live email and intended Azure final-artifact acceptance remain explicit Stage 10 gates.
