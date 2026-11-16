import { lpsQuerySchema, type LpsQuery } from "@imbc/contracts";
export const LPS_MULTI_FILTERS = ["sourceTypeIds", "countryIds", "commodityTypeIds", "commodityGroupIds", "statusIds", "cities", "regionIds"] as const;
const singles = ["q", "lastUpdatedFrom", "lastUpdatedTo", "sort", "direction", "offset", "limit"] as const;
export function readLpsParams(search: URLSearchParams, locale: string) {
  const raw: Record<string, unknown> = { locale };
  for (const key of LPS_MULTI_FILTERS) if (search.has(key)) raw[key] = search.getAll(key);
  for (const key of singles) if (search.has(key)) raw[key] = search.get(key);
  return lpsQuerySchema.safeParse(raw);
}
/** The table and dashboard receive the same normalized filters; page/sort belong only to the table. */
export function lpsRequestParams(query: LpsQuery, dashboard = false) {
  const params = new URLSearchParams();
  for (const key of LPS_MULTI_FILTERS) for (const value of query[key]) params.append(key, value);
  for (const key of ["q", "lastUpdatedFrom", "lastUpdatedTo"] as const) if (query[key]) params.set(key, query[key]);
  params.set("locale", query.locale);
  if (!dashboard) for (const key of ["sort", "direction", "offset", "limit"] as const) params.set(key, String(query[key]));
  return params.toString();
}
export function changeLpsParams(current: URLSearchParams, patch: Record<string, string | string[] | null>, resetPage = true) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    next.delete(key);
    for (const item of Array.isArray(value) ? value : value === null || value === "" ? [] : [value]) next.append(key, item);
  }
  if (resetPage) next.delete("offset");
  return next;
}
