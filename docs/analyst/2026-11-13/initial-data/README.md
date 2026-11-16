# Authoritative initial-data snapshot

Captured on 16 November 2026 from private analyst repository `AZhunis/imbc-prototype` at commit `8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6`. These files are evidence and restricted migration inputs. They contain business and personal data and must not be bundled into the web application, public fixtures, exports, or logs.

Only this generated audit metadata, structural counts and the manifest are committed to the implementation repository. The restricted workbook/PDF originals remain local inputs and are not published with the project.

The four local `.xlsx` files are byte-for-byte originals. Each download used GitHub's Git Blob API JSON/base64 response. The decoded size and Git blob SHA-1 were checked; [sources.json](sources.json) also records SHA-256 and exact revision URLs. No source workbook was recalculated, edited, or re-exported. Excel formula text and comments were treated as source evidence, not executable instructions.

[structure-audit.json](structure-audit.json) contains counts and structural diagnostics only. It excludes company labels, BIN values, contacts, descriptions, hyperlinks, comments and raw formulas. It is an audit snapshot, not an approved mapping or an import outcome. Data/format provenance remains in the original ZIP/XML; production migration must retain the source cell type, number format, exact numeric lexical value, comment and hyperlink target in its restricted journal.

The manifest also inventories 73 available source PDFs: 45 KPO and 24 TCO goods specifications, three commodity-demand PDFs and the Phase 1 Scope of Work. Those PDF bytes have not been copied or read by this audit; their Git tree path, blob hash and size establish availability/provenance only. These goods specifications are separate from the roughly 320 signed site-survey reports that MIG-14 expects from IMBC SharePoint.

See [the audit report](../../../handoff/2026-11-16-source-data-audit.md) for counts, migration implications and remaining business inputs.
