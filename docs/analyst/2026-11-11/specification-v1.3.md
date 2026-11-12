# IMBC Platform — Phase 1 Technical Specification

|          |                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version  | 1.3 (draft for sign-off)                                                                                                                                                                                                                          |
| Date     | 11 November 2026                                                                                                                                                                                                                                  |
| Customer | IMBC — Association of Legal Entities “International Center for Development of Oil and Gas Machine Building”                                                                                                                                       |
| Vendor   | Smart Call                                                                                                                                                                                                                                        |
| Based on | Scope of Work, IMBC Platform Phase 1, 20 February 2026; specification v1.0, 27 October 2026; IMBC presentation “IMBC Platform · Phase 1”; working meetings with IMBC, including 2, 4, 5, and 11 November 2026; IMBC Platform architecture v0.3, 30 October 2026 |
| Replaces | Specification v1.0                                                                                                                                                                                                                                |

## Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 27 October 2026 | First version, in Russian |
| 1.1 | 2 November 2026 | Rewritten in English around what each role does; all open questions of v1.0 closed; aligned with architecture v0.3; out-of-scope section and SoW deviation table added. Production capacity, workshops, utilisation, links from equipment to product lines, and the profile completeness percentage are in Phase 1. |
| 1.2 | 3 November 2026 | Aligned with the 2 November 2026 meeting. Observers, the operator dashboard, a read-only operator API, the Adata connector, and e-Ondiris prefill are in Phase 1. The detailed forecast is view, search, and filter only. The production section is optional. Section 8.2 spells out the emails for review, update status, requests, site survey, and subscriptions. |
| 1.3 | 9 November 2026 | Aligned with the 4 and 5 November 2026 meetings. Key technical requirements open beside a forecast line and cannot be downloaded. Choosing a dashboard figure opens the manufacturer list with that filter. Each internal column of the manufacturers workbook is its own legacy field. Due diligence lists each Adata check and passes on a rate. The Adata connector reads its token from the environment. |
| 1.3 | 10 November 2026 | The SME's due-diligence screen names a finding as critical and a shown-only yes as attention (IMBC-14). |
| 1.3 | 10 November 2026 | The due-diligence result is green, amber, or red. A critical check is red and holds the profile. A check that only needs attention is amber and does not. The 98 percent pass rate is dropped (IMBC-11, D-71). |
| 1.3 | 10 November 2026 | e-Ondiris field reference applied (MAN-25, D-70). ENSTRU is shown with its name. AGSK-3, NTIN, the barcode, the comment, and the data source are not shown. |
| 1.3 | 11 November 2026 | Requirement numbers run with no gaps. The spelling is e-Ondiris. Observers see the dashboard, the manufacturer list, the detailed profile, and the e-Ondiris contacts, and they do not see the focal point or the demand forecast (GEN-13). Section 3.1 says what the SME, the IMBC administrator, and the IMBC general director do. Where the company legal name or the kind of activity is returned by both e-Ondiris and Adata, e-Ondiris is kept (MAN-06). A duplicate contact is rejected (MAN-13). |
| 1.3 | 11 November 2026 | Aligned with the two meetings of 11 November 2026. An inactive profile stays visible and sorts below the others (UPD-04). A missed confirmation waits seven days, the quarter is the profile's own date, and at most 50 update-status emails go out in a day (NOT-31). An expired certificate can make a profile outdated (REV-10). e-Ondiris is a daily local copy, and a pulled product is not added again (EXT-02, MAN-25). Due diligence runs when the profile is created and repeats once a quarter (IMBC-07). The NDA is accepted at registration (FC-02). Summarized technical requirements and key technical requirements excerpts are a section of their own, not a file on each forecast line (FC-08). Phase 1 does not write requirements for an AI assistant, and it has no rank of a manufacturer (IMBC-06). |
| 1.3 | 11 November 2026 | Where the 11 November meetings differ from an earlier decision, the later remark stands. The second missed quarter is unresponsive, and the profile stays visible (UPD-04). Company phone and email come from e-Ondiris, then Adata (MAN-06). Headcount is entered by the manufacturer (MAN-17). A verified profile is tier 1, a site survey is tier 2, and an AGAR or a CDP on one product is tier 3 (IMBC-19 to IMBC-26). Sending the recommendation to operators is not in Phase 1. |
| 1.3 | 11 November 2026 | IMBC staff roles are SME, IMBC administrator, and IMBC general director (section 3.1). The manufacturer cannot change the BIN (MAN-09). CT-KZ and the industrial certificate for internal circulation are not certificate types (MAN-34). |

## Contents

1. About this document
2. Purpose and scope
3. Parties, roles, and terms
4. Access rules
5. Manufacturer
6. IMBC staff
7. Operator
8. Common functions
9. Data
10. Migration
11. Technical and non-functional requirements
12. Acceptance
13. Delivery and deliverables
14. Out of scope
15. Deviations from the Scope of Work
16. Sign-off

---

## 1. About this document

This specification describes what the IMBC Platform does in Phase 1. It is the basis for design, development, and acceptance.

**Precedence.** Once signed, this specification replaces sections 3 and 6 of the Scope of Work where the two differ. Each difference is listed in section 15. Signing this specification approves those differences under the change-control clause of SoW §9. Anything not described here is not part of Phase 1 and goes to the Phase 2 specification.

**Technical design.** How the platform is built follows the IMBC Platform architecture document, v0.3 or later, wherever it complies with this specification and the SoW. Where they differ on what is built, this specification governs. The architecture may contain foundations for later phases; those are not Phase 1 deliverables unless this specification names them.

**Requirements.** Every numbered statement is a requirement and is tested at acceptance. Prefixes group them: `GEN` general, `AUTH` sign-in, `MAN` manufacturer, `REV` verification, `IMBC` IMBC records, `EXT` external checks, `ADM` administration, `OPR` operator, `FC` demand forecast, `NOT` notifications, `LANG` languages, `AUD` audit, `DATA` data, `MIG` migration, `NFR` non-functional.

**Prototype.** A clickable prototype on mock data illustrates the screens. It is an annex, not a requirement. Where a screen and this text disagree, this text governs.

## 2. Purpose and scope

The platform replaces IMBC's Excel base of manufacturers with a single verified register. It serves four parties:

- **Manufacturers** keep their own profile up to date. In return they get the demand forecast and the technical requirements: the summarized technical requirements (STR) and the key technical requirements excerpts (KTRE).
- **IMBC** verifies profiles, records its own assessments, and runs the platform.
- **Operators** find verified manufacturers, see everything about them, and take the data into their own systems as files or through a read-only API.
- **Observers**, such as the Ministry of Energy, read the verified register and change nothing. They see the dashboard, the list of manufacturers, and the detailed profile, including the company phone and email from the prefill and the tier. They do not see the focal point or the demand forecast.

The register supports pre-qualification. Tenders and procurement happen outside the platform.

Phase 1 contains:

- self-registration of manufacturers, and invitation of operators, observers, and IMBC staff;
- the manufacturer profile in eight sections, with documents and certificates;
- product lines prefilled from e-Ondiris;
- verification of the profile by IMBC, section by section;
- a quarterly update status for verified profiles;
- IMBC's own records: site survey, due diligence, internal notes, and an AGAR or a CDP on a product;
- tiers on a verified profile: tier 1 when verified, tier 2 when site surveyed, tier 3 on a product that has an AGAR or a CDP report;
- a real connector to Adata, a daily local copy of e-Ondiris, and mock connectors for the other external services;
- search, filters, company page, dashboard, file export, export subscriptions, and a read-only API for operators;
- the dashboard, the manufacturer list, and detailed profiles for observers, including the company phone and email from the prefill, the tier, and excluding the focal point and the demand forecast;
- the demand forecast, and STR and KTRE, for manufacturers;
- migration of the Excel base, the existing site-survey files, and invitation of migrated manufacturers;
- Kazakh, English, and Russian interface;
- audit of every action, and weekly and monthly activity snapshots.

## 3. Parties, roles, and terms

### 3.1 Account types and roles

| Account type | Role | Who creates the account |
|---|---|---|
| Manufacturer | — | The manufacturer registers, or migration creates it |
| IMBC staff | SME | IMBC administrator |
| IMBC staff | IMBC administrator | IMBC administrator |
| IMBC staff | IMBC general director | IMBC administrator |
| Operator | — | IMBC administrator |
| Observer | — | IMBC administrator |

- **GEN-01.** A manufacturer organisation has exactly one account. The account signs in with a company mailbox, not a person's address.
- **GEN-02.** An operator organisation can have any number of operator accounts, one per person.
- **GEN-03.** The IMBC administrator creates accounts, operator organisations, and observer organisations, keeps the reference lists, publishes the demand forecast and the STR and KTRE files, and issues pull-API credentials. The IMBC administrator does not see manufacturers' data (section 4). No role has every right.
- **GEN-04.** The IMBC general director reads every record, including the audit log, and changes none of it. The short form is IMBC GD.
- **GEN-05.** The three major operators, NCOC, TCO, and KPO, are marked as major operators. The IMBC administrator can add other operator organisations.
- **GEN-06.** An observer organisation has read-only accounts, one per person. IMBC creates the organisation and the accounts. Phase 1 issues them. What an observer may do is GEN-13.
- **GEN-07.** An SME decides whether a manufacturer's data and documents are acceptable. The SME verifies each section and document, records the site survey, an AGAR or a CDP on a product (IMBC-23), and the due diligence, validates works-with and visit marks, and answers operator requests. The SME does not manage accounts.

### 3.2 Terms

The project glossary (`GLOSSARY.md`) defines the terms used here. The terms below matter most for reading this document.

| Term | Meaning |
|---|---|
| SME | An IMBC subject-matter expert. The role that decides whether a manufacturer's data and documents are acceptable. |
| IMBC administrator | The role that keeps accounts, reference lists, and publishing, and does not see manufacturers' data. |
| IMBC general director | The role that reads every record and changes none. The short form is IMBC GD. This is not the head of a manufacturer. |
| Manufacturer profile | The dossier of one manufacturer organisation. One BIN is one profile. |
| Focal point | The one contact through whom IMBC and operators deal with a manufacturer first. A contact is not an account. |
| Verified | The state of a profile whose data IMBC has checked and accepted. Operators and observers see it while its due-diligence result is green or amber. This is tier 1 (IMBC-19). An unresponsive profile stays visible and sorts below the others (UPD-04). |
| Pending changes | Edits to a verified profile that IMBC has not yet checked. |
| Site surveyed | The mark that IMBC has visited the manufacturer's site and holds a signed site survey report. |
| Due diligence | The check of a manufacturer's legal and financial standing: automatic through Adata, plus any enhanced due diligence. The result is green, amber, or red (IMBC-11). An IMBC employee may change it. |
| Works with | An operator's mark that it already works with a manufacturer, confirmed by IMBC. |
| Mandatory certificate | A certificate type a manufacturer must hold before its profile can be verified. |
| Others | The category of every certificate that is not mandatory. |
| Product line | One kind of goods a manufacturer makes, identified by its TN VED code. |
| Demand forecast | IMBC's published statement of expected purchases, with no operator named on it, for manufacturers only. A line's wording names no operator, project, or brand. |
| Summarized technical requirements (STR) | IMBC's own text for one product, written from the operators' requirements with the operator, the project, and the brand taken out. |
| Key technical requirements excerpts (KTRE) | The short form of the STR for the same product. |
| NDA | The non-disclosure agreement a manufacturer accepts when it creates its account. It covers the detailed demand forecast, the STR, and the KTRE. |
| Export subscription | An operator user's standing request to receive the results of one saved search by email, at a period they choose. |
| Operator note | An operator's own remark on a manufacturer, shared within that operator organisation and with IMBC. |
| Operator request | An operator's ask for certain data on a manufacturer. The manufacturer is not told which operator asked. |
| IMBC request | An operator's message to IMBC staff. |
| Update status | Whether a verified manufacturer is keeping its data current: active, outdated, or unresponsive. Unresponsive stays visible and sorts below the others. Passing time does not remove Verified. |
| Tier | Tier 1 is a verified profile. Tier 2 is a site survey. Tier 3 is an AGAR or a CDP on one product. A profile that is not verified is not a tier. |

## 4. Access rules

- **GEN-08.** Rights are enforced by the server on every request, not only in the interface: for lists, the company page, counts, files, and exports alike. A request without the right is refused and written to the audit log.
- **GEN-09.** A file is served only after the same rights check as the record it belongs to. A file link cannot be used to bypass the check.
- **GEN-10.** The access rules are stored as data and the access tests are generated from them. No one changes them in the interface; a change comes with a release.

| What                                                                      | Manufacturer | SME       | IMBC administrator       | IMBC general director     | Operator              | Observer             |
| ------------------------------------------------------------------------- | ------------ | ------------ | ------------------- | ------------ | --------------------- | --------------------- |
| Own profile: view and edit                                                | edit         | view         | —                   | view         | —                     | —                     |
| Verify profiles, sections, documents                                      | —            | yes          | —                   | —            | —                     | —                     |
| Assign reviews                                                            | —            | take         | assign              | —            | —                     | —                     |
| Site survey, due diligence, IMBC notes                                    | —            | edit         | —                   | view         | —                     | —                     |
| Tier, AGAR, and CDP                                                       | request own  | edit         | —                   | view         | tier, and which products are tier 3 | tier only |
| External checks                                                           | —            | run and view | —                   | view         | —                     | —                     |
| Validate "works-with" and visit marks; see which operators work with whom | —            | yes          | —                   | view         | —                     | —                     |
| Accounts of all organisations                                             | —            | —            | yes                 | —            | —                     | —                     |
| Reference lists, NDA versions, organisation-chart sample                  | —            | —            | yes                 | view         | —                     | —                     |
| Import and publish forecast; STR and KTRE files                          | —            | —            | yes                 | view         | —                     | —                     |
| Invite migrated manufacturers                                             | —            | —            | yes                 | —            | —                     | —                     |
| Search and company page                                                   | —            | all profiles | —                   | all profiles | visible verified only | visible verified only, without the focal point |
| Dashboard                                                                 | —            | —            | —                   | yes          | yes                   | yes                   |
| Export search results                                                     | —            | yes          | —                   | yes          | yes                   | —                     |
| Export subscriptions                                                      | —            | —            | —                   | —            | own only              | —                     |
| Pull API                                                                  | —            | —            | issue and revoke    | —            | own organisation      | —                     |
| "Works-with" mark, visit mark                                             | —            | —            | —                   | —            | own organisation      | —                     |
| Operator notes                                                            | —            | view         | —                   | view         | own organisation      | —                     |
| IMBC request                                                              | —            | answer       | —                   | view         | send                  | —                     |
| Operator request                                                          | reply        | view         | —                   | view         | send                  | —                     |
| Demand forecast, STR, and KTRE                                           | once verified, current NDA | view | view         | view         | —                     | —                     |
| Audit log                                                                 | —            | —            | account events only | all          | —                     | —                     |

Visible verified means a verified profile whose due-diligence result is green or amber (IMBC-11), at any update status. An unresponsive profile stays in search and on the map and sorts below active and outdated profiles (UPD-04). A result of red keeps the profile off operator and observer views until an SME sets green or amber. A profile that is not verified stays off those views. It is not a tier.

- **GEN-11.** A manufacturer sees only its own profile. It never sees another manufacturer, and it never sees which operators work with it.
- **GEN-12.** An operator never sees the data of another operator: its marks, notes, exports, subscriptions, API credentials, or requests.
- **GEN-13.** An observer sees the dashboard, the list of manufacturers, and the detailed profile of a visible verified manufacturer, including the company phone and email from the prefill and the tier. An observer does not see the focal point. An observer does not see the demand forecast, the STR, the KTRE, or an AGAR or CDP report. An observer does not export a search, subscribe, call the pull API, or write anything.

## 5. Manufacturer

### 5.1 Registration and first sign-in

- **MAN-01.** A manufacturer registers with the company name, the BIN, the company email, agreement to the platform terms and personal-data policy, acceptance of the current NDA (FC-02), and an answer to “How did you hear about us?”. The form has no password field. The answer is for IMBC only and is not shown to operators or observers.
- **MAN-02.** The BIN has exactly 12 digits and a valid check digit. A BIN that already exists in the register is refused, with a message to contact IMBC.
- **MAN-03.** After registration the platform sends the password email (AUTH-01). Once the password is set, the profile exists with the status Draft.
- **MAN-04.** A Draft profile is visible only to its manufacturer and to IMBC.
- **MAN-05.** The company email is the login. The manufacturer cannot change it; only an IMBC administrator can (ADM-05).

### 5.2 Profile sections

The profile has eight sections. Completeness is MAN-41.

- **MAN-06.** Four pulled fields can be returned by both e-Ondiris and Adata: the company legal name, the kind of activity, the company phone, and the company contact email. For those, the platform keeps the e-Ondiris value. It uses the Adata value only when e-Ondiris returned nothing, and the manufacturer types the value only when both returned nothing. The company contact email is not the login. Every other pulled field comes from the one source named for it. A later read does not replace a value the manufacturer has saved. The Adata query runs when the profile is created (IMBC-07), not while a registration is still an unfinished form.
- **MAN-07.** From Adata the platform prefills the legal address, the director's full name, the date of state registration, the shareholders, and the legal form. It also returns the kind of activity, the company phone, and the company contact email, which are used only as in MAN-06. It does not prefill headcount. The manufacturer confirms each prefilled value, and types it when that source returned nothing.
- **MAN-08.** From e-Ondiris the platform prefills the production address, the product lines, the producer's phone and email, the TN VED code, the KPVED code, the production capacity, the in-country value share, the localization level, and whether the registry entry is active. It also returns the company legal name, which is used as in MAN-06. MAN-25 shows these fields. The producer's phone and email are the company contacts, not the focal point. The phone and the contact email follow MAN-06. Adata is not a source for the product fields, the production address, the capacity, the in-country value share, or the localization level.

**Main information**

- **MAN-09.** Company legal name, legal form (mandatory, from a list that includes LLP, LLC, and JSC), BIN (from registration, read-only), website (optional), the director's full name, and the date of state registration. The manufacturer cannot change the BIN. The legal name is kept from e-Ondiris when both sources return one (MAN-06). The platform does not translate it. It keeps the spelling the source recorded, including when that spelling is Russian. The legal form, the director's full name, and the date of state registration are prefilled from Adata (MAN-07). The manufacturer confirms each prefilled value.
- **MAN-10.** One or more OKED codes, chosen from the OKED reference list by typing a code or a name (mandatory). When none is chosen yet, the kind of activity is prefilled from e-Ondiris, and from Adata only when e-Ondiris returned none (MAN-06).
- **MAN-11.** Region (mandatory, from the reference list of regions), city, legal address, and production address (mandatory), company phone (mandatory), company email (the login, read-only). The legal address is prefilled from Adata (MAN-07). The production address is prefilled from e-Ondiris (MAN-08). The company phone, and a contact email that is not the login, are prefilled as in MAN-06. The manufacturer can correct the phone and that contact email. These addresses are different fields.
- **MAN-12.** Unified Register (e-Ondiris): registered yes or no (mandatory), date of first inclusion (optional), and an extract file (optional). Registered is yes when the read for that BIN returns at least one product. The date of first inclusion is the earliest registry inclusion date among those products (MAN-25). The section also shows the OKED code and name from that read, beside each other, as the registry states them. That pair does not replace the OKED codes the manufacturer selects (MAN-10).

**Contacts**

- **MAN-13.** At least three contacts, and no upper limit. Each contact has a full name, a position, an email, and a phone, all mandatory, and exactly one role. The roles are management, technical, and commercial. A role may be used on more than one contact. The three contacts do not have to cover all three roles. The platform rejects a contact whose email or phone matches another contact on the same profile, and does not save it.
- **MAN-14.** The manufacturer marks exactly one contact as the focal point. The focal point is that mark on a contact, not a fourth role and not the login. The login remains the company mailbox (MAN-05).
- **MAN-15.** Email and phone are checked for format when saved.
- **MAN-16.** During verification the SME contacts manufacturer before approving the profile.

**Personnel**

- **MAN-17.** Headcount in three categories: managers, office staff (engineers and administration), and production workers (all mandatory). The manufacturer enters them. The total is their sum.
- **MAN-18.** The number of non-Kazakhstan citizens in managerial positions (mandatory).
- **MAN-19.** Organisation chart file (mandatory).
- **MAN-20.** CVs of key people (optional, one or more files).

**Shareholders**

- **MAN-21.** At least one shareholder, each with name, share in percent, and citizenship or country of registration (all mandatory). When the manufacturer has entered none, the shareholders Adata returns prefill the rows (MAN-07).
- **MAN-22.** The section shows the total of the shares and warns when it is not 100 %. The warning does not block submission.

**Products**

- **MAN-23.** Any number of product lines, at least one. A line the manufacturer adds has a name in English and in Russian (mandatory), a commodity group A–E and a commodity type from IMBC's lists (mandatory), a TN VED code (mandatory), a KPVED code (optional), a production capacity (mandatory), an in-country value share (optional), a localization level (optional), and a certificate-of-conformity file (optional), and an optional note. Production capacity on an added line is a number and a unit per year. The units are pieces, tonnes, metres, and sets. In-country value share is a percent. Localization level is a count of steps, such as 7 of 9. A line read from e-Ondiris follows MAN-25.
- **MAN-24.** TN VED and KPVED codes on a line the manufacturer adds are chosen from reference lists. Leading zeros are kept.
- **MAN-25.** The platform reads the manufacturer's BIN from the local e-Ondiris copy (EXT-02) when the profile is created, and again when a daily pull changes that BIN. It does not call e-Ondiris when the products section opens. Each registry record becomes one product line, shown as e-Ondiris returned it. The manufacturer cannot edit or delete that line, and cannot add a second line for that product. A second line is an added line with the same product name and the same TN VED code. When a daily pull brings such a product, the pulled line is kept and the matching added line is not. The manufacturer can add a line that is not in the copy (MAN-23). An added line has an in-country value share of 0. A daily pull updates a pulled line to match the registry. It does not replace a company name, an address, an OKED selection, or a contact the manufacturer has already saved. Where the company legal name or the kind of activity is still empty, e-Ondiris is kept over Adata (MAN-06). The production address is filled from this read when it is still empty (MAN-08). If the copy has no product for that BIN, the manufacturer continues by hand. A failed daily pull is not shown as a finding. The source for the split below is `docs/initial-data/E-Ondiris_Field_Reference.docx`, 5 November 2026. The response has 27 fields. The platform shows 21.

  On the product line it shows the registry entry number (`registration_number`), the BIN, and the producer’s legal name; the place name (`region_kato`, which is not a KATO code), the production address, the website, the phone, and the email; the product name; the production capacity as text, for example `8600.00 кг/год`; the KPVED code and name together; the 10-digit TN VED code, which has no name in the response; the ENSTRU code and name together; the in-country value share (`dvc_percent`) as a percent; the localization level; the registry inclusion date; and whether the entry is active. The localization level is written as done out of total and shown as “11 of 11 stages in KZ”. It is not a pass or a fail. The minimum that counts as Kazakhstani depends on the TN VED code and is not in the response. An active entry is marked Active. An entry that is excluded or expired is marked Not active, and it is still shown. A code and its name are shown together for KPVED and ENSTRU. “-”, null, and an empty string are empty. The production address is trimmed. BIN and TN VED are stored as text.

  On the main information section it shows the OKED code and name from the same read (MAN-12).

  It does not show, and does not keep on the profile, the barcode (`product_code`), AGSK-3 code and name, the registry comment, the data source, or NTIN. ENSTRU is kept because it names the procurement item. The platform does not match tenders.

**Production**

The production section is optional. Nothing in it is required before submission, and it never lowers profile completeness (MAN-41). IMBC's current base has none of this data. Operators check it in their own audits.

- **MAN-26.** The manufacturer may leave the whole section empty.
- **MAN-27.** Production area in square metres.
- **MAN-28.** Main processes, chosen from IMBC's reference list of processes.
- **MAN-29.** An equipment table, with name, type from a reference list, and quantity per row. A row may be linked to one or more of the manufacturer's product lines. A row has no year and no location.
- **MAN-30.** Number of workshops.
- **MAN-31.** Utilisation, as a percent from 0 to 100.
- **MAN-32.** Photos of equipment and processes.

**Certificates**

- **MAN-33.** Any number of certificates, each with type, number, issuing body, issue date, expiry date, and a file. The expiry date is optional for certificates that do not expire.
- **MAN-34.** Types are mandatory or Others. The mandatory types are set by the IMBC administrator (ADM-09); at go-live they are ISO 9001, ISO 14001, and ISO 45001. IMBC chose these three knowingly, aware that few migrated manufacturers hold them. Others offers the named types ASME, API, IEC, IECEx, ATEX, and Extract from e-Ondiris, and Other, where the manufacturer types the name. CT-KZ and the industrial certificate for internal circulation are not types. Both were cancelled in Kazakhstan on 1 January 2026. A certificate of a product is not one of these mandatory types. It sits on the product line (MAN-23).
- **MAN-35.** Every mandatory type must be present with a file before the profile can be submitted.
- **MAN-36.** The manufacturer can download every file it uploaded. Replacing a file keeps the earlier version in the history.

**Documents**

- **MAN-37.** Registration certificate and charter (mandatory).
- **MAN-38.** Licences (mandatory), unless the manufacturer states “No licence required for our activity”. The SME accepts or rejects that statement like any document.
- **MAN-39.** Mandatory and optional document types are set by the IMBC administrator (ADM-09).

### 5.3 Submission and review

- **MAN-40.** The manufacturer can save any section at any time and return to it later.
- **MAN-41.** Each section shows the percentage of its own mandatory fields and files that are filled. The profile percentage is the average of those sections, each with equal weight. The production section is left out of the average. “Send for review” is available only when the profile percentage is 100. Until then the platform lists what is missing. There is no numeric rating of manufacturers.
- **MAN-42.** Sending for review requires the manufacturer to confirm that the data is accurate. The profile status becomes Submitted.
- **MAN-43.** While the profile is Submitted or Under review, it is locked. The manufacturer can unlock it to edit. Unlocking takes the profile out of IMBC's queue and returns it to Draft, or to Verified with pending changes if it was already verified. The assigned SME is notified (NOT-10). The SME's decisions on sections the manufacturer leaves unchanged are kept, and the profile returns to the same SME when sent again.
- **MAN-44.** When the profile is Returned, the manufacturer sees each rejected section, document, or certificate with the SME's comment, corrects it, and sends the profile again. Sections the SME verified and the manufacturer did not change stay verified.
- **MAN-45.** When the profile is Verified, the manufacturer can still edit it. Each changed section becomes a pending change. “Send changes for review” sends the pending changes to the SME who verified the profile. The profile stays Verified while they are checked.
- **MAN-46.** The manufacturer always sees the current status of the profile, each section, and each document and certificate.

### 5.4 Demand forecast and technical requirements

- **FC-01.** The demand forecast and the technical requirements are offered only to a Verified profile that has accepted the current NDA.
- **FC-02.** At self-registration the manufacturer ticks acceptance of the current NDA (MAN-01). A migrated manufacturer accepts it on first sign-in. One acceptance covers the detailed forecast, the STR, and the KTRE. When the profile exists, the platform records the time, the NDA version, and the IP address. It does not ask again when a section is first opened. Both sections stay closed until the profile is Verified (FC-01).
- **FC-03.** When IMBC publishes a new NDA version, the forecast and the technical requirements stay closed until the manufacturer accepts the new version. Acceptance is the same tick, recorded as in FC-02.
- **FC-04.** The manufacturer sees the whole published forecast at once. There is no per-product request and no further approval by IMBC. The manufacturer searches the table and filters it by its columns, including commodity group, commodity type, and a TN VED prefix. A TN VED prefix such as 8481 finds every longer code that starts with it.
- **FC-05.** Each line shows TN VED code, commodity group, commodity type, description, unit of measure, and the total estimated quantity to the end of the forecast horizon. Commodity group is the line's category. Commodity type is its subcategory. No line names an operator, a project, or a brand, and no line shows a split of quantity. IMBC removes those words before import. FPAL codes are not stored.
- **FC-06.** The manufacturer cannot download or print the forecast. The lines stay on the platform.
- **FC-07.** The manufacturer cannot change, upload, or comment on forecast data.
- **FC-08.** STR and KTRE are a section of their own. They are not opened from a forecast line. The section groups files by commodity group, and under a group by product. For a product, IMBC may store two PDFs: the STR and the KTRE. Both are one text written by IMBC. Operator names, project names, and brands are removed. The file is not an operator's original specification. The manufacturer opens a PDF on the platform, can zoom and scroll, and cannot download or print it. The platform does not parse a PDF into fields. A product may have neither file. IMBC keeps the list of products that have a file. The section states that these files are IMBC's texts, not an operator's catalogue. The same NDA acceptance covers this section (FC-02). A file supplied in one language is shown in Kazakh, English, and Russian. The platform does not translate it. TCO is supplied as one file.
- **FC-09.** The forecast and the technical requirements are not limited to the manufacturer's own products or commodity groups.
- **FC-10.** IMBC prepares the lines and approves them before import. The set now in preparation is about 77,000 lines for commodity groups A–D and about 8,000 for group E. Later operator data may extend the horizon to 2035. Full automation of that intake is not in Phase 1; the import structure is. The consolidated forecast, grouped by commodity groups A–E, stays on IMBC's website. Phase 1 does not build that page.

### 5.5 Update status

Update status is separate from account inactivity (AUTH-07). It applies once the profile is Verified. A newly verified profile starts as active. Passing time does not remove Verified, and the manufacturer cannot set Verified itself.

- **UPD-01.** Every quarter the platform emails the manufacturer account and the focal point, asking the manufacturer to confirm that its data is current (NOT-12, NOT-15). What counts as a quarter and as a confirmation is NOT-31. At most 50 of NOT-12, NOT-15, and NOT-16 go out in a day.
- **UPD-02.** While the manufacturer keeps confirming, the update status is active.
- **UPD-03.** Seven days after NOT-12 with no confirmation, the update status is outdated. The profile stays visible to operators and observers, and it stays on the dashboard map.
- **UPD-04.** Seven days after NOT-15 with no confirmation, the update status becomes unresponsive. The profile stays visible to operators, observers, and the map, and it sorts below active and outdated profiles in search and in the manufacturer list. It is not deleted, and the account is not blocked. NOT-16 tells the manufacturer that the profile is unresponsive and appears lower in search. Hiding an unresponsive profile is not part of Phase 1. The timing is NOT-31.
- **UPD-05.** To become active again from unresponsive, the manufacturer opens the prefilled profile and confirms each section, one by one. Each confirmation is written to the audit log. While the status is active or outdated, one confirmation is enough (NOT-31).
- **UPD-06.** The statuses operators and observers see are active, outdated, and unresponsive.

## 6. IMBC staff

### 6.1 Review queue

- **REV-01.** A submitted profile enters an unassigned queue. An SME can take it, or an IMBC administrator can assign it to an SME. An IMBC administrator can reassign it at any time. Assigning shows the IMBC administrator the manufacturer's name, status only, and assignee (SME).
- **REV-02.** When the assigned SME opens the profile, its status becomes Under review. The profile shows who is reviewing it.
- **REV-03.** A profile sent again after a return or after unlocking (MAN-43), and pending changes on a verified profile, go to the SME who reviewed it before.
- **REV-04.** The queue shows every profile with its manufacturer, status, assigned SME, and date received, and can be filtered by each of them. An unlocked profile leaves the queue.

### 6.2 Verifying a profile

- **REV-05.** The SME sees every section as the manufacturer entered it, with every file to open or download.
- **REV-06.** The SME verifies or rejects each section, and each document and certificate in it. The comment is on the section. The SME does not comment on each field, and does not replace the section comments with one comment for the whole profile.
- **REV-07.** “Submit result” is available once every section has a decision. If every section is verified, the profile becomes Verified and appears to operators and observers while its due-diligence result is green or amber (IMBC-11), including when its update status is unresponsive (UPD-04). Otherwise it becomes Returned. Either way, the manufacturer is notified (NOT-05).
- **REV-08.** For pending changes, the SME decides only the changed sections. Accepted changes replace the verified values. Rejected changes go back to the manufacturer with the comment, and operators keep seeing the last verified values. The manufacturer is emailed as in NOT-28.
- **REV-09.** The SME does not edit the manufacturer's data. IMBC does not submit a profile on a manufacturer's behalf.

### 6.3 Profile statuses

| Status | Meaning | Set by |
|---|---|---|
| Draft | Created at registration or migration, or unlocked from review; being filled in | Platform, or manufacturer by unlocking |
| Submitted | Sent for review, waiting for an SME | Manufacturer |
| Under review | An SME has it open | SME |
| Verified | Every section verified; visible to operators and observers while the due-diligence result is green or amber. This is tier 1. An unresponsive profile stays visible and sorts below the others (UPD-04) | SME, by Submit result |
| Returned | Some sections rejected; back with the manufacturer | SME, by Submit result |

A Verified profile with pending changes stays Verified and carries a pending-changes mark.

Document and certificate statuses are uploaded, under review, verified, rejected, expired, and missing. Missing means a mandatory item has not been uploaded. Expired is set by the platform when the expiry date has passed. A file that has not passed the malware scan (DATA-07) cannot be opened or verified.

- **REV-10.** An expired certificate, a mandatory one included, stays on the profile, shown as expired. It does not remove Verified. When the update status is active, expiry sets it to outdated. Expiry does not by itself set the status to unresponsive. The profile stays visible to operators and observers. If the update status is outdated only because a certificate expired, replacing that certificate sets the status back to active. A missed quarter still follows NOT-31.

### 6.4 Site survey

- **IMBC-01.** An SME records site surveys on a profile. Each record has visit dates, the result (yes or no), the signed report file, an expiry date set by the person who records it, and an optional comment. A profile can have several records over time.
- **IMBC-02.** A profile is site surveyed while it has a record with result yes and a signed file. When that record has an expiry date, the date is in the future. A record with no expiry date stays site surveyed until IMBC sets a date that has passed. There is no automatic one-year or two-year term.
- **IMBC-03.** A survey record can be added at any time, including for reports made before the platform existed.
- **IMBC-04.** The SME sees visit marks left by operators (OPR-21) and accepts or rejects each one. The decision is visible to IMBC only.
- **IMBC-05.** When a profile becomes site surveyed (IMBC-02), every operator user is emailed a link to the company page (NOT-11). This notice is on by default. The cases that do and do not send it are NOT-34. Operators are not emailed about a new registration. Observers are not emailed.
- **IMBC-06.** Phase 1 has no rank and no score of a manufacturer. The overall ranking brought in from Excel stays a legacy note (MIG-09). It is not shown as a rank on the profile.

### 6.5 Due diligence

The sample of what an SME reads today is Adata's extended report for TOO Portal Uchet, BIN 160940010447, generated 29 October 2026, in `docs/notes/2026-11-05/`. The portal does not ask the SME to open that PDF. The same report is read through the Adata API (EXT-02). One run produces the result. Every check from that run stays on the record, with its mark.

- **IMBC-07.** Every manufacturer is checked through Adata when its profile is created (MAN-03), on the same read that prefills the Adata fields (MAN-07). A BIN typed into a registration that never becomes a profile is not queried. A migrated profile is checked once at import (EXT-02). The check repeats once a quarter, counted from the last check, and it is not run again each time the profile is opened. One BIN is one request, counted against an allowance of 3,000 BIN a month. The allowance in hand resets on 4 December 2026. One request fans out to many calls, and a rate limit is not a finding. This check does not replace the checks an operator runs for itself. The connector queries Adata with the manufacturer's BIN. The due-diligence record holds the date, the result, a comment, an optional report, and each check in IMBC-10 with its group, subject, Adata's value, and its mark. The result is green, amber, or red (IMBC-11).
- **IMBC-08.** An SME records enhanced due diligence as done or not done, with a comment and a report, for findings Adata does not cover, such as political exposure or affiliations. The SME can set the result to green, amber, or red. Political-exposure lists and AI lookups are not used. Political exposure stays this manual check.
- **IMBC-09.** Operators and observers see the date of the check and whether enhanced due diligence was done. They do not see the result, the findings, the checklist, or the report.
- **IMBC-10.** The checks are the lines in the tables below, in the order of the sample extended report. The company tables run once. The director table runs for the director. The founder table runs for each founder, and again for each beneficiary when Adata returns one. The same person can appear in more than one table. A line Adata does not return is absent, not a finding. A yes-or-no line Adata adds later is stored and scored, unless its title is one of the shown-only titles in these tables.

  Each line is marked clear, finding, shown only, or no answer. A scored line is a finding when Adata's value is yes. It is clear when the value is no. A shown-only line keeps the value, and a yes is not a finding. No answer is the mark when Adata says the source did not respond. It is not clear, not a finding, and not scored.

  A yes stays shown only for a mass registration address, participation in court cases, administrative fines, a top-100 ranking, taking part in public procurement or in Samruk-Kazyna, the Samruk-Kazyna producers register, concluded contracts, the trusted-software register, the large-taxpayer monitoring list, and removal from the terrorism-financing list. On the director and on a founder, court participation keeps the case counts as the value. A mass address is ordinary in a business centre. Court cases and administrative fines are ordinary. A top-100 place is a ranking. Taking part, a producers listing, a contract count and sum, a trusted-software listing, and a place on the large-taxpayer list are records of activity or size. Removal from the financing list means the person was taken off it. The period in an inspection-list title is the period Adata gives, and that title is stored with the value. Concluded contracts keep the count and the sum. The contract-by-contract list is not stored (IMBC-12).

**Company. Enterprise.**

| Check | Mark |
|---|---|
| Mass registration address | Shown only |
| On the list of complex on-site customs inspections for the period Adata names | Scored |
| On the list of preventive control and supervision for the period Adata names | Scored |
| On the list of labour inspections for the period Adata names | Scored |
| On the published register of persons receiving funds or property from abroad | Scored |
| Removed from the stat.gov register | Scored |
| Inactive enterprise | Scored |
| Bankrupt | Scored |
| Registration declared invalid | Scored |
| Reorganised in breach of the Tax Code | Scored |
| Absent at the legal address | Scored |
| Sham enterprise | Scored |
| Re-registration declared invalid | Scored |
| Electronic invoices suspended | Scored |
| Tax debt above 150 monthly calculation indices | Scored |
| Bankrupt, and the court decision has taken effect | Scored |
| Bankrupt, and the procedure is complete | Scored |
| Bankrupt, and a rehabilitation period has started | Scored |
| Taxpayer in liquidation | Scored |
| Arrest of bank accounts | Scored |
| Arrest of property | Scored |
| Temporary ban on leaving Kazakhstan | Scored |
| Ban on registration acts | Scored |
| Ban on notarial acts | Scored |
| Arrest of vehicles | Scored |
| Sale of arrested property | Scored |
| On the register of auctions of arrested property | Scored |
| Announcement that rehabilitation proceedings have started | Scored |
| Announcement of a creditors' meeting in rehabilitation | Scored |
| Announcement of a creditors' meeting in bankruptcy | Scored |
| Debtor, and the court decision of bankruptcy has taken effect | Scored |
| Debtor, and a court has ordered liquidation without bankruptcy | Scored |
| Debtor, and a court has ordered a rehabilitation procedure | Scored |
| Court order ending a rehabilitation procedure has taken effect | Scored |
| Supervisory measures and sanctions applied | Scored |
| Participation in court cases | Shown only |
| Administrative fines | Shown only |
| Financial pyramid under a pre-trial investigation by the financial-monitoring agency | Scored |
| Financial pyramid, and that investigation is closed | Scored |
| Financial pyramid with a court sentence | Scored |
| Bankruptcy or rehabilitation proceedings opened | Scored |

**Company. Finance.**

| Check | Mark |
|---|---|
| Large taxpayers subject to monitoring | Shown only |
| Debtor under enforcement proceedings | Scored |
| Party to transactions with no actual performance | Scored |
| Debtor temporarily banned from leaving Kazakhstan | Scored |
| Tax and customs arrears | Scored |

**Company. Procurement.**

| Check | Mark |
|---|---|
| Participant in public procurement of Kazakhstan | Shown only |
| Top-100 suppliers of public procurement | Shown only |
| Top-100 customers of public procurement | Shown only |
| Dishonest participant in public procurement of Kazakhstan | Scored |
| Participant of Samruk-Kazyna | Shown only |
| Register of Samruk-Kazyna producers | Shown only |
| Register of unreliable suppliers of Samruk-Kazyna | Scored |
| Register of trusted software and electronics | Shown only |
| Concluded contracts | Shown only |
| Unreliable supplier of Nazarbayev Intellectual Schools | Scored |
| Unreliable supplier of Nazarbayev University | Scored |
| Dishonest participant of the National Bank of Kazakhstan | Scored |
| Dishonest participant of Mitwork | Scored |

**Company. Tax payments.** The table is kept for every year Adata returns, with tax, payroll, and the total. One line is scored: the total for the latest year is zero. That year may be partial. It is clear when the total is not zero. Earlier years are shown only, including a year that totals zero. The tax regime is shown only.

**Director.**

| Check | Mark |
|---|---|
| Participation in court cases | Shown only |
| Debtor under enforcement proceedings | Scored |
| Debtor temporarily banned from leaving Kazakhstan | Scored |
| Tax and customs arrears | Scored |
| Arrest of bank accounts | Scored |
| Arrest of property | Scored |
| Temporary ban on leaving Kazakhstan | Scored |
| Ban on registration acts | Scored |
| Ban on notarial acts | Scored |
| Arrest of vehicles | Scored |
| Sale of arrested property | Scored |
| On the list of persons who committed sexual violence against a minor | Scored |
| On the list of organisations and persons linked to financing terrorism or extremism | Scored |
| Removed from that financing list | Shown only |
| Missing-persons search | Scored |
| Wanted as a criminal | Scored |
| Wanted as a debtor or a respondent under an enforcement document | Scored |
| Maintenance debtor | Scored |
| Announcement that rehabilitation proceedings have started | Scored |
| Announcement of a creditors' meeting in rehabilitation | Scored |
| Announcement of a creditors' meeting in bankruptcy | Scored |
| Participant in a personal bankruptcy procedure | Scored |
| A problem in another company with the same director | Scored |

**Founder, and each beneficiary.**

| Check | Mark |
|---|---|
| Participation in court cases | Shown only |
| Legal entity with offshore participation | Scored |
| Debtor temporarily banned from leaving Kazakhstan | Scored |
| Debtor under enforcement proceedings | Scored |
| Tax and customs arrears | Scored |
| Arrest of bank accounts | Scored |
| Arrest of property | Scored |
| Temporary ban on leaving Kazakhstan | Scored |
| Ban on registration acts | Scored |
| Ban on notarial acts | Scored |
| Arrest of vehicles | Scored |
| Inactive enterprise | Scored |
| Removed from the stat.gov register | Scored |
| Bankrupt | Scored |
| Reorganised in breach of the Tax Code | Scored |
| Sham enterprise | Scored |
| Bankrupt, and the court decision has taken effect | Scored |
| Bankrupt, and the procedure is complete | Scored |
| Bankrupt, and a rehabilitation period has started | Scored |
| Dishonest participant in public procurement of Kazakhstan | Scored |
| Register of unreliable suppliers of Samruk-Kazyna | Scored |
| Taxpayer in liquidation | Scored |
| On the list of persons involved in terrorist activity | Scored |
| On the list of organisations and persons linked to financing terrorism or extremism | Scored |
| Removed from that financing list | Shown only |
| On the list of persons who committed sexual violence against a minor | Scored |
| Missing-persons search | Scored |
| Wanted as a criminal | Scored |
| Wanted as a debtor or a respondent under an enforcement document | Scored |
| Maintenance debtor | Scored |
| Registration declared invalid | Scored |
| Absent at the legal address | Scored |
| Re-registration declared invalid | Scored |
| Electronic invoices suspended | Scored |

  In the sample, court participation for the company is no answer, and the three remarks are a mass address and court participation of the director and of the founder. Those remarks need attention. Every scored line is clear, so the automatic result is amber.

- **IMBC-11.** The result is green, amber, or red. It is red when any critical check has fired (IMBC-14). It is amber when no critical check has fired and at least one check needs attention. It is green when no critical check has fired and no check needs attention. A no-answer line and a line Adata does not return leave the result unchanged. Red keeps the profile off operator and observer views until an SME sets green or amber (IMBC-08). Amber and green do not. The SME sees the profile at every result.
- **IMBC-12.** The parts of the extended report that are not checks stay out of this screen: registration and contacts, sister companies, related persons, the history of changes, industrial certificates, and the contract-by-contract list. They are not requested for the result.
- **IMBC-13.** The SME's screen opens on the result (green, amber, or red), the time of the check, and one count per group: how many checks, and how many findings, as the report headings do. Findings are the critical group, and shown-only lines that need a person are the attention group (IMBC-14). Each is listed under that summary with its group, the person's or company's name, the check name, and Adata's value. Every other check is on the same screen, in the report's groups, and each group is closed until the SME opens it. An opened group shows every line and its mark: clear, finding, shown only, or no answer. The SME does not type the lines. One action runs the check again from the API.
- **IMBC-14.** A line that needs a person is critical or attention. Critical is a finding: a scored line whose value is yes. The total for the latest tax year is critical when it is zero. Attention is a shown-only line whose value is yes, or whose count is above zero. Court participation is attention when any of the civil, criminal, administrative, or APPK counts is above zero. A mass registration address, administrative fines, a top-100 ranking, taking part in public procurement or in Samruk-Kazyna, the Samruk-Kazyna producers register, concluded contracts, the trusted-software register, the large-taxpayer monitoring list, and removal from the terrorism-financing list are attention when the value is yes. A scored no, a shown-only no, and a count of zero stay clear. No answer is neither critical nor attention. A line Adata does not return is absent, including when the register answers that the module is not connected, and an absent line is not shown as clear. A critical line makes the result red. An attention line makes the result amber when no critical line has fired. When Adata returns a taxpayer risk degree, low is clear, medium is attention, and high or any other value is critical.

### 6.6 External checks

- **EXT-01.** The platform has connectors for due diligence and for the national registries named in the Scope of Work, including an accounting service, the legal-entity registry, and e-Ondiris. A connector takes a BIN and returns a value, a status, a date, and a source.
- **EXT-02.** In Phase 1 the Adata connector is the real service. e-Ondiris has no published API. The platform keeps a local copy and, once a day, pulls new and changed records into that copy. A profile reads the copy (MAN-25). It does not call e-Ondiris when a section opens. Every other connector is a mock that returns test data. Mock results are clearly marked as test data everywhere they appear. The Adata connector authenticates with the value of the environment variable `ADATA_API_TOKEN`, supplied from the secrets manager (NFR-10). The variable is read on the server. It is not written in source, in this specification, or in logs.
- **EXT-03.** The SME can run the checks for a profile and see the results next to the due-diligence record. A connector result does not by itself change the profile status. It does set the due-diligence result, and a result of red keeps the profile off operator and observer views until an SME sets green or amber (IMBC-08, IMBC-11). The stored result is the one on the due-diligence record, after any change the SME makes (IMBC-08).
- **EXT-04.** The mocks demonstrate four cases: a green result, an amber result, a red result, and the service being unavailable. Unavailability is never shown as a critical check or as a check that needs attention.
- **EXT-05.** Connecting a real service in place of a mock changes that connector, not the rest of the platform.

### 6.7 IMBC notes

- **IMBC-15.** An SME keeps internal notes on a profile: free text with author and date, plus the legacy fields migrated from Excel (section 10). Only IMBC SMEs and the IMBC general director see them.

### 6.8 Works with and requests

- **IMBC-16.** The SME sees every "works-with" mark an operator sets or removes, with the operator's name, and validates or rejects each change. SMEs and the IMBC general director see which operators work with each manufacturer. The mark is yes or no. The label is “works with”. A comment the operator writes is an operator note (OPR-22), not a field on the mark.
- **IMBC-17.** The SME sees every IMBC request, with sender, organisation, subject, message, and linked manufacturer if any. The SME can reply in text and close the request.
- **IMBC-18.** The SME and the IMBC general director see every operator request, the manufacturer's reply, and whether it is still open (OPR-27). IMBC chases a manufacturer that is slow by phone or email outside the platform. The platform does not send that chase.

### 6.9 Administration

- **ADM-01.** The IMBC administrator invites IMBC staff, operator users, and observer users with email, name, role, and organisation. The invited person receives the password email (AUTH-01). Operators and observers do not register themselves.
- **ADM-02.** The IMBC administrator blocks and unblocks accounts of every organisation, and sees each account's last sign-in.
- **ADM-03.** The IMBC administrator creates operator organisations and observer organisations, and marks the major operators.
- **ADM-04.** The IMBC administrator runs “Invite all migrated manufacturers” once IMBC accepts the migration. Every migrated manufacturer with an email receives the password email. The action produces a report of profiles with no email or an invalid one.
- **ADM-05.** The IMBC administrator can change the login email of a manufacturer account.
- **ADM-06.** The IMBC administrator does not see profile content, documents, due diligence, IMBC notes, or operator data.
- **ADM-07.** The IMBC administrator issues and revokes an operator organisation's access to the pull API (OPR-36).
- **ADM-08.** The IMBC administrator maintains the reference lists: regions, legal forms, OKED, TN VED, KPVED, commodity groups, commodity types, processes, equipment types, contact roles, certificate types, and document types.
- **ADM-09.** In the certificate and document type lists, the IMBC administrator marks which types are mandatory. The change applies to profiles submitted afterwards.
- **ADM-10.** The IMBC administrator publishes NDA versions. Earlier versions are kept with their acceptances.
- **ADM-11.** The IMBC administrator uploads the organisation-chart sample (MAN-19).
- **ADM-12.** The IMBC administrator imports a demand forecast file in XLSX with a fixed column set. Missing columns stop the import. Extra columns, including any per-operator column and any FPAL column, are ignored and never published.
- **ADM-13.** The import checks every row and produces a report of rows with problems, such as a missing description or a non-numeric total. Faulty rows do not stop the import.
- **ADM-14.** The imported file becomes visible to manufacturers only when an IMBC administrator presses Publish. The newly published version replaces the previous one for manufacturers. IMBC keeps earlier versions.
- **ADM-15.** The IMBC administrator uploads, replaces, and removes STR and KTRE files. Each file belongs to one product in one commodity group, and is either the STR or the KTRE. It does not belong to an operator. The files open from the technical-requirements section, not from a forecast line (FC-08). IMBC keeps the list of products that have a file. A product may have neither file.

### 6.10 Tiers and AGAR

A profile IMBC has not verified is not a tier. Operators and observers do not see it. There is no tier 0. “Works with” is a mark (IMBC-16), not a tier.

- **IMBC-19.** A verified profile is tier 1. Tier 1 is that verification. It is not a second decision.
- **IMBC-20.** A tier 1 profile is tier 2 while it is site surveyed (IMBC-02). From a verified profile the manufacturer can request a site survey. The request names no product. It appears in the SME’s list and sends no email. The SME records the survey as in IMBC-01. The request does not create that record.
- **IMBC-21.** Tier 3 belongs to one product line, not to the whole profile. The product is tier 3 when its AGAR or CDP has the status report issued or a later status (IMBC-24). A visit without that report is not tier 3. A profile can be tier 2 and have some of its products at tier 3.
- **IMBC-22.** Operators and observers see the tier on the company page, in search, and on the dashboard. Observers see the tier only. Operators also see which product lines are tier 3. The manufacturer sees its own tier and the status of each of its AGAR and CDP records.
- **IMBC-23.** An SME records an AGAR or a CDP on a product line. One product has one such record. A manufacturer can have several, each on its own product. A finished CDP stays a CDP. New work is recorded as an AGAR. The record holds the status, the report file, and a comment. There is no questionnaire.
- **IMBC-24.** The statuses, in order, are requested, shortlisted, visit done, technical assessment done, report issued, recommendations in progress, and recommendation issued. Requested is used only when the manufacturer asked. The recommendations are part of the issued report. The SME sets the status. IMBC can shortlist a product that has no request.
- **IMBC-25.** A verified manufacturer can request an AGAR for one product that has an STR (FC-08). The request appears in the SME’s list and sends no email. It does not start the visit. If the product has no STR, the platform does not accept the request. The SME decides whether to take the work up.
- **IMBC-26.** Phase 1 does not send the recommendation to operators. Recommendation issued is a status on the record. Operators are not emailed a form, and the report file is not on the company page they see.

## 7. Operator

### 7.1 Search

- **OPR-01.** The operator and the observer search visible verified profiles only (GEN-13). Unresponsive profiles are in the results and sort below active and outdated profiles (UPD-04).
- **OPR-02.** Common filters: name or BIN, region, commodity group A–E, commodity type, certificate type, site surveyed, tier.
- **OPR-03.** Extended filters: TN VED prefix, KPVED prefix, OKED, works with operators (none, one, two, or three of three), headcount range, certificate valid until, Unified Register registration, verification date.
- **OPR-04.** Different filters combine with AND. Several values in one filter combine with OR. The certificate-type filter matches valid verified certificates unless the operator chooses otherwise.
- **OPR-05.** The current search and filters are part of the page address, so a link reproduces the same results.
- **OPR-06.** Results show at least the company name, BIN, region, commodity groups, main TN VED code, certificate types, site surveyed, tier, and verification date. Each result opens the company page.
- **OPR-07.** Name search finds a company whether it is typed in Russian, English, or with Kazakh letters, for example “ҚазМұнайГаз” finds “КазМунайГаз”.
- **OPR-08.** An empty result is shown differently from an error.

### 7.2 Company page

- **OPR-09.** The company page shows everything the manufacturer entered in the verified profile, contacts included, with every document and certificate to open or download. It does not show the answer to “How did you hear about us?”. An observer sees the company phone and email from the prefill and does not see the focal point. The page shows the tier (IMBC-22). It does not show an AGAR or CDP report file (IMBC-26).
- **OPR-10.** It also shows the date the profile was registered, the update status, the tier, the site survey report and its dates, the verification date, the date of the last due-diligence check, whether enhanced due diligence was done, and how many of the three major operators work with the manufacturer. An operator also sees which product lines are tier 3. An observer sees the tier and not the product-level tier 3 list.
- **OPR-11.** When the profile has pending changes, the page shows the last verified values with a mark that changes are awaiting IMBC verification.
- **OPR-12.** The page does not show IMBC notes, the due-diligence result, findings, or report, external check details, which operators work with the manufacturer, pending values, or an AGAR or CDP report file.
- **OPR-13.** The operator and the observer can download the page as one PDF with the same content that role sees, without operator notes. The observer's PDF does not include the focal point or the list of tier 3 products. There is no Word or Excel download.

### 7.3 Export and subscriptions

- **OPR-14.** The operator exports the current search results as XLSX or CSV, with the standard column set (DATA-09).
- **OPR-15.** The operator subscribes to the current search with a name, a format (XLSX or CSV), and a period (daily, weekly, or monthly).
- **OPR-16.** On each period the platform builds the file and emails the subscribing user's own account email a link to it. The link opens the file only after sign-in. The file is not attached. No other recipient can be set.
- **OPR-17.** The operator sees their subscriptions, can pause, resume, or delete each one, and sees every file built in the last 90 days with its time, row count, and success or failure. Each of those files can be downloaded.
- **OPR-18.** When the account becomes inactive (AUTH-07), its subscriptions pause. Fourteen days earlier, NOT-17 warns of it, as in NOT-26.

### 7.4 Marks, notes, and requests

- **OPR-19.** The operator can mark that its organisation works with a manufacturer, and remove the mark. The change waits for IMBC (IMBC-16). The operator sees its own mark and whether it is still waiting.
- **OPR-20.** The count of major operators shown to other operators includes validated marks only.
- **OPR-21.** The operator can mark that its organisation visited a manufacturer, with the visit date and an optional file. The mark goes to IMBC for review (IMBC-04).
- **OPR-22.** The operator can write notes on a manufacturer. Every account of the same operator organisation sees them, with author name and date. The SME and the IMBC general director see them. The manufacturer, other operators, and observers do not.
- **OPR-23.** Only the author can delete a note. Notes cannot be edited.
- **OPR-24.** Notes never appear in exports, subscriptions, the pull API, or the company-page PDF.
- **OPR-25.** The operator can send an IMBC request with a subject, a message, and optionally a linked manufacturer. The operator sees their requests with status open or closed and IMBC's reply. This is not an operator request.
- **OPR-26.** There is no chat between an operator and a manufacturer.
- **OPR-27.** On a manufacturer's page, an operator can send an operator request for certain data, by choosing a profile section or writing the ask in free text.
- **OPR-28.** The manufacturer and IMBC are both notified in the platform and by email. The email to the manufacturer goes to every contact. The manufacturer is not told which operator asked.
- **OPR-29.** The manufacturer writes one reply on that request. The operator receives it in the platform and by email. The reply does not change the profile. A further ask is a new operator request.
- **OPR-30.** The SME sees the request, the reply, and whether it is still open (IMBC-18).

### 7.5 Dashboard

- **OPR-31.** The home page for an operator, an observer, and the IMBC general director is a dashboard of visible verified manufacturers. It is an overview: a map, charts, a table, and the indicators in OPR-32.
- **OPR-32.** The dashboard shows the number of manufacturers, a map by region coloured by count, the commodity groups A–E, site surveyed or not, tier, Unified Register registration, and the counts by update status.
- **OPR-33.** Outdated and unresponsive manufacturers stay on the map. In search and in the manufacturer list, unresponsive profiles sort below active and outdated profiles. The update-status counts include all three.
- **OPR-34.** The dashboard has no builder. It does not show average local content, production volume, or a localization threshold.
- **OPR-35.** Choosing a figure or a category on the dashboard opens the manufacturer list with that filter already applied.

### 7.6 Pull API

- **OPR-36.** The platform exposes a read-only REST API that an operator's own system calls. It returns the current data that operator may see on the search and the company page, the same field set for every operator, including a manufacturer that has just become visible. The platform does not call the operator's systems and does not push changes. Changes are announced to operators by the site-survey email (IMBC-05) and by the operator's own use of the API.
- **OPR-37.** The field set does not break during Phase 2. A change to it is announced to operators before it is made. GraphQL is not in Phase 1.
- **OPR-38.** Manufacturers, observers, and callers without an issued operator credential cannot use the API (ADM-07). The API applies the same rights as the operator interface (GEN-08).

## 8. Common functions

### 8.1 Sign-in and sessions

- **AUTH-01.** Registration and invitation use one flow. The person receives an email with a link and sets the password from it. The link is valid for 72 hours. No password is ever sent by email.
- **AUTH-02.** A password has at least 12 characters.
- **AUTH-03.** On the first sign-in from a device, the platform sends a one-time code by email. The device is then remembered for 30 days, after which the code is required again.
- **AUTH-04.** Ten failed sign-ins in a row lock the account for 15 minutes. The account email is notified.
- **AUTH-05.** A session ends after 30 minutes without activity, and in any case 12 hours after sign-in.
- **AUTH-06.** Blocking an account or changing its role ends its open sessions at once.
- **AUTH-07.** An account with no sign-in for three months becomes inactive. The person sets the password again by reset before using it.
- **AUTH-08.** “Forgot password” sends a reset link by email.
- **AUTH-09.** Sign-in goes through an OpenID Connect identity provider, so single sign-on can be added later without changing the rest of the platform. Phase 1 has no single sign-on and no SMS.
- **AUTH-10.** The first time any user signs in, a dialog asks them to accept responsibility for their credentials and actions. They cannot continue until they accept. The platform records who accepted and when. There is no electronic signature, no webcam photograph, and no signature drawn on screen. Users change their own passwords.

### 8.2 Notifications

Each NOT is an email. Where a scenario also names a record in the platform, that record is required too. There is no notification inbox. IMBC emails go to the mailbox the IMBC administrator sets. The quarter clock and the seven days use Asia/Almaty (DATA-08).

- **NOT-18.** One event sends one email to each distinct address. Addresses match without regard to case. When the focal point's address is the account address, that recipient gets one email.
- **NOT-19.** An email to a user uses that user's language, or Kazakh if they have not chosen one. An email to a manufacturer contact uses the manufacturer account's language. The IMBC mailbox is in Kazakh.
- **NOT-20.** A link in an email still requires sign-in and the access rules (GEN-08, GEN-09). Password and reset links last 72 hours (AUTH-01).
- **NOT-21.** Observers receive none of these emails. A chase from IMBC to a manufacturer is a phone call or an email written outside the platform (IMBC-18). The platform does not send that chase.
- **NOT-22.** A trial import sends none of these emails (MIG-11).

| ID | Event | Recipient |
|---|---|---|
| NOT-01 | Password link: registration, invitation, or reset | As NOT-23 to NOT-26 |
| NOT-02 | One-time sign-in code | The person |
| NOT-03 | Account locked for 15 minutes | The account email |
| NOT-04 | Profile submitted for review | IMBC |
| NOT-05 | Review result | Manufacturer account email and focal point |
| NOT-06 | Certificate reaches 60, 30, or 7 days before expiry, or expires today | Manufacturer account email and IMBC |
| NOT-07 | IMBC request received | IMBC |
| NOT-08 | Reply to an IMBC request | The operator user who sent it |
| NOT-09 | Export subscription file ready, with a link | The subscribing operator |
| NOT-10 | Manufacturer unlocked a profile that was in review | The assigned SME, or IMBC if none is assigned |
| NOT-11 | Profile becomes site surveyed | Operator accounts that are not blocked, with a link to the company page |
| NOT-12 | Quarterly request to confirm the profile | Manufacturer account email and focal point |
| NOT-13 | Operator request sent | Every contact of the manufacturer, and IMBC |
| NOT-14 | Reply to an operator request | The operator user who sent it |
| NOT-15 | Second missed quarter: seven days to confirm, or the profile becomes unresponsive and sorts lower | Manufacturer account email and focal point |
| NOT-16 | Profile is unresponsive and sorts lower in search | Manufacturer account email and focal point |
| NOT-17 | Subscriptions will pause in fourteen days | The operator user who has a subscription |

#### Sign-in, invitation, and migration

- **NOT-23.** Self-registration sends NOT-01 to the company email only. Contacts are not emailed. The email contains a link and no password. Setting the password creates the Draft profile (MAN-03) and sends no further email.
- **NOT-24.** An invitation of an IMBC user, an operator, or an observer sends NOT-01 to that person's own email (ADM-01).
- **NOT-25.** “Invite all migrated manufacturers” sends NOT-01 to the company email and to every distinct contact email (MIG-15). The email asks them to sign in and check the profile within five working days. When those five days pass, no further email is sent and the status does not change. A profile with no usable email is named in the report and is not emailed.
- **NOT-26.** NOT-02 is sent only when a sign-in requires a code (AUTH-03). A remembered device does not send it. NOT-03 is sent once when the lock starts (AUTH-04), not on each failed attempt. A forgotten password and an account reaching three months without sign-in (AUTH-07) each send NOT-01 as a reset link. Neither changes update status. Fourteen days before that three-month point, a user who has a subscription that is not paused receives NOT-17. Signing in before the three months sends no pause. When the account becomes inactive, its subscriptions pause and no further email is sent about the pause.

#### Review

- **NOT-27.** Sending a Draft or Returned profile for review, or sending it again after an unlock, sends NOT-04 to IMBC. Assigning a profile, taking it, and opening it so that it becomes Under review send no email. Verification does not email operators or observers. NOT-05 on this path says the profile is verified, or returned, and includes each rejection comment. It does not repeat sections that stayed verified. One submission produces one NOT-05, not one email per section or file.
- **NOT-28.** A decision on pending changes also sends NOT-05. The email names each accepted section and each rejected section with its comment. It does not say the profile was returned. The profile stays Verified. Operators are not emailed. Until an accepted change replaces a value, they keep seeing the last verified value (REV-08).
- **NOT-29.** Unlocking a Submitted or Under review profile sends NOT-10 once. The assigned SME receives it. If nobody is assigned, the IMBC mailbox receives it. The manufacturer and the operators are not emailed. Decisions already made on sections the manufacturer leaves untouched are kept. The next submission sends NOT-04 again, not another NOT-10.

#### Certificates

- **NOT-30.** NOT-06 follows a certificate that has an expiry date, including an optional certificate and a certificate on a profile operators cannot open. A certificate with no expiry date never sends NOT-06. Certificates that reach a threshold on the same day are listed in one email per recipient, not one email each. Replacing the file or the expiry date starts the schedule again from the new date. A certificate that is already expired when it is saved is shown as expired (REV-10) and does not send the earlier reminders, and it does not send a late copy of the on-the-day email. Operators are not recipients. Update status becoming unresponsive does not stop NOT-06. A profile with no company email still sends NOT-06 to IMBC.

#### Update status

- **NOT-31.** The quarter belongs to the profile. It is three calendar months from that profile's own date, on the same day of the month, or on the last day of that month when that day does not exist. The date starts as the day the profile was created. It moves to the day the manufacturer confirms, and to the day an SME accepts a change to the verified profile. It is not one calendar date for every profile. Signing in does not move it. Saving a section, sending changes for review, and accepting the NDA do not count as the confirmation.

  No update-status email is sent while the profile is Draft, Submitted, Under review, or Returned. The first email waits until the profile is Verified. If a quarter date has already passed, the email is due then.

  The platform sends at most 50 of NOT-12, NOT-15, and NOT-16 on one day. A notice that is due goes on the first day that still has room, soonest due first. The seven days below start on the day the notice is sent.

  On a quarter date, if the status is active, the platform sends NOT-12 and does not change the status that day. NOT-12 asks the manufacturer to confirm, and says that seven days without a confirmation set the status to outdated. A confirmation in those seven days keeps the status active and starts the quarter again. If the seven days end without a confirmation, the status becomes outdated (UPD-03). The profile stays visible. Becoming outdated sends no further email.

  On the next quarter date, if the status is outdated, the platform sends NOT-15 and does not also send NOT-12. NOT-15 says that seven days without a confirmation set the status to unresponsive and move the profile below the others in search. A confirmation in those seven days sets the status to active and starts the quarter again. That confirmation is one action, not a pass through every section. If the seven days end without a confirmation, the status becomes unresponsive, NOT-16 is sent, and the profile stays visible and sorts below active and outdated profiles (UPD-04). NOT-16 says that the profile is unresponsive and appears lower in search. It does not say that operators no longer see it.

  Coming back from unresponsive is UPD-05. The manufacturer confirms each section, one by one. Only the last of those confirmations sets the status to active and starts the quarter again. The confirmations are audited. They are not emails. Once the status is unresponsive, NOT-12 and NOT-15 stop until that confirmation is done.

  Three months without sign-in (AUTH-07) does not move this clock, does not change update status, and does not stop NOT-12, NOT-15, or NOT-16. The manufacturer still resets the password before they can confirm. Passing a quarter does not remove Verified.

#### Requests

- **NOT-32.** An operator request sends NOT-13 and appears on the request for the sending user, the manufacturer, and the SME and the IMBC general director (OPR-28, IMBC-18). The copy to the manufacturer goes to every distinct contact email. It says that an operator asked, repeats the section or the free text, and does not name the operator's user, organisation, or account. The copy to IMBC names the operator organisation and the sending user. A further request, including one sent before the first has a reply, is a new request and sends NOT-13 again.

  The manufacturer's one reply sends NOT-14 to the sending operator user only. The SME sees the reply on the request and is not emailed. The reply names the manufacturer, does not change the profile, and does not send NOT-04. An open request that waits sends no reminder email. A profile the operator cannot open cannot be the subject of a request. An unresponsive profile can, because it stays visible (UPD-04).
- **NOT-33.** An IMBC request sends NOT-07 and appears in the SME's list. It does not email the manufacturer, including when a manufacturer is linked. The SME's reply sends NOT-08 to the sending operator user only. Closing the request with no reply sends no email. This is not NOT-13 or NOT-14.

#### Site survey and subscriptions

- **NOT-34.** NOT-11 is sent when a profile that operators can already open becomes site surveyed (IMBC-02). Each email links to that company page. A result of no, a record with no signed file, a file whose expiry date is not in the future, and a migrated visit that still has no file do not send NOT-11. Recording a survey on a profile operators cannot open does not send it. If that profile later becomes visible and is still site surveyed, NOT-11 is sent then, once. Another survey while the profile is already site surveyed does not send it again. The mark ending because the expiry date passed does not send an email. Becoming site surveyed again after that does send NOT-11. Verification by itself, with no site survey, sends nothing to operators. The manufacturer and IMBC are not recipients of NOT-11.
- **NOT-35.** A subscription run that builds a file sends NOT-09 to that user only. The link opens the file after sign-in, and the file is not attached. A failed run sends no email and is listed on the subscription (OPR-17). Pausing, resuming, or deleting a subscription sends no email. Several subscriptions produce one NOT-09 for each file. NOT-17 is the warning in NOT-26 and is not combined with NOT-09.

### 8.3 Languages

- **LANG-01.** The interface is available in Kazakh, English, and Russian. Kazakh is the default. The user switches language at any time, and the choice is remembered.
- **LANG-02.** Every interface string and email text lives in language files, not in code. English is the source file.
- **LANG-03.** Before UAT the vendor delivers the Kazakh and Russian files, machine-translated from English. IMBC proofreads them and owns the wording.
- **LANG-04.** Dates and numbers follow the selected language.
- **LANG-05.** Data entered by users is not translated.

### 8.4 Audit

- **AUD-01.** Every action is written to the audit log with user, organisation, time, object, and what changed. This includes sign-in, sign-out, refused requests, status changes, decisions, NDA acceptances, exports, and downloads.
- **AUD-02.** No user can change or delete audit entries. Entries are kept for 5 years.
- **AUD-03.** The IMBC general director views the whole audit log and filters it by user, organisation, object, action, and date. The IMBC administrator views account events only.
- **AUD-04.** The platform keeps an activity snapshot every week and every month: manufacturers by profile status, update status, region, and commodity group, and new registrations. It also records which manufacturer pages each operator opens. Contracts between operators and manufacturers are not recorded.

## 9. Data

### 9.1 Main records

| Record | Holds |
|---|---|
| Organisation | Type (manufacturer, operator, observer, IMBC), name, major-operator mark |
| User account | Organisation, email, name, role, state (invited, active, inactive, blocked), last sign-in |
| Manufacturer profile | Sections of section 5.2, status, update status, tier (derived, IMBC-19 to IMBC-21), assigned SME, how the manufacturer heard about IMBC |
| Section revision | Verified values and pending values of each section, with decisions and comments |
| Contact, shareholder, product line, equipment item | Rows of their sections. A product line read from e-Ondiris also holds the registry entry number, ENSTRU code and name, KPVED name, the producer’s registry contacts and place, the inclusion date, and the active mark (MAN-25). One contact is the focal point |
| Certificate, document | Type, details, status, file versions, malware-scan state |
| Site survey record | As IMBC-01 |
| AGAR or CDP record | Product line, kind (AGAR or CDP), status (IMBC-24), report file, comment |
| Due-diligence record | Date, result (green, amber, or red), comment, report, and each IMBC-10 check with its group, subject, Adata's value, and mark (clear, finding, shown only, or no answer) |
| External check | Connector, request, result, status, source, time; a mock result is marked as test data |
| IMBC note | Text, author, date; legacy fields |
| Works-with mark | Operator organisation, manufacturer, state (waiting, validated, rejected), history |
| Operator visit mark | Operator organisation, manufacturer, date, file, IMBC decision |
| Operator note | Operator organisation, author, manufacturer, text, date |
| IMBC request | Sender, subject, message, manufacturer, status, reply |
| Operator request | Operator organisation, manufacturer, section or free text, one reply, open or closed |
| API access | Operator organisation, issued or revoked |
| Responsibility acceptance | User, time |
| Activity snapshot | Week or month, the counts in AUD-04 |
| Export subscription and file | Owner, filters, format, period, files of the last 90 days |
| NDA version and acceptance | Text, version; profile, time, IP address |
| Forecast version and line | Columns of FC-05; import report; published or not |
| Technical requirements file | Commodity group, product, kind (STR or KTRE), file. Opened from the technical-requirements section, not from a forecast line |
| Reference lists | As ADM-08 |
| Audit entry | As AUD-01 |

- **DATA-01.** Every record has a UUID key. Every change keeps its history: who, when, and the earlier value. A submitted or verified revision is never overwritten.
- **DATA-02.** Multi-value fields, such as OKED codes or certificates, are stored as separate rows, never as one delimited text.
- **DATA-03.** BIN, OKED, TN VED, KPVED, and ENSTRU are stored as text, so leading zeros are never lost.
- **DATA-04.** A reference-list value in use cannot be deleted. It can be retired, which hides it from new entries.
- **DATA-05.** A file is stored apart from its record. The record keeps the original name, size, type, checksum, and upload time.
- **DATA-06.** Uploaded files are PDF, JPG, PNG, DOCX, or XLSX, up to 25 MB each. The file type is checked from its content, not only its name.
- **DATA-07.** Every uploaded file is scanned for malware. Until the scan passes, nobody can open, download, verify, or publish it.
- **DATA-08.** Dates, expiry, and schedules use Asia/Almaty time.

### 9.2 Standard export columns

- **DATA-09.** Search exports and subscriptions share one layout, with one row per product line, as in IMBC's Excel base:
  - **Company:** BIN, name in English, name in Russian, region, address, website, company email, company phone.
  - **Focal point:** name, position, email, phone.
  - **Activity and product:** OKED codes, commodity group, commodity type, product name, TN VED, KPVED, production capacity.
  - **Production:** number of workshops, utilisation.
  - **Personnel:** total headcount.
  - **Checks:** certificate types with expiry dates, site surveyed with the last visit date, tier, Unified Register registration, works with operators (count out of three), verification date, due-diligence check date, pending-changes flag.
- **DATA-10.** CSV files use UTF-8 with a byte-order mark, a semicolon separator, quoting by RFC 4180, a header row, and ISO 8601 dates. Several values in one field are separated by a vertical bar ( | ).
- **DATA-11.** In XLSX files, BIN and codes are text cells and dates are date cells. An extra sheet states the file contract version, the time the data was taken, the number of rows, and the filters used.
- **DATA-12.** Cell values that start with =, +, −, or @ are escaped so a spreadsheet never runs them as formulas.
- **DATA-13.** Exports and the pull API never contain IMBC notes, the due-diligence result, findings, or report, external check details, operator names, operator notes, pending values, or the answer to “How did you hear about us?”.
- **DATA-14.** The pull API returns every field the operator's company page shows (OPR-09, OPR-10). That set is wider than the export columns in DATA-09. It includes the e-Ondiris fields in MAN-25, in-country value share, localization level, the registration date, the update status, and whether enhanced due diligence was done.

## 10. Migration

The source is IMBC's current Excel base of manufacturers, provided before development starts. IMBC's presentation counts about 982 rows and 816 unique BINs.

- **MIG-01.** Before import, the vendor maps every Excel column to a platform field and IMBC approves the mapping.
- **MIG-02.** Each BIN becomes one profile. Each Excel row becomes a product line on that profile.
- **MIG-03.** Values are normalised to reference lists: regions, commodity types, KPVED codes split from one cell, phone formats. Values that cannot be mapped are kept as they were and flagged for IMBC.
- **MIG-04.** Rows marked “OUT OF” or “N/A” are migrated and flagged, never dropped.
- **MIG-05.** Possible duplicates by BIN, name, or registration number are flagged for IMBC. Nothing is merged automatically. A BIN that fails the check digit is flagged, not rejected.
- **MIG-06.** Excel “Supply to Operators” values for NCOC, TCO, and KPO become validated "works-with" marks. Other names in that column go to IMBC notes.
- **MIG-07.** Unified Register columns fill the Unified Register fields (MAN-12).
- **MIG-08.** Excel site visit columns become site survey records without a file. A profile is not site surveyed until the signed report is attached (IMBC-02). When that file is matched (MIG-14) and the workbook says the visit happened, the profile is site surveyed and tier 2, with no expiry date until IMBC sets one.
- **MIG-09.** Each internal column of the manufacturers workbook is its own legacy field, kept with the IMBC notes. Yellow columns are included. Dropping one later is deleting that column. The columns are: expression-of-interest email sent, confirmation of receipt, source, response to the expression of interest, summary of that response, ready for site visit, overall ranking, shortlisted for CDP / AGAR, LC/LPS, priority commodity, year added, CDP / AGAR status, CDP / AGAR execution, general comments, the folder link, and the e-Ondiris note. LC/LPS is not a workflow. A finished CDP or AGAR in the workbook becomes a record on the product line the approved mapping names (IMBC-23). When the workbook does not name the product, those columns stay on the note until IMBC names it. Site-visit conducted and its dates are survey records (MIG-08), not these fields.
- **MIG-10.** Every migrated profile starts as Draft and is hidden from operators until the manufacturer completes it, submits it, and IMBC verifies it. IMBC does not submit on the manufacturer's behalf.
- **MIG-11.** The vendor runs trial imports. A trial import can be repeated without creating duplicates, and sends no emails.
- **MIG-12.** Each import produces a log with the result of every Excel row: imported, flagged, or rejected with the reason.
- **MIG-13.** The migration report lists missing fields, format problems, duplicates, conflicts, and recommended corrections.
- **MIG-14.** The existing site-survey PDFs, about 320, are migrated with the profiles. Metadata comes from the Excel base. A file is matched to a profile by the BIN it contains. Files the match cannot place are attached by hand. This needs read access to IMBC's SharePoint.
- **MIG-15.** The invitation asks every contact to sign in and check the profile within five working days (NOT-25). If they do not, the profile stays Draft and hidden. No second email is sent. The profile is not deactivated, and update status does not start until it is verified.

## 11. Technical and non-functional requirements

### 11.1 Architecture

The architecture document (v0.3 or later) describes the design. Its main choices, within the SoW, are:

| Part | Choice |
|---|---|
| Frontend | React with TypeScript, a single-page app built with Vite; responsive, designed for desktop first |
| Backend | Modular service in Node.js (NestJS) with a separate background worker; REST API described in OpenAPI 3.1 |
| Database | PostgreSQL, which also holds sessions and the job queue |
| Search | PostgreSQL full-text search for Russian and English, with Kazakh support after a proof of concept, and trigram matching on names |
| Cache | Valkey, for cache only |
| Files | S3-compatible object storage, product chosen with IMBC IT |
| Identity | Keycloak or IMBC's own OpenID Connect provider |
| Deployment | Docker containers on Kubernetes on IMBC's premises, delivered through GitLab CI/CD and Argo CD |
| Secrets | Vault or OpenBao |
| Monitoring | Prometheus, Grafana, Loki, Grafana Alloy, OpenTelemetry |

- **NFR-01.** The platform uses open-source components with standard practices, so another team can maintain it. Source code, documentation, and all rights belong to IMBC.
- **NFR-02.** The architecture allows later functions to be added without rebuilding the core, including the remaining real connectors, single sign-on, SFTP delivery, a site survey filled on a tablet, an AI assistant, and a document-management module.

### 11.2 Hosting and operation

- **NFR-03.** The platform is designed for 99.5 % availability per calendar month, excluding agreed maintenance windows, with redundancy, synthetic checks of the critical operations, and a restore drill.
- **NFR-04.** Achieving that availability is the duty of whoever operates the platform. IMBC chooses the operating model before production: IMBC IT operates it, the vendor operates it under a separate support contract, or a managed provider with a data centre in Kazakhstan hosts it. The vendor commits to availability only under a support contract.
- **NFR-05.** The vendor delivers the deployment, backup and restore procedures, monitoring, and runbooks, and shows a restore from backup at acceptance.
- **NFR-06.** Database schema changes are applied without downtime.

### 11.3 Performance

- **NFR-07.** For 95 % of requests, sign-in responds within 2 seconds, search within 1 second, and the company page within 1.5 seconds, and a 25 MB upload completes within 30 seconds. This holds at up to 2,000 manufacturers and 200 concurrent users, measured on the acceptance environment.

### 11.4 Security

- **NFR-08.** All traffic uses HTTPS. Passwords are handled only by the identity provider.
- **NFR-09.** Files are never publicly reachable. Every upload and download passes the rights check (GEN-09).
- **NFR-10.** Secrets are kept in the secrets manager, out of the source code and the logs.
- **NFR-11.** The vendor builds to the OWASP ASVS 5.0 Level 2 checklist. An external penetration test takes place only if IMBC orders it.

### 11.5 Quality

- **NFR-12.** The vendor delivers automated unit, integration, and end-to-end tests. The access rules (section 4) have tests for both allowed and refused requests.
- **NFR-13.** The platform works in the current versions of Chrome, Edge, Firefox, and Safari.
- **NFR-14.** On phones the platform supports viewing and statuses. Editing documents is for desktop.
- **NFR-15.** The interface is minimal and professional, in blue, white, and black, built from a component library adapted to IMBC's colours, with the IMBC logo IMBC supplies. It must not look like a state portal. Visual emphasis goes to the operator dashboard and to profile completeness. The layout is desktop-first and responsive. A redraw of the logo is out of scope.

## 12. Acceptance

- **ACC-01.** Acceptance is against the numbered requirements of this specification. Each is checked by test, demonstration, or review.
- **ACC-02.** UAT covers the scenarios of each role: manufacturer, SME, IMBC administrator, IMBC general director, operator, and observer. IMBC may invite operators to take part.
- **ACC-03.** Migration is accepted when 100 % of Excel rows are accounted for, each as a profile, a product line, or a logged rejection with its reason. Accuracy is accepted when, in a random sample of at least 200 records, fewer than 5 % of the checked fields differ from Excel.
- **ACC-04.** Performance is accepted when NFR-07 is met.
- **ACC-05.** Acceptance terms, defect classes, warranty, and support are set by the contract.

## 13. Delivery and deliverables

Phase 1 is delivered in two releases and accepted as a whole:

- **Release 1:** sections 3 to 6, including Adata, e-Ondiris, and update status; the operator and observer search, company page, dashboard, export, pull API, marks, notes, and requests of section 7; sections 8 to 10.
- **Release 2:** the demand forecast, STR, and KTRE (section 5.4, ADM-10, ADM-12 to ADM-15), and export subscriptions (OPR-15 to OPR-18).

| Deliverable | Content |
|---|---|
| Platform | The functions of sections 5–8, deployed on the acceptance environment |
| Source code | Application, build configuration, schema migrations, automated tests |
| Data model | Schema and data dictionary, approved by IMBC before migration |
| API description | OpenAPI 3.1, including the operator pull API (OPR-36) |
| Deployment | Kubernetes manifests, pipelines, backup and restore, monitoring, runbooks |
| Migration | Column mapping, import logs, migration report |
| Language files | English, Kazakh, Russian (LANG-03) |
| User guides | For manufacturers, SMEs, IMBC administrators, the IMBC general director, operators, and observers |
| Test results | Automated test reports and UAT records |

## 14. Out of scope

These are not part of Phase 1. Unless marked dropped, each goes to the Phase 2 specification. Where the architecture already holds a foundation for an item, it says so.

| Item | Why |
|---|---|
| Real connectors other than Adata and e-Ondiris, including an accounting service and the legal-entity registry | No provider is contracted. Those connectors ship as mocks (EXT-02). Tax returns and penalties from those services stay out. The Adata checks in IMBC-10 stay in. |
| Export delivery by SFTP, or by email to anyone other than the subscribing user | Each operator user subscribes only themselves; the email carries a link. |
| Pushing changes into operators' systems, direct database access, or GraphQL | Operators pull the current register through the REST API. A push needs an endpoint on the operator's side. |
| Choice of columns per export | One standard column set keeps exports comparable. The pull API returns the wider company-page set (DATA-14). |
| IMBC administrator setting up exports for operators | Operators subscribe themselves. |
| Single sign-on for IMBC staff and operators | Email and password keep password resets under IMBC's control. The identity provider is ready for it. |
| SMS confirmation and SMS codes | Email only; SMS needs a paid gateway. |
| Proving at registration that the applicant may act for the BIN | Adata and e-Ondiris do not establish that. IMBC checks it by calling the contacts. |
| Documents uploaded at registration | Registration only creates the account; documents are completed in the profile. |
| A dashboard builder, BI integration, average local content, production volume, or a localization threshold | The dashboard indicators are fixed (OPR-32). |
| Demand forecast for operators and observers | The forecast is published for manufacturers only. Dropped. |
| A consolidated forecast page | The consolidated forecast stays on IMBC's website, in groups A–E (FC-10). |
| Downloading the demand forecast | View, search, and filter only. Dropped. |
| Downloading or printing STR or KTRE | The PDF opens in the technical-requirements section. Zoom and scroll only. It is not opened from a forecast line. Dropped. |
| Parsing STR or KTRE into fields | The PDFs stay files (FC-08). |
| Hiding a profile because its update status is unresponsive | Phase 1 keeps it in search and on the map, and sorts it below the others (UPD-04). |
| FPAL codes | IMBC holds no licence. Lines are keyed by TN VED. Dropped. |
| Forecast or technical requirements limited to a manufacturer's own products | Every verified manufacturer sees the whole published forecast and the whole technical-requirements section (FC-09). |
| Automated intake of operators' demand files | IMBC prepares the file; only the import is built. |
| Chat between an operator and a manufacturer, or more than one reply on an operator request | One request has one reply (OPR-29). A further ask is a new request. |
| An AI assistant, and a written record of its requirements | Not in Phase 1. IMBC will say where an assistant is needed once there is an interface to try. |
| Site survey filled in on a tablet or as an in-platform checklist | The survey stays a signed file with a yes or no result. |
| Partial site survey result | Dropped. |
| Sending an AGAR or CDP recommendation to operators through the platform | Phase 1 keeps the record and the statuses (IMBC-23, IMBC-26). The recommendation is not sent. |
| An AGAR questionnaire | The SME decides the work. There is no questionnaire builder (IMBC-23). |
| An automatic one-year or two-year site-survey term | The recorder sets an expiry date when there is one (IMBC-02). |
| Automatic assignment of reviews | No rules exist for it. |
| Named saved filters with alerts on new matches | Links keep filters; subscriptions cover recurring results. |
| Editing the access rules in the interface | Rules change only with a release, so no single role can widen its own access. |
| Equipment year and location | The equipment row keeps name, type, quantity, and links to product lines. |
| Company page as Word or Excel | The page downloads as one PDF. |
| Several accounts per manufacturer | Dropped. |
| Electronic signature, a webcam photograph, or a signature drawn at sign-in | Responsibility is accepted in a dialog (AUTH-10). Dropped. |
| Redrawing the IMBC logo | The interface uses the logo IMBC supplies. |
| AGSK-3, NTIN, the product barcode, the registry comment, and the data source from e-Ondiris | IMBC's field reference of 5 November 2026 leaves these off the platform (MAN-25). ENSTRU is shown. |
| Process video from manufacturers | Dropped. |
| Numeric ratings or scoring of manufacturers | Dropped for Phase 1. |
| Tenders and procurement | IMBC's work ends at pre-qualification. Dropped. |

## 15. Deviations from the Scope of Work

Each row changes the SoW clause named. Signing this specification approves the change.

| SoW    | SoW says                                                                                                            | Phase 1 does                                                                                                                         | Accepted against                           |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
|        |                                                                                                                     |                                                                                                                                      |                                            |
| §3.9   | Operators define fields, filters, format, and delivery by secure email or SFTP; data pulled into operators' systems | File exports use the standard columns and an email link, with no SFTP. A separate read-only REST API returns the company-page fields | OPR-14 to OPR-18, OPR-36, DATA-09, DATA-14 |
| §3.10  | Forecast for manufacturers with approved profiles after accepting the NDA                                           | Accepted by a tick at registration. The whole forecast is shown for search and filter, and cannot be downloaded or printed. STR and KTRE open in their own section and cannot be downloaded or printed | FC-01 to FC-09, ADM-15                     |
| §4     | Availability of at least 99.5 %                                                                                     | The platform is designed for 99.5 %; achieving it rests with whoever operates the platform                                           | NFR-03, NFR-04                             |
| §4, §6 | SSO (OAuth2 / SAML) for internal stakeholders                                                                       | OpenID Connect provider ready for single sign-on; no single sign-on in Phase 1                                                       | AUTH-09                                    |
| §4     | Backend in NestJS or .NET 8                                                                                         | NestJS                                                                                                                               | Section 11.1                               |
| §4     | Object storage, e.g. MinIO                                                                                          | S3-compatible storage chosen with IMBC IT; MinIO Community is no longer maintained                                                   | Section 11.1                               |
|        |                                                                                                                     |                                                                                                                                      |                                            |

## 16. Sign-off

By signing, both parties agree that this specification defines Phase 1, that it replaces SoW sections 3 and 6 where they differ as listed in section 15, and that changes after signing follow the change-control procedure of SoW §9.

| | IMBC | Smart Call IT |
|---|---|---|
| Name | | |
| Position | | |
| Signature | | |
| Date | | |
