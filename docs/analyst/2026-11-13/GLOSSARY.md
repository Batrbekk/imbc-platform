# IMBC platform

The platform IMBC uses to keep a verified register of Kazakhstani manufacturers and a register of localization proposals for oil and gas operators.

## Parties

**IMBC**:
International Machine Building Center. The association that keeps this register.
_Avoid_: IMB Center, the Center

**Smart Call**:
The vendor building this platform for IMBC.
_Avoid_: SmartCom, supplier

**Manufacturer**:
A citizen of Kazakhstan, or a legal entity established under Kazakh law, that produces goods of local origin.
_Avoid_: supplier, vendor, factory

**LPS company**:
A foreign company, or its local venture or partnership, whose product or service is proposed for localization in Kazakhstan or is already being localized there.
_Avoid_: manufacturer, applicant account

**IMBC member**:
An organisation that participates in IMBC. Known members include NCOC, TCO, KPO, KKO, Silleno, and KMG PetroChem. The list is not closed.
_Avoid_: operator

**Operator**:
An oil, gas, or petrochemical company admitted to the register in the operator role. The major operators are NCOC, TCO, and KPO, and each of them is also an IMBC member.
_Avoid_: observer, IMBC member

**NCOC**:
North Caspian Operating Company N.V., a major operator.

**TCO**:
Tengizchevroil LLP, a major operator.

**KPO**:
Karachaganak Petroleum Operating B.V., a major operator.

**KKO**:
Kalamkas-Khazar Operating LLP, an IMBC member.
_Avoid_: operator

**Silleno**:
Silleno LLP, an IMBC member.
_Avoid_: operator

**KMG PetroChem**:
KMG PetroChem LLP, an IMBC member.
_Avoid_: operator

**Observer**:
An organisation with read-only access to the register, such as the Ministry of Energy, an EPC company, or a development institution.
_Avoid_: operator, IMBC member, spectator

**EPC**:
An engineering, procurement, and construction company.
_Avoid_: observer, operator

**SME**:
An IMBC subject-matter expert. The IMBC role concerned with whether a manufacturer's data and documents are acceptable.
_Avoid_: Expert, technical specialist

**IMBC administrator**:
The IMBC role concerned with accounts, reference data, and publishing. It does not see manufacturers' data.
_Avoid_: Administrator, superuser, root

**IMBC general director**:
The IMBC role that reads all data and changes none. The short form is IMBC GD. This is not the head of a manufacturer.
_Avoid_: Director, administrator, superuser

## Records

**Register**:
IMBC's catalogue of manufacturer profiles.
_Avoid_: Unified Register, state register

**Manufacturer profile**:
The dossier of one manufacturer organisation. Its identity is the BIN.
_Avoid_: account, contact

**Manufacturer account**:
The one account of a manufacturer organisation, signed in with a company mailbox rather than a person's address.
_Avoid_: contact, focal point, several accounts

**Migrated profile**:
A manufacturer profile created from IMBC's Excel base rather than by registration.
_Avoid_: legacy record, imported company

**Verified**:
The state of a manufacturer profile whose data IMBC has checked and accepted. Only verified profiles are visible to operators.
_Avoid_: site surveyed, approved, in the register

**Pending changes**:
Edits to a verified profile that IMBC has not yet checked. Operators see the last verified values with a mark that changes are pending.
_Avoid_: draft, unverified profile

**Update status**:
Whether a verified manufacturer keeps confirming its data each quarter: *active*, *outdated* after one missed quarter, or *unresponsive* after two. An unresponsive profile stays visible and sorts below the others. It is not deleted.
_Avoid_: verified, inactive, inactive account, blacklisted

**Operator request**:
An operator's ask for certain data on a manufacturer. The manufacturer is not told which operator asked, and answers on the same request. IMBC is told as well.
_Avoid_: chat, operator note, IMBC request

**IMBC request**:
An operator's message to IMBC staff about the platform or a manufacturer.
_Avoid_: operator request, chat

**Works with**:
An operator's mark that it already works with a manufacturer, confirmed by IMBC. Other operators see only how many of the three major operators have it.
_Avoid_: supplied to operators, approved supplier

**Contact**:
A person named on a manufacturer profile, in a management, technical, or commercial role. A profile has at least three contacts, and a contact is not an account.
_Avoid_: account, focal point

**Focal point**:
The one contact through whom IMBC and operators deal with a manufacturer first.
_Avoid_: account, director, primary contact

**Product line**:
One kind of goods a manufacturer makes, classified by a TN VED code. Different product lines can share that code.
_Avoid_: product, commodity, item

**Commodity group**:
One of IMBC's classes A–E used to classify manufacturers' product lines.
_Avoid_: forecast commodity, FPAL code, product class

**Commodity type**:
A finer class under a commodity group, taken from IMBC's list.
_Avoid_: forecast subcommodity, product line, TN VED

**Forecast commodity**:
A category in IMBC's detailed demand forecast. Its correspondence to a manufacturer commodity group is established by IMBC.
_Avoid_: commodity group, FPAL code

**Forecast subcommodity**:
A finer category under a forecast commodity. Its correspondence to a manufacturer commodity type is established by IMBC.
_Avoid_: commodity type, product line

**Production capacity**:
How much of one product line a manufacturer can make in a year, given as a number and a unit.
_Avoid_: operational capacity, output, volume

**Production site**:
A place where a manufacturer makes its goods, with its own production address, region, and city or settlement. A manufacturer can have several sites, and several product lines can use the same site.
_Avoid_: legal address, company headquarters

**Utilisation**:
The share of a manufacturer's production that is in use, recorded on the profile as a percent.
_Avoid_: load, occupancy

**Profile completeness**:
The share of a manufacturer profile's mandatory fields and files that are filled.
_Avoid_: progress, fill rate

**BIN**:
The business identification number of a Kazakhstani organisation. In this register, one BIN is one manufacturer profile.
_Avoid_: PIN, INN, TIN

**Demand forecast**:
IMBC's statement of expected purchases, with no operator named on it, for manufacturers only. The consolidated forecast is public on IMBC's website; the detailed forecast, line by line, is on the platform behind the NDA.
_Avoid_: procurement plan, tender, budget

**Summarized technical requirements (STR)**:
IMBC's own text for one product, written from the operators' requirements with the operator, the project, and the brand taken out. The manufacturer reads it on the platform.
_Avoid_: key technical requirements, operator specification, technical specification

**Key technical requirements excerpts (KTRE)**:
The short form of the summarized technical requirements for the same product.
_Avoid_: key technical requirements, operator specification

**FPAL code**:
A commodity code from the FPAL supplier database. The register does not use it; forecast lines use TN VED classification.
_Avoid_: Achilles code

**Activity snapshot**:
A saved record of the register's key counts at one moment, kept so IMBC can report how the register changes.
_Avoid_: dashboard, analytics

**Operator note**:
An operator's own remark on a manufacturer, shared within that operator organisation and with IMBC.
_Avoid_: IMBC note, comment, operator request

**Export subscription**:
An operator user's standing request to receive the results of one saved search by email, at a period they choose.
_Avoid_: newsletter, scheduled delivery, automated export

**NDA**:
The non-disclosure agreement a manufacturer accepts when it creates its account. It covers the detailed demand forecast and the technical requirements.
_Avoid_: forecast access, signed agreement

**Inactive account**:
A manufacturer account with no sign-in for three months. It concerns signing in, not whether the data is current.
_Avoid_: deleted account, blocked account, inactive profile

## Assessments

**Site survey report**:
IMBC's signed record of a visit to a manufacturer's site: a technical readiness assessment.
_Avoid_: audit, MSQ

**Mandatory certificate**:
A certificate type whose presence or absence a manufacturer must declare: ISO 9001, ISO 14001, and ISO 45001.
_Avoid_: required document, key certificate

**Company certificate**:
A certificate concerning the manufacturer as an organisation, including its management systems.
_Avoid_: product certificate, personnel certificate

**Product certificate**:
A certificate concerning the conformity of goods a manufacturer makes. One certificate may cover several product lines.
_Avoid_: company certificate, mandatory certificate

**Others**:
The category for personnel certificates and other certificates outside the company and product groups.
_Avoid_: other documents, optional documents

**Site surveyed**:
The mark that IMBC has visited a manufacturer's site and holds a signed site survey report.
_Avoid_: verified

**MSQ**:
Market survey questionnaire. IMBC's questionnaire on a manufacturer's market and capability.
_Avoid_: site survey report

**CT-KZ**:
A certificate of origin for goods produced in Kazakhstan.
_Avoid_: Unified Register of Kazakhstani Manufacturers

**Unified Register of Kazakhstani Manufacturers**:
The state register, under the Ministry of Industry and Construction, that replaces CT-KZ from 1 January 2026. Its data is published through e-Ondiris.
_Avoid_: register, CT-KZ

**e-Ondiris**:
The state system that publishes the Unified Register; the platform prefills product lines from it by BIN.
_Avoid_: e-Öndiris, Ondiris

**e-Ondiris extract**:
The official document listing a manufacturer's products included in the Unified Register. It supports the registered in-country value share of those products.
_Avoid_: product certificate, CT-KZ

**In-country value share**:
The percentage of a product's value created in Kazakhstan, as e-Ondiris records it (ДВЦ).
_Avoid_: local content, localization level

**ENSTRU**:
The unified nomenclature of goods, works, and services (ЕНС ТРУ). The procurement code for one item, shown with its name on an e-Ondiris product line. The first six digits follow KPVED.
_Avoid_: KPVED, TN VED, NTIN, AGSK-3

**AGSK-3**:
The architecture, urban-planning, and construction catalogue of building structures, products, and materials. A code and a name on an e-Ondiris product line, used when a construction specification names that material.
_Avoid_: ENSTRU, KPVED, NTIN

**NTIN**:
The national trade item number. A 13-digit code, beginning with 02, that the National Catalogue of Goods assigns to one product. e-Ondiris may leave it empty.
_Avoid_: GTIN, XTIN, ENSTRU, product code

**Due diligence**:
The check of a manufacturer's legal and financial standing: automatic through Adata, plus any enhanced due diligence. An IMBC employee may change its result.
_Avoid_: expert verification, screening service

**Due diligence result**:
Green when no check is critical or needs attention, amber when a check needs attention and none is critical, and red when a check is critical.
_Avoid_: pass rate, no issues, findings, 98 percent

**Adata**:
The Kazakhstani company-data service the platform queries by BIN.
_Avoid_: registry, due diligence

**Enhanced due diligence**:
Manual checks by IMBC beyond Adata, such as political exposure or affiliations, recorded with a report.
_Avoid_: EDD, deep analysis, site survey

**Local content**:
Kazakhstani origin in the goods and work the operators buy.
_Avoid_: manufacturer, CT-KZ

**LPS (Localization Proposal Submission)**:
A proposal to localize a company's specific product or service in Kazakhstan, including work already in progress or completed. LC and LC Case are historical terms for this work.
_Avoid_: LC, LC Case, local content, LCDP

**LPS entry**:
The record of one localization proposal and its current status. One company can have several entries for different products or services.
_Avoid_: manufacturer profile, company status

**LCDP**:
An operator's own program for developing local content.
_Avoid_: LPS, LC Case, CDP

**Tier**:
The level of a verified manufacturer. Tier 1 is the desktop check. Tier 2 is a site survey. Tier 3 is an AGAR or a CDP on one product. A profile IMBC has not verified is not a tier.
_Avoid_: hidden, score, rank, update status

**CDP**:
A capacity development plan for one product a manufacturer makes. It is the earlier form of an AGAR.
_Avoid_: LCDP, site survey report

**AGAR**:
An advanced gap analysis report on one product a manufacturer makes. A finished CDP is the earlier form of the same work.
_Avoid_: site survey report, a level of the whole company
