# Stage 4a: e-Ondiris immutable copy and reconciliation

Status: isolated implementation and PostgreSQL tests; not wired to application/profile jobs and not a live daily connector.

## Governing evidence

- `docs/analyst/2026-11-13/specification-v1.4.md`: MAN-06, MAN-25, EXT-02.
- `docs/analyst/2026-11-13/imbc-platform.dbml`: full `e_ondiris_record` fields and `product_line`/identity/classification reference chains.
- `docs/analyst/2026-11-13/additional-documents/docs/initial-data/E-Ondiris_Field_Reference.docx`: named input keys, textual identifiers and capacity, source date/status. Its older OKED/localization guidance is superseded by the v1.4 specification/DBML.
- `docs/development-roadmap.md` Stage 4a–4b; `2026-11-16-production-delivery.md`.

The source has no approved published API. The `RecordedEOndirisConnector` is an explicitly offline adapter supplied with recorded responses; the default connector returns `access_not_configured`. No guessed URL/auth/pagination, paid call, source file timestamp, row-order timestamp or invented source status is used.

## Field inventory and normalization

The immutable record has 18 source facts plus UUID, content hash, first observation timestamp and mutable `is_current` pointer (22 columns). Only these named input fields are projected:

| Verified input key           | Canonical fact                                             |
| ---------------------------- | ---------------------------------------------------------- |
| `bin_iin`                    | `bin`                                                      |
| `registration_number`        | `registrationNumber`                                       |
| `company_name`               | `legalName`                                                |
| `region_kato`                | `placeName` (place name, not KATO code)                    |
| `production_address`         | `productionAddress`                                        |
| `website`, `phone`, `email`  | Same named contact facts                                   |
| `product_name`               | `productName`                                              |
| `production_capacity`        | `productionCapacity` (literal source units)                |
| `tnved_code_10`              | `tnVedCode`                                                |
| `kpved_code`, `kpved_name`   | KP VED textual code/source name                            |
| `enstru_code`, `enstru_name` | ENSTRU textual code/source name                            |
| `dvc_percent`                | `inCountryValueShare` (exact canonical two-decimal string) |
| `registry_inclusion_date`    | `includedOn` (valid ISO date)                              |
| `is_active`                  | `active` (boolean/null)                                    |

BIN (including checksum), registration and TN VED remain strings; numeric identifiers are quarantined without padding or coercion. Outer text whitespace is trimmed; source spelling and capacity units are preserved. Overprecision, negative/out-of-range percentage, impossible dates and string status booleans are quarantined. Optional missing facts stay null, not fabricated.

Barcode, AGSK-3, NTIN, comment, transport data source, localization level and old e-Ondiris OKED fields are not persisted or hashed. Changing an excluded field does not create a new snapshot. Full OKED stays Adata-owned. Canonical hash uses fixed field ordering; scope hash sorts every observed registration for a BIN. Raw 27-field bodies are not persisted. Synthetic local fixture retains excluded keys solely to verify projection and is disabled by default for storage.

## Transactions, delivery ordering and audit

1. Assemble all observed feed pages first, then group all registrations by BIN using the actual named BIN field. `validateEOndirisFeed` validates the entire assembled feed before returning any accepted scope. It never maps positions between arrays.
2. Every capture explicitly asserts `all_observed_bin_rows`, carries approved connector observation time and synthetic/recorded/provider provenance. Observation time is stable across retries. Observed coverage is not proof of upstream deletion.
3. The store defensively copies/revalidates the normalized capture, opens a transaction, acquires a BIN advisory lock (also protects the first missing watermark) and locks the existing scope row.
4. The operational `e_ondiris_sync_scope` table stores accepted observation time and hash of the whole accepted BIN scope. Older observations are stale; equal observation/equal hash is replay; equal observation/different hash is conflict. Scope provenance cannot silently mix synthetic and real data.
5. Versions are inserted in batches of 1,000 with unique `(bin, registration_number, content_hash)`. Existing version IDs are reused. Current pointers change only for changed observed registrations. An A→B→A sequence at newer approved observation times reactivates A's original ID and first timestamp.
6. An absent row, empty response, unavailable connector or malformed response never deletes/deactivates source records or produces a due-diligence finding. Quarantine returns only row/field/error code, without business values. Failed validation cannot advance a watermark.
7. The same transaction writes an actor/system audit with before/after scope metadata and immutable version references. An optional transaction callback lets the integration add a durable outbox. Any callback/storage failure rolls back versions, pointers, watermark and audit. Raw PostgreSQL errors may contain business rows, so the exposed storage error contains only a safe SQLSTATE.

Database triggers block updates to source facts/first observation timestamp and block delete/truncate even for the table owner. Only the pointer is mutable. Production grants must restrict the application to SELECT/INSERT and pointer-only UPDATE for records, required scope updates and append-only audit. No live migration was run.

## Product and prefill planning

`planEOndirisProducts` is pure and performs no profile writes. Existing registry registration retains stable identity across renames/code changes. A manual product becomes a source product only on a unique normalized EN/RU name alias plus exact TN VED match. Code alone never identifies a product. Multiple source registrations remain distinct. Ambiguous manual/source matches return issues without a partially applied candidate.

Replacement preserves stable product identity, production-site identity, shared certificate identities, manufacturer note and list position. New identities must be allocated inside the profile COW transaction. Missing/inactive source products remain visible; missing source fields remain readonly source facts. Source KP VED/ENSTRU name/code pairs must be materialized by their actual named pair, not parallel-array positions; unresolved reference codes retain labels without invented dictionary IDs.

Contact/site defaults can replace only empty/source-owned values. An explicit manufacturer correction or clear remains manufacturer-owned. The prefill helper does not validate contact formatting or resolve site addresses; integration must use existing write validators and match a local site only when the address match is unambiguous. MAN-06/09/10 and the 13 November answers supersede the old legal-name precedence: legal information, including the exact legal name and the full OKED list, is exclusively Adata-owned. The e-Ondiris company name is retained only as registry evidence and cannot replace a profile legal name, including when Adata returns no value. Manual DVC remains zero in existing manual handlers.

## Required parent integration (still open)

1. Register/export the new schema and create the next expand migration after the NDA owner's `0022`; use `storage-expand.sql` as the reviewed fragment. Add the operational table to the DBML/documented architecture as delivery metadata, not source facts. Update application grants.
2. Remove `product_line_source_snapshot_reserved_ck`; add `product_line.e_ondiris_record_id` FK to immutable records. Enforce that the linked snapshot BIN matches the owning organization, and bind registry snapshot IDs/registration/source together. Preserve existing frozen/COW guards and seven exact copy maps.
3. Wire the store to PG_POOL and a daily worker/outbox with retry/backoff and safe status reporting. Accept only owner-approved input access/observation/coverage metadata. Do not label a configured scheduler with an unconfigured source as successful daily synchronization. Feed cursor advances only after all grouped BIN transactions finish; retries reuse stable observations.
4. On profile creation/changed BIN, read the local copy and materialize candidates under existing profile/revision locks. Never mutate submitted/verified revisions, publish a catalogue row, unlock a section, send mail or perform live network/quota calls while opening a profile section.
5. Add source ownership/provenance to pending main-information prefill as required; keep verified source values frozen. Add full before/after source-derived field audits at materialization, including source snapshot IDs. The storage-level audit does not replace profile source-field audit.
6. Test integrated profile COW, pending versus verified readers, readonly source facts/local editable associations, reference labels, metadata and production delivery. Then obtain Astra review. Actual approved live source protocol/coverage/daily transport remains external information required before calling Stage 4a complete.

## Verification

Direct new-file parser/planner/capture tests plus PostgreSQL 18.6 store tests use only synthetic.local scaffolding. PostgreSQL tests use a separate local container at `127.0.0.1:55435/imbc_eondiris_test` via `EONDIRIS_TEST_DATABASE_URL`, never the root/NDA/browser test databases. Cases include full-BIN grouping, numeric identifier quarantine, immutable guards, idempotency, stale/conflicting observations, A→B→A, concurrent scopes, rollback, absence handling, frozen snapshot lookup and 1,001-row batched ingestion. Shared indexes, migrations, module registration, profile handlers and live VM are untouched by this bounded implementation.
