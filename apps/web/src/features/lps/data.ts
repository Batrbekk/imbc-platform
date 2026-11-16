import { type LpsEntryRead } from "@imbc/contracts";
/** Round for the two-decimal table display only. Never write this result back to the entry. */
export function lpsTableAmount(value: string | null): string | null {
  if (value === null) return null;
  const [whole, fraction = ""] = value.split(".");
  const rounded = BigInt(whole + fraction.padEnd(2, "0").slice(0, 2)) + (Number(fraction[2] ?? "0") >= 5 ? 1n : 0n);
  const digits = rounded.toString().padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
export function lpsEntryDraft(entry: LpsEntryRead | null, companyId = "") {
  return {
    companyId: entry?.company.id ?? companyId, sourceTypeId: entry?.sourceType.id ?? undefined,
    scopeDescription: entry?.scopeDescription ?? "", statusId: entry?.status.id ?? "",
    plannedLaunch: entry?.plannedLaunch ?? "", comment: entry?.comment ?? "", investmentUsd: entry?.investmentUsd ?? "",
    newJobs: entry?.newJobs == null ? "" : String(entry.newJobs), lastUpdatedOn: entry?.lastUpdatedOn ?? "",
    commodityTypeIds: entry?.commodityTypes.map((value) => value.id) ?? [],
    locations: entry?.locations.map((value) => ({ key: value.id, id: value.id as string | null, city: value.city ?? "", regionId: value.region?.id ?? null })) ?? [],
    contacts: entry?.contacts.map((value) => ({ key: value.id, id: value.id as string | null, fullName: value.fullName ?? "", roleTitle: value.roleTitle ?? "", emails: [...value.emails], phones: [...value.phones] })) ?? [],
  };
}
export type LpsDraft = ReturnType<typeof lpsEntryDraft>;
export function lpsDraftInput(draft: LpsDraft) {
  return { ...draft, plannedLaunch: draft.plannedLaunch || null, comment: draft.comment || null, investmentUsd: draft.investmentUsd || null,
    newJobs: draft.newJobs === "" ? null : /^\d+$/.test(draft.newJobs) ? Number(draft.newJobs) : draft.newJobs,
    lastUpdatedOn: draft.lastUpdatedOn || null,
    locations: draft.locations.map(({ id, city, regionId }) => ({ id, city: city || null, regionId })),
    contacts: draft.contacts.map(({ id, fullName, roleTitle, emails, phones }) => ({ id, fullName: fullName || null, roleTitle: roleTitle || null, emails, phones })),
  };
}
export function reorderLps<T>(values: readonly T[], index: number, direction: -1 | 1): T[] {
  const next = [...values], other = index + direction;
  if (other < 0 || other >= next.length) return next;
  [next[index], next[other]] = [next[other], next[index]];
  return next;
}
