# Stage 5: canonical internal IMBC records — local acceptance

The internal records slice is accepted locally by GPT-6 Astra. SMEs can create/edit notes, maintain the complete engagement aggregate and historical EOI dates, and maintain programme/priority context for stable product identities. Directors can read the same records and full history. Manufacturer, operator, observer and administrator cannot access Class C records. This acceptance covers IMBC-15 and related scope/history integrity; it does not close all Stage 5 or production.

The exact application set contains 49 files: backend23 plus UI26, including the actual AppModule, grants, router, shell and queue/company navigation. SQL0031 follows the released Survey29/notice30 migrations. App-only export tree is `44fc6bcb970849d7327b7f279a72a4cbe3ca7bbd`; its 945 sources remained unchanged during final gates. [Machine proof](2026-11-16-imbc-records-composition-proof.json) contains the explicit path/hash aggregate algorithm, every application hash, test closure, independent reports and browser boundaries. The application projection tree is reconstructable from base `730e228` and the 49 exact application paths; final documentation is separate from that tested application projection.

## Result and business boundaries

Canonical `imbc_note`, `imbc_engagement`, normalized source/date children and `imbc_product_context` preserve original author, creation date and source. UTC6 CAS, immutable idempotent receipts, full correlated before/after audit and native deferred guards prevent partial aggregate writes, cross-profile data, fabricated actor/scope and lost-response duplicates. Ordinary editing does not send EOI campaigns or create Survey/LPS work.

Current product options use the real scoped working profile. A removed product retains its canonical identity, names, context and history; its immutable verified revision is not edited. Existing retired references remain readable while new selections are refused. Unknown values stay null. Programme LC/LPS is manufacturer context, not an LPS entry. Acquisition-source options remain empty until approved reference aliases are provided. The supplied priority1–6 release is distinct from historical ranking notes.

## Verification

- Full API: **2128 PASS /108 separate environment skips** on the exact preceding code export under Node26/PostgreSQL55433. The final API dependency closure differs only by one removed trailing space in a dictionary regex line; all **108 compiled contract files are byte-identical**. The two later history changes are web files. The proof preserves this bridge rather than claiming a second full API run.
- Final exact export: **696 web, 380 contracts, 24 checker tests**, typecheck, lint, API/web builds and actual Drizzle `No schema changes`. Its historical13November requirement map has all288 IDs and passes; it does not stand in for the new whole-project source gate.
- Independent Astra:45 backend/native/HTTP/nonempty-migration cases; complete AppModule13 cases/106 HTTP requests;709 authority/UI checks and83 affected history checks on their documented pins. [Backend review](2026-11-16-astra-imbc-records-review.md), [UI/final composition review](2026-11-16-astra-imbc-records-ui-review.md). These overlapping checks are not summed as one distinct total.
- Actual browser/native stand:37 HTTP controls and17 grid/navigation cases, EN/RU/KK at1280/390. Actual CAS409 recovery, scope403 plus auth503 barrier/recovery, committed-response loss with exact receipt retry, product COW removal/retained context, first history page and UUID cursor25+5 rows, full before/after and queue filter return were checked. Its249 raw requests include the initial history400 subsequently fixed, expected fault cases and six unrelated home404 responses outside the narrow stand; they are not described as zero network errors.

The dirty draft now survives transient background session failure while Class C content is hidden and mutations remain blocked. Fresh Me alone does not restore access; the same actor, current private scope and exact record must be revalidated. Initial history requests omit an absent cursor rather than sending `beforeId=undefined`.

## Remaining acceptance

The browser used fixture session resolution with real Nest guards/controllers/services and restricted PostgreSQL, not live OIDC. CUA tab switches did not reproduce a natural browser visibility/focus event; the real library-event authority tests cover that trigger separately. No file/storage/scanner route was exercised here. Own servers/tab/role/connections were cleaned up.

The current source is [073fe16,16November](../analyst/2026-11-16/SOURCE.json). Its internal-record requirements are unchanged. The new file/LPS behavior remains an explicit [separate source delta](2026-11-16-spec-source-update.md);129 old DATA-07 references still prevent the current whole-project reference gate from passing. AGAR/CDP integration and UI, canonical full Stage6 catalogue/cabinets/exports, operator-note composition/UI, live sources, migration, Release2, Azure release and production/UAT remain open. This checkpoint does not update Azure by itself.
