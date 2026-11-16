import {
  lpsCompanyReadSchema,
  lpsEntryReadSchema,
  type LpsCompanyRead,
  type LpsEntryRead,
  type LpsReference,
} from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';

const chunks = <T>(values: T[], size = 1000) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const iso = (value: Date | string) => new Date(value).toISOString();
interface ReferenceRow extends Record<string, unknown> {
  id: string;
  code: string;
  parent: string | null;
  sort: number;
  retired: Date | null;
  en: string | null;
  ru: string | null;
  kk: string | null;
}
export async function readLpsReferences(tx: Database, selectedIds: string[]): Promise<Map<string, LpsReference>> {
  const rows: ReferenceRow[] = [];
  for (const batch of chunks([...new Set(selectedIds)])) {
    const result = await tx.execute<ReferenceRow>(sql`
      select de.id,de.code,de.parent_entry_id parent,de.sort_order sort,de.retired_at retired,
       max(tr.name) filter(where tr.language='en') en,max(tr.name) filter(where tr.language='ru') ru,max(tr.name) filter(where tr.language='kk') kk
      from dictionary_entry de left join dictionary_entry_translation tr on tr.dictionary_entry_id=de.id
      where de.id=any(${sql.param(batch)}::uuid[]) or de.id in(select parent_entry_id from dictionary_entry where id=any(${sql.param(batch)}::uuid[]))
      group by de.id
    `);
    rows.push(...result.rows);
  }
  const base = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        code: row.code,
        sortOrder: row.sort,
        retiredAt: row.retired ? iso(row.retired) : null,
        names: { en: row.en, ru: row.ru, kk: row.kk },
      },
    ]),
  );
  return new Map(
    rows.map((row) => [row.id, { ...base.get(row.id)!, parent: row.parent ? (base.get(row.parent) ?? null) : null }]),
  );
}
export function compareLpsReferences(locale: string) {
  const name = (value: LpsReference) =>
    value.names[locale as keyof typeof value.names] ?? value.names.kk ?? value.names.ru ?? value.names.en ?? value.code;
  const cmp = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));
  return (a: LpsReference, b: LpsReference) =>
    a.sortOrder - b.sortOrder || cmp(name(a), name(b)) || cmp(a.code, b.code);
}
interface CompanyRow extends Record<string, unknown> {
  id: string;
  name: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}
export async function readLpsCompanies(
  tx: Database,
  requestedIds: string[],
  locale: string,
): Promise<Map<string, LpsCompanyRead>> {
  const companyRows: CompanyRow[] = [];
  const countries: { companyId: string; countryId: string }[] = [];
  for (const batch of chunks([...new Set(requestedIds)])) {
    const companies = await tx.execute<CompanyRow>(
      sql`select id,name,created_at "createdAt",created_by "createdBy",updated_at "updatedAt",updated_by "updatedBy" from lps_company where id=any(${sql.param(batch)}::uuid[]) and deleted_at is null`,
    );
    const associated = await tx.execute<{ companyId: string; countryId: string }>(
      sql`select lps_company_id "companyId",country_id "countryId" from lps_company_country where lps_company_id=any(${sql.param(batch)}::uuid[])`,
    );
    companyRows.push(...companies.rows);
    countries.push(...associated.rows);
  }
  const references = await readLpsReferences(
    tx,
    countries.map((row) => row.countryId),
  );
  const perCompany = new Map<string, LpsReference[]>();
  for (const row of countries) {
    const list = perCompany.get(row.companyId) ?? [];
    list.push(references.get(row.countryId)!);
    perCompany.set(row.companyId, list);
  }
  return new Map(
    companyRows.map((row) => [
      row.id,
      lpsCompanyReadSchema.parse({
        ...row,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
        countries: (perCompany.get(row.id) ?? []).sort(compareLpsReferences(locale)),
      }),
    ]),
  );
}
interface EntryRow extends Record<string, unknown> {
  id: string;
  companyId: string;
  sourceTypeId: string;
  statusId: string;
  scopeDescription: string;
  plannedLaunch: string | null;
  comment: string | null;
  investmentUsd: string | null;
  newJobs: number | null;
  lastUpdatedOn: string | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}
interface LocationRow extends Record<string, unknown> {
  id: string;
  entryId: string;
  city: string | null;
  regionId: string | null;
}
interface ContactRow extends Record<string, unknown> {
  id: string;
  entryId: string;
  fullName: string | null;
  roleTitle: string | null;
}
/** Fetch only requested page/subject IDs, with bounded batched child/reference queries. */
export async function readLpsEntries(
  tx: Database,
  requestedIds: string[],
  locale: string,
): Promise<Map<string, LpsEntryRead>> {
  const entries: EntryRow[] = [],
    locations: LocationRow[] = [],
    contacts: ContactRow[] = [];
  const commodities: { entryId: string; typeId: string }[] = [];
  for (const batch of chunks([...new Set(requestedIds)])) {
    const roots = await tx.execute<EntryRow>(
      sql`select e.id,e.lps_company_id "companyId",e.source_type_id "sourceTypeId",e.status_id "statusId",e.scope_description "scopeDescription",e.planned_launch "plannedLaunch",e.comment,e.investment_usd "investmentUsd",e.new_jobs "newJobs",to_char(e.last_updated_on,'YYYY-MM-DD') "lastUpdatedOn",e.created_at "createdAt",e.created_by "createdBy",e.updated_at "updatedAt",e.updated_by "updatedBy" from lps_entry e join lps_company c on c.id=e.lps_company_id where e.id=any(${sql.param(batch)}::uuid[]) and e.deleted_at is null and c.deleted_at is null`,
    );
    const places = await tx.execute<LocationRow>(
      sql`select id,lps_entry_id "entryId",city,region_id "regionId" from lps_location where lps_entry_id=any(${sql.param(batch)}::uuid[]) order by sort_order,id`,
    );
    const people = await tx.execute<ContactRow>(
      sql`select id,lps_entry_id "entryId",full_name "fullName",role_title "roleTitle" from lps_contact where lps_entry_id=any(${sql.param(batch)}::uuid[]) order by sort_order,id`,
    );
    const types = await tx.execute<{ entryId: string; typeId: string }>(
      sql`select lps_entry_id "entryId",commodity_type_id "typeId" from lps_entry_commodity where lps_entry_id=any(${sql.param(batch)}::uuid[])`,
    );
    entries.push(...roots.rows);
    locations.push(...places.rows);
    contacts.push(...people.rows);
    commodities.push(...types.rows);
  }
  const companies = await readLpsCompanies(
    tx,
    entries.map((row) => row.companyId),
    locale,
  );
  const references = await readLpsReferences(tx, [
    ...entries.flatMap((row) => [row.sourceTypeId, row.statusId]),
    ...locations.flatMap((row) => (row.regionId ? [row.regionId] : [])),
    ...commodities.map((row) => row.typeId),
  ]);
  const emailMap = new Map<string, string[]>(),
    phoneMap = new Map<string, string[]>();
  for (const batch of chunks(contacts.map((row) => row.id))) {
    const emails = await tx.execute<{ contactId: string; value: string }>(
      sql`select lps_contact_id "contactId",email value from lps_contact_email where lps_contact_id=any(${sql.param(batch)}::uuid[]) order by sort_order,email`,
    );
    const phones = await tx.execute<{ contactId: string; value: string }>(
      sql`select lps_contact_id "contactId",phone value from lps_contact_phone where lps_contact_id=any(${sql.param(batch)}::uuid[]) order by sort_order,phone`,
    );
    for (const [map, rows] of [
      [emailMap, emails.rows],
      [phoneMap, phones.rows],
    ] as const)
      for (const row of rows) {
        const list = map.get(row.contactId) ?? [];
        list.push(row.value);
        map.set(row.contactId, list);
      }
  }
  const byEntry = <T extends { entryId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.entryId) ?? [];
      list.push(row);
      map.set(row.entryId, list);
    }
    return map;
  };
  const places = byEntry(locations),
    people = byEntry(contacts),
    types = byEntry(commodities);
  return new Map(
    entries.map(({ companyId, sourceTypeId, statusId, ...row }) => {
      const commodityTypes = (types.get(row.id) ?? [])
        .map((type) => references.get(type.typeId)!)
        .sort(compareLpsReferences(locale));
      const groups = [
        ...new Map(
          commodityTypes.flatMap((type) => (type.parent ? [[type.parent.id, type.parent] as const] : [])),
        ).values(),
      ];
      groups.sort((a, b) => compareLpsReferences(locale)({ ...a, parent: null }, { ...b, parent: null }));
      return [
        row.id,
        lpsEntryReadSchema.parse({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
          company: companies.get(companyId),
          sourceType: references.get(sourceTypeId),
          status: references.get(statusId),
          commodityTypes,
          commodityGroups: groups,
          locations: (places.get(row.id) ?? []).map(({ id, city, regionId }) => ({
            id,
            city,
            region: regionId ? references.get(regionId) : null,
          })),
          contacts: (people.get(row.id) ?? []).map(({ id, fullName, roleTitle }) => ({
            id,
            fullName,
            roleTitle,
            emails: emailMap.get(id) ?? [],
            phones: phoneMap.get(id) ?? [],
          })),
        }),
      ];
    }),
  );
}
