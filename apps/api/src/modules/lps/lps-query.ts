import type { LpsFilters, LpsQuery, LpsSortColumn } from '@imbc/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';

export const escapeLpsLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const and = (clauses: SQL[]) => (clauses.length ? sql.join(clauses, sql` and `) : sql`true`);
const or = (clauses: SQL[]) => (clauses.length ? sql.join(clauses, sql` or `) : sql`false`);
const ids = (values: string[]) => values.filter((v) => v !== 'unknown');
const unknown = (values: string[]) => values.includes('unknown');

/** Both classification predicates refer to one selected type, never independent cross-products. */
export function lpsCommodityPredicate(filters: LpsFilters): SQL {
  const clauses: SQL[] = [];
  if (filters.commodityTypeIds.length)
    clauses.push(sql`t.commodity_type_id = any(${sql.param(ids(filters.commodityTypeIds))}::uuid[])`);
  if (filters.commodityGroupIds.length)
    clauses.push(sql`de.parent_entry_id = any(${sql.param(ids(filters.commodityGroupIds))}::uuid[])`);
  return and(clauses);
}
/** City and region are a confirmed pair belonging to one localization row. */
export function lpsLocationPredicate(filters: LpsFilters): SQL {
  const clauses: SQL[] = [];
  if (filters.cities.length) clauses.push(sql`l.city = any(${sql.param(filters.cities)}::text[])`);
  if (filters.regionIds.length) clauses.push(sql`l.region_id = any(${sql.param(ids(filters.regionIds))}::uuid[])`);
  return and(clauses);
}
export function lpsWhere(filters: LpsFilters): SQL {
  const clauses = [sql`e.deleted_at is null`, sql`c.deleted_at is null`];
  if (filters.q) {
    const q = `%${escapeLpsLike(filters.q)}%`;
    clauses.push(sql`(c.name ilike ${q} or e.scope_description ilike ${q} or e.comment ilike ${q}
      or exists(select 1 from lps_location l where l.lps_entry_id=e.id and l.city ilike ${q})
      or exists(select 1 from lps_contact p where p.lps_entry_id=e.id and p.full_name ilike ${q}))`);
  }
  if (filters.sourceTypeIds.length)
    clauses.push(sql`e.source_type_id = any(${sql.param(filters.sourceTypeIds)}::uuid[])`);
  if (filters.statusIds.length) clauses.push(sql`e.status_id = any(${sql.param(filters.statusIds)}::uuid[])`);
  if (filters.lastUpdatedFrom) clauses.push(sql`e.last_updated_on >= ${filters.lastUpdatedFrom}::date`);
  if (filters.lastUpdatedTo) clauses.push(sql`e.last_updated_on <= ${filters.lastUpdatedTo}::date`);
  if (filters.countryIds.length) {
    const alternatives = [
      sql`exists(select 1 from lps_company_country cc where cc.lps_company_id=c.id and cc.country_id=any(${sql.param(ids(filters.countryIds))}::uuid[]))`,
    ];
    if (unknown(filters.countryIds))
      alternatives.push(sql`not exists(select 1 from lps_company_country cc where cc.lps_company_id=c.id)`);
    clauses.push(sql`(${or(alternatives)})`);
  }
  if (filters.commodityTypeIds.length || filters.commodityGroupIds.length) {
    const alternatives = [
      sql`exists(select 1 from lps_entry_commodity t join dictionary_entry de on de.id=t.commodity_type_id
      where t.lps_entry_id=e.id and ${lpsCommodityPredicate(filters)})`,
    ];
    const unknownMatches =
      (!filters.commodityTypeIds.length || unknown(filters.commodityTypeIds)) &&
      (!filters.commodityGroupIds.length || unknown(filters.commodityGroupIds));
    if (unknownMatches)
      alternatives.push(sql`not exists(select 1 from lps_entry_commodity t where t.lps_entry_id=e.id)`);
    clauses.push(sql`(${or(alternatives)})`);
  }
  if (filters.cities.length || filters.regionIds.length) {
    const alternatives = [
      sql`exists(select 1 from lps_location l where l.lps_entry_id=e.id and ${lpsLocationPredicate(filters)})`,
    ];
    if (unknown(filters.regionIds)) {
      const city = filters.cities.length
        ? sql`and exists(select 1 from lps_location l where l.lps_entry_id=e.id and l.city=any(${sql.param(filters.cities)}::text[]))`
        : sql``;
      alternatives.push(
        sql`(not exists(select 1 from lps_location l where l.lps_entry_id=e.id and l.region_id is not null) ${city})`,
      );
    }
    clauses.push(sql`(${or(alternatives)})`);
  }
  return and(clauses);
}
const label = (entry: SQL, locale: string) => sql`coalesce(
 (select name from dictionary_entry_translation where dictionary_entry_id=${entry} and language=${locale}::locale),
 (select name from dictionary_entry_translation where dictionary_entry_id=${entry} and language='kk'),
 (select name from dictionary_entry_translation where dictionary_entry_id=${entry} and language='ru'),
 (select name from dictionary_entry_translation where dictionary_entry_id=${entry} and language='en'))`;
const referenceKey = (alias: SQL, locale: string) =>
  sql`row(${alias}.sort_order, coalesce(${label(sql`${alias}.id`, locale)},${alias}.code),${alias}.code)`;
function dictionaryArray(column: LpsSortColumn, locale: string): SQL {
  // Region cells follow the saved location groups, not a deduplicated dictionary set.
  if (column === 'regions')
    return sql`array(select ${referenceKey(sql`de`, locale)}
      from lps_location l join dictionary_entry de on de.id=l.region_id
      where l.lps_entry_id=e.id order by l.sort_order,l.id)`;
  const from =
    column === 'countries'
      ? sql`lps_company_country cc join dictionary_entry de on de.id=cc.country_id where cc.lps_company_id=c.id`
      : column === 'commodityGroups'
        ? sql`dictionary_entry de where de.id in(select dt.parent_entry_id from lps_entry_commodity t join dictionary_entry dt on dt.id=t.commodity_type_id where t.lps_entry_id=e.id)`
        : sql`lps_entry_commodity t join dictionary_entry de on de.id=t.commodity_type_id where t.lps_entry_id=e.id`;
  const key = referenceKey(sql`de`, locale);
  return sql`array(select ${key} from ${from} order by de.sort_order,coalesce(${label(sql`de.id`, locale)},de.code),de.code)`;
}
function scalarArray(column: LpsSortColumn): SQL {
  // Missing keys are omitted from sorting, while the read DTO retains every aligned display group.
  if (column === 'cities')
    return sql`array(select l.city from lps_location l where l.lps_entry_id=e.id and l.city is not null order by l.sort_order,l.id)`;
  if (column === 'contactNames' || column === 'contactTitles') {
    const field = column === 'contactNames' ? sql`p.full_name` : sql`p.role_title`;
    return sql`array(select ${field} from lps_contact p where p.lps_entry_id=e.id and ${field} is not null order by p.sort_order,p.id)`;
  }
  const field = column === 'emails' ? sql`m.email` : sql`m.phone`;
  const table = column === 'emails' ? sql`lps_contact_email` : sql`lps_contact_phone`;
  return sql`array(select ${field} from lps_contact p join ${table} m on m.lps_contact_id=p.id where p.lps_entry_id=e.id order by p.sort_order,p.id,m.sort_order,${field})`;
}
export function lpsOrder(query: LpsQuery): SQL {
  const dir = query.direction === 'asc' ? sql`asc` : sql`desc`;
  const column = query.sort;
  if (column === 'plannedLaunch') {
    const lo = sql`case when e.planned_launch ~ '^[0-9]{4}$' then e.planned_launch::int*4
      when e.planned_launch like 'Q%' then substring(e.planned_launch from 4 for 4)::int*4+substring(e.planned_launch from 2 for 1)::int-1 end`;
    const hi = sql`case when e.planned_launch ~ '^[0-9]{4}$' then e.planned_launch::int*4+3
      when e.planned_launch like '% / %' then substring(e.planned_launch from 14 for 4)::int*4+substring(e.planned_launch from 12 for 1)::int-1
      when e.planned_launch like 'Q%' then ${lo} end`;
    return sql`case when e.planned_launch is null then 2 when e.planned_launch='TBD' then 1 else 0 end asc,${lo} ${dir},${hi} ${dir},e.id asc`;
  }
  const scalars: Partial<Record<LpsSortColumn, SQL>> = {
    company: sql`c.name`,
    scopeDescription: sql`e.scope_description`,
    comment: sql`e.comment`,
    investmentUsd: sql`e.investment_usd`,
    newJobs: sql`e.new_jobs`,
    lastUpdatedOn: sql`e.last_updated_on`,
  };
  const scalar = scalars[column];
  if (scalar) return sql`${scalar} ${dir} nulls last,e.id asc`;
  if (column === 'sourceType' || column === 'status') {
    const id = column === 'sourceType' ? sql`e.source_type_id` : sql`e.status_id`;
    return sql`(select ${referenceKey(sql`de`, query.locale)} from dictionary_entry de where de.id=${id}) ${dir},e.id asc`;
  }
  const dictionary = ['countries', 'commodityTypes', 'commodityGroups', 'regions'].includes(column);
  const array = dictionary ? dictionaryArray(column, query.locale) : scalarArray(column);
  const missing = dictionary
    ? sql`cardinality(${array})=0`
    : sql`not exists(select 1 from unnest(${array}) v where v is not null)`;
  return sql`${missing} asc,${array} ${dir},e.id asc`;
}
/** No business rows are fetched before the filtered page IDs are selected by PostgreSQL. */
export async function lpsPageIds(tx: Database, query: LpsQuery) {
  const where = lpsWhere(query);
  const total = await tx.execute<{ count: number }>(
    sql`select count(*)::int count from lps_entry e join lps_company c on c.id=e.lps_company_id where ${where}`,
  );
  const page = await tx.execute<{
    id: string;
  }>(sql`select e.id from lps_entry e join lps_company c on c.id=e.lps_company_id
    where ${where} order by ${lpsOrder(query)} limit ${query.limit} offset ${query.offset}`);
  return { total: total.rows[0]!.count, ids: page.rows.map((row) => row.id) };
}
export async function lpsDashboardCounts(tx: Database, filters: LpsFilters) {
  const where = lpsWhere(filters);
  const result = await tx.execute<{
    kind: 'total' | 'company' | 'status' | 'region' | 'group';
    id: string | null;
    count: number;
  }>(sql`
    with matched as(select e.id,e.lps_company_id,e.status_id from lps_entry e join lps_company c on c.id=e.lps_company_id where ${where}),
    regions as(select distinct m.id,l.region_id from matched m join lps_location l on l.lps_entry_id=m.id
      where l.region_id is not null and ${lpsLocationPredicate(filters)}),
    groups as(select distinct m.id,de.parent_entry_id from matched m join lps_entry_commodity t on t.lps_entry_id=m.id
      join dictionary_entry de on de.id=t.commodity_type_id where ${lpsCommodityPredicate(filters)})
    select 'total' kind,null::uuid id,count(*)::int count from matched
    union all select 'company',null::uuid,count(distinct lps_company_id)::int from matched
    union all select 'status',status_id,count(*)::int from matched group by status_id
    union all select 'region',region_id,count(distinct id)::int from regions group by region_id
    union all select 'region',null::uuid,count(*)::int from matched m where not exists(select 1 from lps_location l where l.lps_entry_id=m.id and l.region_id is not null) having count(*)>0
    union all select 'group',parent_entry_id,count(distinct id)::int from groups group by parent_entry_id
    union all select 'group',null::uuid,count(*)::int from matched m where not exists(select 1 from lps_entry_commodity t where t.lps_entry_id=m.id) having count(*)>0
  `);
  return result.rows;
}
