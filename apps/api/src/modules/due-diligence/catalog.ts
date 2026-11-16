/** Canonical IMBC-10 tables, v1.4 13 November. Provider paths belong to a separately reviewed adapter. */
export const DILIGENCE_CATALOG_VERSION = 'v1.4-2026-11-13' as const;
export const DILIGENCE_CATALOG_SOURCE = 'AZhunis/imbc-prototype@8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6' as const;
export const DILIGENCE_GROUPS = [
  'company_enterprise',
  'company_finance',
  'company_procurement',
  'company_tax',
  'director',
  'founder',
  'beneficiary',
] as const;
export type DiligenceGroup = (typeof DILIGENCE_GROUPS)[number];
export type DiligenceCatalogGroup = Exclude<DiligenceGroup, 'company_tax' | 'beneficiary'>;
export interface DiligenceDefinition {
  readonly id: string;
  readonly group: DiligenceCatalogGroup;
  readonly position: number;
  readonly title: string;
  readonly policy: 'scored' | 'shown_only';
}
const tableRows: Record<DiligenceCatalogGroup, readonly (readonly [string, 'scored' | 'shown_only'])[]> = {
  company_enterprise: [
    ['Mass registration address', 'shown_only'],
    ['On the list of complex on-site customs inspections for the period Adata names', 'scored'],
    ['On the list of preventive control and supervision for the period Adata names', 'scored'],
    ['On the list of labour inspections for the period Adata names', 'scored'],
    ['On the published register of persons receiving funds or property from abroad', 'scored'],
    ['Removed from the stat.gov register', 'scored'],
    ['Inactive enterprise', 'scored'],
    ['Bankrupt', 'scored'],
    ['Registration declared invalid', 'scored'],
    ['Reorganised in breach of the Tax Code', 'scored'],
    ['Absent at the legal address', 'scored'],
    ['Sham enterprise', 'scored'],
    ['Re-registration declared invalid', 'scored'],
    ['Electronic invoices suspended', 'scored'],
    ['Tax debt above 150 monthly calculation indices', 'scored'],
    ['Bankrupt, and the court decision has taken effect', 'scored'],
    ['Bankrupt, and the procedure is complete', 'scored'],
    ['Bankrupt, and a rehabilitation period has started', 'scored'],
    ['Taxpayer in liquidation', 'scored'],
    ['Arrest of bank accounts', 'scored'],
    ['Arrest of property', 'scored'],
    ['Temporary ban on leaving Kazakhstan', 'scored'],
    ['Ban on registration acts', 'scored'],
    ['Ban on notarial acts', 'scored'],
    ['Arrest of vehicles', 'scored'],
    ['Sale of arrested property', 'scored'],
    ['On the register of auctions of arrested property', 'scored'],
    ['Announcement that rehabilitation proceedings have started', 'scored'],
    ["Announcement of a creditors' meeting in rehabilitation", 'scored'],
    ["Announcement of a creditors' meeting in bankruptcy", 'scored'],
    ['Debtor, and the court decision of bankruptcy has taken effect', 'scored'],
    ['Debtor, and a court has ordered liquidation without bankruptcy', 'scored'],
    ['Debtor, and a court has ordered a rehabilitation procedure', 'scored'],
    ['Court order ending a rehabilitation procedure has taken effect', 'scored'],
    ['Supervisory measures and sanctions applied', 'scored'],
    ['Participation in court cases', 'shown_only'],
    ['Administrative fines', 'shown_only'],
    ['Financial pyramid under a pre-trial investigation by the financial-monitoring agency', 'scored'],
    ['Financial pyramid, and that investigation is closed', 'scored'],
    ['Financial pyramid with a court sentence', 'scored'],
    ['Bankruptcy or rehabilitation proceedings opened', 'scored'],
  ],
  company_finance: [
    ['Large taxpayers subject to monitoring', 'shown_only'],
    ['Debtor under enforcement proceedings', 'scored'],
    ['Party to transactions with no actual performance', 'scored'],
    ['Debtor temporarily banned from leaving Kazakhstan', 'scored'],
    ['Tax and customs arrears', 'scored'],
  ],
  company_procurement: [
    ['Participant in public procurement of Kazakhstan', 'shown_only'],
    ['Top-100 suppliers of public procurement', 'shown_only'],
    ['Top-100 customers of public procurement', 'shown_only'],
    ['Dishonest participant in public procurement of Kazakhstan', 'scored'],
    ['Participant of Samruk-Kazyna', 'shown_only'],
    ['Register of Samruk-Kazyna producers', 'shown_only'],
    ['Register of unreliable suppliers of Samruk-Kazyna', 'scored'],
    ['Register of trusted software and electronics', 'shown_only'],
    ['Concluded contracts', 'shown_only'],
    ['Unreliable supplier of Nazarbayev Intellectual Schools', 'scored'],
    ['Unreliable supplier of Nazarbayev University', 'scored'],
    ['Dishonest participant of the National Bank of Kazakhstan', 'scored'],
    ['Dishonest participant of Mitwork', 'scored'],
  ],
  director: [
    ['Participation in court cases', 'shown_only'],
    ['Debtor under enforcement proceedings', 'scored'],
    ['Debtor temporarily banned from leaving Kazakhstan', 'scored'],
    ['Tax and customs arrears', 'scored'],
    ['Arrest of bank accounts', 'scored'],
    ['Arrest of property', 'scored'],
    ['Temporary ban on leaving Kazakhstan', 'scored'],
    ['Ban on registration acts', 'scored'],
    ['Ban on notarial acts', 'scored'],
    ['Arrest of vehicles', 'scored'],
    ['Sale of arrested property', 'scored'],
    ['On the list of persons who committed sexual violence against a minor', 'scored'],
    ['On the list of organisations and persons linked to financing terrorism or extremism', 'scored'],
    ['Removed from that financing list', 'shown_only'],
    ['Missing-persons search', 'scored'],
    ['Wanted as a criminal', 'scored'],
    ['Wanted as a debtor or a respondent under an enforcement document', 'scored'],
    ['Maintenance debtor', 'scored'],
    ['Announcement that rehabilitation proceedings have started', 'scored'],
    ["Announcement of a creditors' meeting in rehabilitation", 'scored'],
    ["Announcement of a creditors' meeting in bankruptcy", 'scored'],
    ['Participant in a personal bankruptcy procedure', 'scored'],
    ['A problem in another company with the same director', 'scored'],
  ],
  founder: [
    ['Participation in court cases', 'shown_only'],
    ['Legal entity with offshore participation', 'scored'],
    ['Debtor temporarily banned from leaving Kazakhstan', 'scored'],
    ['Debtor under enforcement proceedings', 'scored'],
    ['Tax and customs arrears', 'scored'],
    ['Arrest of bank accounts', 'scored'],
    ['Arrest of property', 'scored'],
    ['Temporary ban on leaving Kazakhstan', 'scored'],
    ['Ban on registration acts', 'scored'],
    ['Ban on notarial acts', 'scored'],
    ['Arrest of vehicles', 'scored'],
    ['Inactive enterprise', 'scored'],
    ['Removed from the stat.gov register', 'scored'],
    ['Bankrupt', 'scored'],
    ['Reorganised in breach of the Tax Code', 'scored'],
    ['Sham enterprise', 'scored'],
    ['Bankrupt, and the court decision has taken effect', 'scored'],
    ['Bankrupt, and the procedure is complete', 'scored'],
    ['Bankrupt, and a rehabilitation period has started', 'scored'],
    ['Dishonest participant in public procurement of Kazakhstan', 'scored'],
    ['Register of unreliable suppliers of Samruk-Kazyna', 'scored'],
    ['Taxpayer in liquidation', 'scored'],
    ['On the list of persons involved in terrorist activity', 'scored'],
    ['On the list of organisations and persons linked to financing terrorism or extremism', 'scored'],
    ['Removed from that financing list', 'shown_only'],
    ['On the list of persons who committed sexual violence against a minor', 'scored'],
    ['Missing-persons search', 'scored'],
    ['Wanted as a criminal', 'scored'],
    ['Wanted as a debtor or a respondent under an enforcement document', 'scored'],
    ['Maintenance debtor', 'scored'],
    ['Registration declared invalid', 'scored'],
    ['Absent at the legal address', 'scored'],
    ['Re-registration declared invalid', 'scored'],
    ['Electronic invoices suspended', 'scored'],
  ],
};
export const DILIGENCE_CATALOG: readonly DiligenceDefinition[] = Object.freeze(
  Object.entries(tableRows).flatMap(([group, rows]) =>
    rows.map(([title, policy], position) =>
      Object.freeze({
        id: `${group}.${String(position + 1).padStart(2, '0')}`,
        group: group as DiligenceCatalogGroup,
        position,
        title,
        policy,
      }),
    ),
  ),
);
const byId = new Map(DILIGENCE_CATALOG.map((row) => [row.id, row]));
const titleKey = (title: string) => title.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const shownOnlyTitles = new Set(
  DILIGENCE_CATALOG.filter((row) => row.policy === 'shown_only').map((row) => titleKey(row.title)),
);
/** The IMBC-10 title exception also applies when Adata adds that title in another group. */
export function isDiligenceShownOnlyTitle(title: string): boolean {
  return shownOnlyTitles.has(titleKey(title));
}
export function diligenceDefinition(id: string): DiligenceDefinition | undefined {
  return byId.get(id);
}
/** Exact canonical title lookup only; no guessed translations or fuzzy provider mappings. */
export function diligenceDefinitionByTitle(group: DiligenceGroup, title: string): DiligenceDefinition | undefined {
  const table = group === 'beneficiary' ? 'founder' : group;
  return DILIGENCE_CATALOG.find((row) => row.group === table && titleKey(row.title) === titleKey(title));
}
