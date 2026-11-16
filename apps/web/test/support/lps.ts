import { lpsListSchema } from "@imbc/contracts";
import type { LpsCompanyRead, LpsEntryRead, LpsReference, Role } from "@imbc/contracts";
import type { Me } from "@/lib/session";
import { stubApi, type ApiReply } from "./api";

export const lpsId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function lpsReference(n: number, code: string, name = code): LpsReference {
  return { id: lpsId(n), code, names: { en: name, ru: name, kk: name }, sortOrder: n, retiredAt: null, parent: null };
}
const authored = { createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z", createdBy: lpsId(1), updatedBy: lpsId(1) };
export const LPS_COMPANY: LpsCompanyRead = { id: lpsId(10), name: "Demo LPS company", countries: [lpsReference(20, "KZ", "Kazakhstan")], ...authored };
export const LPS_ENTRY: LpsEntryRead & { rowNumber: number } = {
  id: lpsId(11), rowNumber: 1, company: LPS_COMPANY, sourceType: lpsReference(21, "LPS"),
  scopeDescription: "Demo equipment manufacture", status: lpsReference(22, "planning", "Planning"),
  plannedLaunch: "Q2 2028 / Q1 2029", comment: "Demo comment", investmentUsd: "9007199254740993.12500", newJobs: null, lastUpdatedOn: "2026-10-12",
  commodityTypes: [{ ...lpsReference(23, "A1", "Demo type"), parent: { id: lpsId(24), code: "A", names: { en: "Demo group", ru: "Demo group", kk: "Demo group" }, sortOrder: 24, retiredAt: null } }],
  commodityGroups: [{ id: lpsId(24), code: "A", names: { en: "Demo group", ru: "Demo group", kk: "Demo group" }, sortOrder: 24, retiredAt: null }],
  locations: [{ id: lpsId(30), city: "Demo city", region: lpsReference(25, "DEMO", "Demo region") }, { id: lpsId(31), city: "Other demo city", region: lpsReference(25, "DEMO", "Demo region") }],
  contacts: [{ id: lpsId(40), fullName: "Demo contact A", roleTitle: "Demo position", emails: ["a@lps.local", "a2@lps.local"], phones: ["+70000000001"] }, { id: lpsId(41), fullName: null, roleTitle: null, emails: ["general@lps.local"], phones: ["+70000000002 ext. 001"] }], ...authored,
};
export function lpsMe(role: Role): Me {
  return { user: { id: lpsId(1), email: `${role}@lps.local`, fullName: "Demo user", role, organizationId: lpsId(2), organizationType: role === "manufacturer" ? "manufacturer" : role === "operator" ? "operator" : "imbc", locale: "en" }, gates: { mfa: true, responsibility: true }, homePath: "/lps", otpDelivery: "email" };
}
export const lpsList = (items = [LPS_ENTRY], total = items.length, offset = 0) => ({ total, offset, limit: 50, items });
export function stubLps(role: Role = "expert", overrides: Record<string, ApiReply> = {}) {
  lpsListSchema.parse(lpsList());
  const dictionaries = { country: LPS_COMPANY.countries, programme: [LPS_ENTRY.sourceType, lpsReference(26, "LC")], lps_status: [LPS_ENTRY.status, lpsReference(27, "on_hold", "On hold")], commodity_type: LPS_ENTRY.commodityTypes, commodity_group: LPS_ENTRY.commodityGroups, region: [LPS_ENTRY.locations[0].region!] };
  return stubApi({
    "GET /api/auth/me": { body: lpsMe(role) },
    "GET /api/v1/lps/entries": { body: lpsList() },
    "GET /api/v1/lps/companies": { body: { total: 1, offset: 0, limit: 50, items: [LPS_COMPANY] } },
    "GET /api/v1/lps/dashboard": { body: { totalEntries: 1, totalCompanies: 1, statuses: [{ reference: LPS_ENTRY.status, count: 1 }], regions: [{ reference: null, count: 1 }], commodityGroups: [{ reference: null, count: 1 }] } },
    ...Object.fromEntries(Object.entries(dictionaries).map(([code, refs]) => [`GET /api/v1/dictionaries/${code}/choices`, { body: { total: refs.length, page: 1, pageSize: 100, items: refs.map((ref) => ({ id: ref.id, code: ref.code, name: ref.names.en! })) } }])),
    ...overrides,
  });
}
