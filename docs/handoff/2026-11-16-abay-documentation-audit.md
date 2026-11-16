# Abay documentation audit, 16 November 2026

The GitHub repository referenced by the human in the local Claude chat is **[AZhunis/imbc-prototype](https://github.com/AZhunis/imbc-prototype)**. Its current `main` still resolves to `8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6`, the same revision as the existing v1.4/DBML snapshot. The full Git tree response was not truncated. A [versioned additional snapshot](../analyst/2026-11-13/additional-documents/SNAPSHOT.md) now preserves the previously uncaptured project documentation and exact hashes.

## Evidence from the local Claude chat

Only human text was inspected in the two top-level project sessions. Assistant/tool outputs, `isMeta` messages, compacted summaries, environment values and subagent prompts were excluded. Of the `af493c61-e770-4ebe-a016-52c755fe890a.jsonl` records, 107 qualified as non-meta, non-summary user text; seven mentioned Abay/AZhunis. `00d6e6bf-4d4f-4a95-930f-1360b61deb43.jsonl` contained no qualifying human text.

The relevant original human references are:

| Local session evidence | Exact GitHub reference |
| --- | --- |
| `af493c61…`, line 502, UUID `c505af15-1ce8-419e-a5c8-69aa83e42b95`, 11 November 2026 at 15:15:01 UTC | `https://github.com/AZhunis/imbc-prototype/blob/main/docs/adata/api.md` and `https://github.com/AZhunis/imbc-prototype/blob/main/docs/technical-specification/specification.md` |
| `af493c61…`, line 1237, UUID `ca49c3f2-63cf-4466-ab8e-6b776a3c1512`, 11 November 2026 at 17:06:44 UTC | `https://github.com/Batrbekk/imbc-platform`, the implementation repository |

The local logs were neither copied into Git nor quoted beyond these reference coordinates. Counts that include CLI meta messages or compaction summaries must not be presented as counts of human requests.

## Which sources govern

The [current repository README](https://github.com/AZhunis/imbc-prototype/blob/8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6/README.md) explicitly separates the specification, DBML and clickable prototype. The prototype uses mock data and can lag behind the documents; its demo passwords, UI copy and data model are not production credentials, approved legal text or an additional requirement source.

The current specification defines behavior/access/scope. DBML defines fields, relationships, reference lists and import/export contracts. The [13 November answers](https://github.com/AZhunis/imbc-prototype/blob/8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6/docs/architecture/questions-for-ba/2026-11-13-replies.md) reconcile the implementation questions against those sources; they expressly do not treat proposals from the questionnaire or earlier draft answers as already approved.

The source English and Russian Markdown editions both carry version 1.4, draft for sign-off, dated 13 November. Their unique requirement-ID sets are identical: 288, with no extra or missing IDs. Both rendered specification PDFs also identify v1.4 and contain the same 288-ID set. This checks version/catalogue parity, not translation quality or full page layout.

The [11 November architecture update brief](https://github.com/AZhunis/imbc-prototype/blob/8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6/docs/architecture/update-briefs/v0.5-11-november-architecture-update-brief.md) is the applicable historical update of v0.4. The similarly named `v0.5-architecture-update-brief.md` is explicitly superseded. Even the applicable 11 November brief predates v1.4 and still describes eight sections/shareholders and legacy one-field-per-column storage; those points must follow the newer seven-section and normalized DBML contracts.

The 13-page original Scope of Work is dated 20 February 2026. Its architecture, acceptance, vendor independence, handover, hosting and redundancy clauses were read; page 7 was also visually checked. It is a baseline whose refinement is explicitly provided for, not a reason to restore CT-KZ, licensing, configurable export columns, SFTP or mandatory registration uploads that later requirements remove. Its image-only data appendices were not used as a migration dataset.

## Precise read coverage

The additional manifest covers 41 files: 19 Markdown files, 13 text transcripts/notes, six PDFs, one DOCX and the existing DBML/SQL pair. Seven canonical sources were already captured and were hash-checked rather than duplicated; 34 additional files total 7,149,397 bytes.

| Source group | Work performed in this audit |
| --- | --- |
| Repository README, Markdown TODO, architecture briefs, 12 November questions, 13 November reconciled answers, historical outcomes/open points/scope exclusions/changelog | Substantive text review, with historical/current status distinguished. |
| Existing specification, DBML, glossary and 12 November draft answers | Existing hashes checked; relevant rules and mappings consulted. Earlier draft answers do not override the 13 November reconciliation. |
| Russian Markdown specification | Version/source header and complete ID-set comparison; no claim of a full linguistic proofread. |
| Adata `api.md` | Technical heading/operation inventory and selected connector semantics checked; full real response examples were not reviewed or reproduced. |
| Adata `absent-checks.pdf` | All three text pages read; page 1 visually checked. This is evidence from 11 November, not a fresh paid-module test. |
| Original SoW PDF | All 13 extracted text pages read; page 7 visually checked; image appendices not audited as source rows. |
| `todo.pdf` | Full one-page text and image read; dated 10 November and stale against current Markdown TODO. |
| English/Russian specification PDFs | All 50/60 pages extracted; title/version and 288-ID catalogue checked; full visual review not performed. |
| Architecture v0.4 PDF | Exact same 63-page source as the infrastructure audit; selected architecture rules consulted here. The separate [Azure inventory audit](2026-11-16-azure-production-inventory.md) owns topology review. |
| e-Ondiris field-reference DOCX | Field catalogue/quality notes read as an older source; no rendering or layout QA performed, and source examples are omitted from this report. |
| Meeting transcripts and archived decision log | Topic search/index and provenance capture, not a full transcript read or a new normative interpretation. |
| 69 KPO/TCO goods-specification PDFs, three commodity-demand PDFs, old v1.0 DOCX and presentations | Full-tree availability/provenance inventory only; contents not read in this documentation audit. |

## Additional information found

**e-Ondiris field reference is available.** `docs/initial-data/E-Ondiris_Field_Reference.docx` is dated 5 November and documents 27 source fields. It supports names/types/source handling such as textual BIN/TN VED/ENSTRU, registration number, a `region_kato` value that is a place name rather than a KATO code, capacity containing source units, nullable/empty markers and active/excluded registry state. It does not provide access to a daily feed. Its earlier 21-visible-field scheme includes `localization_level`; current MAN-25/DBML explicitly exclude localization steps and supersede that display rule. No raw company/contact examples are reproduced here.

**The current working TODO has more information than the old PDF.** `docs/todo.md` has a 16 November block, marks manufacturer/commodity columns defined and the sample commodity workbook received, and still lists the architecture update, Adata response, server figures, lawyer's vendor NDA and field-hint wording as pending. It says the logo assets were shared, but the inspected repository tree contains no corresponding IMBC logo asset; a completed share task is not proof that the asset is in this Git tree.

**NCOC receipt and Git availability differ.** The TODO says NCOC catalogues are in. The exact tree contains 45 KPO and 24 TCO goods PDFs, with no NCOC file or folder. That is a delivery/provenance question for the received catalogue, not permission to manufacture its content or derive approved STR/KTRE mappings. Existing operator PDFs are source material; v1.4 describes IMBC-authored/redacted STR/KTRE in their own catalogue, without a link from a forecast line or operator ownership.

**Adata API documentation and module-gap evidence exist.** `api.md` supplies the reference (116 technical Markdown headings, which is not a count of performed checks). The three-page absence report separates fields with no API method from methods that returned `403 modules not connected` on 11 November. Full company information was available then; extra trustworthy/risk/fines/procurement/contracts/tax/affiliation/sanctions/individual modules were disabled. Their absence is neither `clear`, a confirmed finding, nor a fabricated `no answer`. Current paid coverage must still be checked with the provider before live acceptance. The report and TODO do not establish that all those modules are now enabled.

**Legal process is described, but approved text is not supplied by the prototype.** The 13 November answers require the first platform NDA text from IMBC; acceptance at registration/migrated first sign-in belongs to Release 1 and publication of later versions belongs to Release 2. They do not equate platform consent with the NDA on IMBC's public website. The working TODO's vendor NDA for the audit is a different legal subject. Prototype checkbox strings and absence of a dedicated legal file do not replace a lawyer-approved platform NDA/terms/policy.

**Initial data is present.** The manufacturer, detailed forecast and LPS workbooks are captured and independently counted in [the source-data audit](2026-11-16-source-data-audit.md). The 100-row additional file is a demand/classification sample, not a daily e-Ondiris dataset. The approximately 320 signed site-survey reports mentioned by MIG-14 still require the SharePoint/file delivery and matching evidence; catalogue PDFs are not those reports.

## Implementation implications before production

The latest source answers remove several apparent questions and define work that does not need new business approval:

- Keep seven sections, full readonly Adata legal fields/founders, no manual shareholders/percentages or localization steps, fixed three ISO options plus subsequent administrator requirements, no licensing, and six-section completeness excluding optional production and explicit ISO absence.
- Only Send changes creates review queue/pending revisions; Save is unsent work. Queue date is the current assignment's `received_at`, not registration. Current source/file/requirement snapshots must remain immutable and independent of later dictionaries or source versions.
- Preserve full before/after due-diligence record and checklist values in one append-only audit transaction. Unavailable modules do not add clear check results. A last returned tax year with zero total is critical even when incomplete; previous years are displayed. Provider name matching is not sufficient proof of sanctions identity.
- Preserve verified-only linked projections for operators; director search/company pages read all permitted profiles while the dashboard uses visible Verified profiles. Works-with counts use the fixed NCOC/TCO/KPO trio. LPS is a separate SME CRUD register, with no manufacturer/NDA/export/pull-API workflow.
- Reconcile the current implementation with canonical `account_nda_acceptance` and the composite profile link, release-seeded `policy_rule`, and approved `dictionary_alias` contracts. The currently inspected access/reference schema uses registration consent fields on `user_account` and does not yet contain those three canonical tables. These are implementation/model-alignment tasks, not missing source documents. A code-only policy matrix is not the model deviation accepted by answer 2; code can remain the single versioned source and seed the required table.
- Current user direction chooses the existing Azure dev VM without new paid resources, with future production servers to be provided. Build the portable GitLab/Kubernetes/Argo/OpenBao/observability/restore delivery there in the authorized scope; do not claim one dev VM proves the production availability or acceptance-load target. The source's production operator/support/UAT ownership remains part of handover.

Remaining business/external inputs are therefore specific: approved legal texts, unresolved company/value/association mappings and product-specific STR applicability, NCOC/IMBC-redacted file delivery, SharePoint survey files and matching, a daily e-Ondiris delivery/access mechanism, current paid Adata coverage/terms, final hosting/operator ownership and language/UAT approval. Their pending status does not stop independent implementation or trial imports from the sources already in hand.
