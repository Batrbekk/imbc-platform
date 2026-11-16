# Source-data audit, 16 November 2026

The four source workbooks are available and have now been captured in [the authoritative snapshot](../analyst/2026-11-13/initial-data/README.md). Source repository and revision: `AZhunis/imbc-prototype@8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6`, the same revision as the v1.4 specification and DBML. Downloads passed decoded-byte-length and Git blob hash checks; SHA-256 and exact source URLs are recorded in [sources.json](../analyst/2026-11-13/initial-data/sources.json).

This read-only audit used bundled Python/openpyxl 3.1.5 to inspect source values, cell types, number formats and structural metadata. It did not execute Excel formulas, recalculate or alter the workbooks, import business records, send invitations, or approve mappings. The machine-readable [structure audit](../analyst/2026-11-13/initial-data/structure-audit.json) contains aggregate counts and source coordinates without private cell values.

## Actual datasets

| Workbook | Inspected source extent | Populated data rows | Result |
| --- | --- | ---: | --- |
| IMBC manufacturers | `1. IMBC Manufacturers' Data!A1:AL983` | 982 | All 982 rows have a BIN value; structural normalization gives 816 distinct values, matching v1.4 §10. |
| LC/LPS | `Sheet1!A1:S58` | 57 | 57 distinct supplied company labels; identity reconciliation remains an SME decision. |
| Detailed demand under NDA | `consolidated!A1:J77175` | 77,171 | Header quantity horizon is 2031. Physical source rows 77,165–77,167 are wholly blank. |
| Additional random sample | `Лист1!A1:H101` | 100 | Another demand/classification sample with a 2031 quantity header. It is not an e-Ondiris registry feed. |

The 2,000 manufacturers in NFR-07 are an acceptance-load target, not the number of records in the supplied manufacturer workbook. A load fixture and the real migration dataset must remain distinct.

## Manufacturer migration implications

The 38 columns match the DBML source inventory. BIN column D contains 970 text cells, including 323 values with a leading zero, and 12 numeric cells. Numeric inputs need explicit format review; migration must not guess or silently add leading zeros. TN VED column M has 707 blanks, 91 text cells and 184 numeric cells. KPVED column N has 350 blanks, 628 text cells and four numeric cells. Text classifications include punctuation/source labels; a non-digit cell is not by itself proof of an invalid or multi-product association.

There are 10 `OUT OF` and one `N/A` source markers in classification columns E/F. MIG-04 requires their rows to remain accounted for and flagged. Column AG has 27 numeric values with General format: two zeros and 25 ones. Their execution scale remains ambiguous under the DBML; 1 must not silently become either 1% or 100%.

The workbook retains 88 Excel comments and 307 hyperlink relationships. The 282 folder targets in AI are especially relevant: the display label is not the URL or a platform attachment. Formula counts are 982 in A (source row numbering) and one in I. These facts justify keeping the original cell metadata in the restricted migration journal rather than reducing the file to a plain value CSV.

Grouping 982 rows into 816 BIN values is not blanket permission to merge conflicting company facts, infer production-address purpose, pair product/code lists by order, or create product-specific AGAR/CDP records from company flags. MIG-02/05/07/09 require the corresponding reconciliation issues.

## LC/LPS reconciliation

The source exactly matches the current DBML/specification control counts:

- Historical Type: LC 41, LPS 16.
- Status: Planning 16, In process 21, Localized 14, On hold six.
- Planned launch: 39 quarters, five years, one quarter range (`I32`), 11 TBD, one blank (`I58`).
- Business update dates: all 57 are typed dates, from 17 September to 6 November 2026.
- Investment K: 34 numeric values, 23 blanks, one value with fractional precision. Jobs L: 19 numeric integers and 38 blanks. No negative value was found in these two columns.
- Thirteen rows have neither city nor region.

The source has different contact-list lengths. Row 4 contains five names, five roles, four emails and five phone tokens; row 12 contains two names, two roles, five emails and three phone tokens. O/P/Q use semicolons and R uses slashes. Token counts describe the source only and never establish the person-to-email/phone association. Region/city and commodity/group lists also require the approved associations described in the DBML, including row 29's ambiguous type/group ordering.

Company labels, compound scope text and historical Type are not verified legal identities, separate workflows or automatic manufacturer profiles. MIG-16 calls for a one-time, repeatable migration using stable dataset/sheet/row/resolved-scope keys, followed by normal SME CRUD. All 57 source rows must retain traceability through any approved split or merge; missing optional values stay unknown.

## Detailed forecast import

The `consolidated` and `dict_commodity` sheets each contain 77,171 populated data rows. A/B/C in the main sheet are wholly blank, confirming the DBML's instruction not to manufacture source IDs or KPVED values. D has 77,110 text TN VED values and 61 blanks. Source-only E (FPAL) is populated on 77,163 rows and remains excluded from platform forecast data and publication, including issue payloads.

Before publication, an import must account for at least these source diagnostics:

| Diagnostic | Row/cell count |
| --- | ---: |
| Blank TN VED D | 61 |
| Blank subcommodity G | 13 |
| Blank description H | 1,285 |
| Blank unit I | 68 |
| Excel error cells in unit I | 32 |
| Blank quantity J | 8 |
| Negative numeric quantity J | 321 |
| Union of rows with those required-value errors/blanks or a negative quantity | 1,756 |

Counts overlap and must not be summed to derive rejected rows. The remaining 75,415 rows are only candidates after these structural checks; code/unit aliases, operator/project/brand redaction, duplicate meaning and publication validation still apply. No source quantity has been changed, negative quantity coerced to zero, or Excel error converted into a valid unit.

The raw hierarchy contains 195 distinct commodity labels and 16,059 distinct subcommodity labels before approval/normalization. The unit count in the structural JSON includes an Excel error token and requires error-aware normalization. Repeated names in `dict_commodity` must be deduplicated as dictionary labels, not imported as 77,171 separate commodities. Forecast hierarchy is separate from manufacturer A–E/type; the analyst repository supplies no approved crosswalk merely by having these sheets. Approved STR/product crosswalks are still business inputs.

The 100-row additional workbook has eight headers: Commodity group, KPVED code/name, TN VED code, Commodity name, full description, unit and total estimated through 2031. Its group labels are useful source evidence for reconciliation but do not supersede the signed-off detailed forecast import contract or establish e-Ondiris source semantics.

## PDFs and remaining inputs

The exact source tree inventories 73 initial-data PDFs, totalling 37,121,050 bytes: 45 KPO goods specifications, 24 TCO goods specifications, three commodity-demand PDFs and the Phase 1 Scope of Work. Their paths, Git blob hashes, sizes and revision URLs are in the snapshot manifest. This proves availability, not content acceptance or an STR/product mapping. The initial workbook audit did not fetch or inspect those PDF bytes. The subsequent [Abay documentation audit](2026-11-16-abay-documentation-audit.md) captured/read the SoW; the 69 goods and three commodity-demand PDFs remain unreviewed.

The workbook files therefore must no longer be classified as missing external inputs. The remaining external/business dependencies include IMBC-approved company/value/association resolutions; read access to the approximately 320 signed site-survey PDFs on SharePoint and BIN/file matching; a real daily e-Ondiris ingestion contract or approved delivery mechanism; approved forecast/STR product mappings; and publication-safe approved content. Initial imports can be prepared and rehearsed locally from the captured evidence while those decisions are pending.
