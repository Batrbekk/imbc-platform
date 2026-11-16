import { draftEmailSchema, draftPhoneSchema, type MainInformationWrite } from '@imbc/contracts';

/** MAN-06/08: ownership belongs to one field in one content revision, never to a whole Save. */
export type MainFieldOwner = 'unclaimed' | 'legacy_unknown' | 'manufacturer' | 'adata' | 'e_ondiris';
export type MainContactField = 'companyPhone' | 'contactEmail';
export interface MainContactOwnership {
  field: MainContactField;
  owner: MainFieldOwner;
  value: string | null;
  adataSnapshotId: string | null;
  eOndirisRecordIds: string[];
}
export type MainContactCandidate =
  | {
      kind: 'value';
      value: string;
      owner: 'adata' | 'e_ondiris';
      adataSnapshotId: string | null;
      eOndirisRecordIds: string[];
    }
  | { kind: 'none' | 'ambiguous' | 'unavailable' };
const copyContact = (row: MainContactOwnership): MainContactOwnership => ({
  field: row.field,
  owner: row.owner,
  value: row.value,
  adataSnapshotId: row.adataSnapshotId,
  eOndirisRecordIds: [...row.eOndirisRecordIds],
});

/** Invalid source values are diagnostics; only one distinct validated value can become a default. */
export function validatedSourceContact(
  field: MainContactField,
  values: readonly (string | null)[],
): {
  kind: 'value' | 'none' | 'ambiguous';
  value: string | null;
  invalidCount: number;
} {
  const schema = field === 'companyPhone' ? draftPhoneSchema : draftEmailSchema;
  const valid = new Set<string>();
  let invalidCount = 0;
  for (const value of values) {
    if (value === null || value.trim() === '') continue;
    const parsed = schema.safeParse(value);
    if (!parsed.success || parsed.data === null) invalidCount++;
    else valid.add(parsed.data);
  }
  return {
    kind: valid.size > 1 ? 'ambiguous' : valid.size === 1 ? 'value' : 'none',
    value: [...valid][0] ?? null,
    invalidCount,
  };
}

/** A conflicting e-Ondiris response is not 'returns nothing', so it cannot silently select Adata. */
export function chooseMainContact(
  field: MainContactField,
  eOndiris: readonly { id: string; value: string | null }[],
  adata: { snapshotId: string; values: readonly (string | null)[] } | null,
  adataUnavailable = false,
): MainContactCandidate {
  const eo = validatedSourceContact(
    field,
    eOndiris.map((record) => record.value),
  );
  if (eo.kind === 'ambiguous') return { kind: 'ambiguous' };
  if (eo.kind === 'value')
    return {
      kind: 'value',
      value: eo.value!,
      owner: 'e_ondiris',
      adataSnapshotId: null,
      eOndirisRecordIds: eOndiris
        .flatMap((record) => (validatedSourceContact(field, [record.value]).value === eo.value ? [record.id] : []))
        .sort(),
    };
  if (!adata) return { kind: adataUnavailable ? 'unavailable' : 'none' };
  const selected = validatedSourceContact(field, adata.values);
  if (selected.kind !== 'value') return { kind: selected.kind };
  return {
    kind: 'value',
    value: selected.value!,
    owner: 'adata',
    adataSnapshotId: adata.snapshotId,
    eOndirisRecordIds: [],
  };
}

export function initialContactOwnership(
  field: MainContactField,
  value: string | null,
  fresh: boolean,
): MainContactOwnership {
  return {
    field,
    owner: fresh && value === null ? 'unclaimed' : 'legacy_unknown',
    value,
    adataSnapshotId: null,
    eOndirisRecordIds: [],
  };
}

/** Compare normalized submitted values with the exact canonical values the editor read. */
export function recordMainContactSave(
  previous: MainContactOwnership,
  canonicalBefore: string | null,
  submitted: string | null,
): MainContactOwnership {
  if (previous.value !== canonicalBefore) throw new Error('Main contact ownership does not match canonical content');
  if (canonicalBefore === submitted) return copyContact(previous);
  return {
    field: previous.field,
    owner: 'manufacturer',
    value: submitted,
    adataSnapshotId: null,
    eOndirisRecordIds: [],
  };
}

/** Absence/unavailability does not clear a previously captured contact; explicit manufacturer NULL does. */
export function refreshMainContact(
  previous: MainContactOwnership,
  candidate: MainContactCandidate,
): MainContactOwnership {
  if (previous.owner === 'manufacturer' || previous.owner === 'legacy_unknown' || candidate.kind !== 'value')
    return copyContact(previous);
  return {
    field: previous.field,
    owner: candidate.owner,
    value: candidate.value,
    adataSnapshotId: candidate.adataSnapshotId,
    eOndirisRecordIds: [...candidate.eOndirisRecordIds],
  };
}

export interface MainSiteOwnership {
  identityId: string;
  addressOwner: MainFieldOwner;
  cityOwner: MainFieldOwner;
  regionOwner: MainFieldOwner;
  deleted: boolean;
}
export interface MainSiteBinding {
  registrationNumber: string;
  identityId: string;
  snapshotId: string;
}
export type ExistingMainSite = MainInformationWrite['sites'][number] & { identityId: string };
const copySiteOwner = (row: MainSiteOwnership): MainSiteOwnership => ({
  identityId: row.identityId,
  addressOwner: row.addressOwner,
  cityOwner: row.cityOwner,
  regionOwner: row.regionOwner,
  deleted: row.deleted,
});

/** A saved deletion is durable even after an address or source snapshot changes. */
export function recordMainSiteSave(
  before: readonly ExistingMainSite[],
  after: readonly ExistingMainSite[],
  previous: readonly MainSiteOwnership[],
): MainSiteOwnership[] {
  const beforeMap = new Map(before.map((site) => [site.identityId, site]));
  const afterMap = new Map(after.map((site) => [site.identityId, site]));
  const ownership = new Map(previous.map((row) => [row.identityId, copySiteOwner(row)]));
  for (const site of before)
    if (!ownership.has(site.identityId))
      ownership.set(site.identityId, {
        identityId: site.identityId,
        addressOwner: 'legacy_unknown',
        cityOwner: 'legacy_unknown',
        regionOwner: 'legacy_unknown',
        deleted: false,
      });
  for (const [identityId, row] of ownership)
    if (!afterMap.has(identityId) && beforeMap.has(identityId)) row.deleted = true;
  for (const site of after) {
    const old = beforeMap.get(site.identityId);
    const row = ownership.get(site.identityId) ?? {
      identityId: site.identityId,
      addressOwner: 'manufacturer' as const,
      cityOwner: 'manufacturer' as const,
      regionOwner: 'manufacturer' as const,
      deleted: false,
    };
    if (old) {
      if (old.address !== site.address) row.addressOwner = 'manufacturer';
      if (old.city !== site.city) row.cityOwner = 'manufacturer';
      if (old.regionId !== site.regionId) row.regionOwner = 'manufacturer';
    }
    row.deleted = false;
    ownership.set(site.identityId, row);
  }
  return [...ownership.values()];
}

export interface MainSiteRefreshPlan {
  sites: ExistingMainSite[];
  ownership: MainSiteOwnership[];
  bindings: MainSiteBinding[];
  issues: { code: 'source_site_ambiguous'; registrationNumbers: string[] }[];
}

/** Only verified registration identity or one exact address associates a source site. No positional/place inference. */
export function planMainSiteRefresh(
  before: readonly ExistingMainSite[],
  priorOwnership: readonly MainSiteOwnership[],
  priorBindings: readonly MainSiteBinding[],
  records: readonly { id: string; registrationNumber: string; productionAddress: string | null }[],
  newIdentity: () => string,
): MainSiteRefreshPlan {
  const sites = new Map(before.map((site) => [site.identityId, { ...site }]));
  const ownership = new Map(priorOwnership.map((row) => [row.identityId, copySiteOwner(row)]));
  for (const site of before)
    if (!ownership.has(site.identityId))
      ownership.set(site.identityId, {
        identityId: site.identityId,
        addressOwner: 'legacy_unknown',
        cityOwner: 'legacy_unknown',
        regionOwner: 'legacy_unknown',
        deleted: false,
      });
  const bindings = new Map(
    priorBindings.map((binding) => [
      binding.registrationNumber,
      {
        registrationNumber: binding.registrationNumber,
        identityId: binding.identityId,
        snapshotId: binding.snapshotId,
      },
    ]),
  );
  const bindingsByIdentity = new Map<string, MainSiteBinding[]>();
  for (const binding of bindings.values()) {
    const group = bindingsByIdentity.get(binding.identityId) ?? [];
    group.push(binding);
    bindingsByIdentity.set(binding.identityId, group);
  }
  const recordsByRegistration = new Map(records.map((record) => [record.registrationNumber, record]));
  const recordsByIdentity = new Map<string, (typeof records)[number][]>();
  const unbound: (typeof records)[number][] = [];
  for (const record of [...records].sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber, 'en'))) {
    const binding = bindings.get(record.registrationNumber);
    if (!binding) {
      unbound.push(record);
      continue;
    }
    const group = recordsByIdentity.get(binding.identityId) ?? [];
    group.push(record);
    recordsByIdentity.set(binding.identityId, group);
  }
  const issues: MainSiteRefreshPlan['issues'] = [];
  for (const [identityId, group] of recordsByIdentity) {
    const owner = ownership.get(identityId);
    if (owner?.deleted) continue;
    const site = sites.get(identityId);
    if (!site || !owner) throw new Error('Source site binding has no canonical ownership');
    const addresses = new Set(group.flatMap((record) => (record.productionAddress ? [record.productionAddress] : [])));
    const previousBindings = bindingsByIdentity.get(identityId) ?? [];
    const sourceOwnsAddress = owner.addressOwner === 'e_ondiris' || owner.addressOwner === 'unclaimed';
    // NULL/absent is no replacement address. That peer keeps its old immutable binding,
    // so moving their shared source-owned site would contradict the retained address.
    const retainsPreviousAddress = previousBindings.some(
      (binding) => recordsByRegistration.get(binding.registrationNumber)?.productionAddress == null,
    );
    if (
      addresses.size > 1 ||
      (sourceOwnsAddress && addresses.size === 1 && [...addresses][0] !== site.address && retainsPreviousAddress)
    ) {
      issues.push({
        code: 'source_site_ambiguous',
        registrationNumbers: previousBindings
          .map((binding) => binding.registrationNumber)
          .sort((a, b) => a.localeCompare(b, 'en')),
      });
      continue;
    }
    if (sourceOwnsAddress && addresses.size === 1) {
      site.address = [...addresses][0]!;
      owner.addressOwner = 'e_ondiris';
    }
    for (const record of group)
      if (record.productionAddress !== null)
        bindings.set(record.registrationNumber, {
          registrationNumber: record.registrationNumber,
          identityId,
          snapshotId: record.id,
        });
  }
  const unboundByAddress = new Map<string, (typeof records)[number][]>();
  for (const record of unbound)
    if (record.productionAddress) {
      const group = unboundByAddress.get(record.productionAddress) ?? [];
      group.push(record);
      unboundByAddress.set(record.productionAddress, group);
    }
  const sitesByAddress = new Map<string, ExistingMainSite[]>();
  for (const site of sites.values())
    if (site.address !== null) {
      const group = sitesByAddress.get(site.address) ?? [];
      group.push(site);
      sitesByAddress.set(site.address, group);
    }
  for (const [address, group] of unboundByAddress) {
    const matching = sitesByAddress.get(address) ?? [];
    if (matching.length > 1) {
      issues.push({
        code: 'source_site_ambiguous',
        registrationNumbers: group.map((record) => record.registrationNumber),
      });
      continue;
    }
    const identityId = matching[0]?.identityId ?? newIdentity();
    if (!matching[0]) {
      sites.set(identityId, { identityId, address, city: null, regionId: null });
      sitesByAddress.set(address, [sites.get(identityId)!]);
      ownership.set(identityId, {
        identityId,
        addressOwner: 'e_ondiris',
        cityOwner: 'unclaimed',
        regionOwner: 'unclaimed',
        deleted: false,
      });
    }
    for (const record of group)
      bindings.set(record.registrationNumber, {
        registrationNumber: record.registrationNumber,
        identityId,
        snapshotId: record.id,
      });
  }
  return { sites: [...sites.values()], ownership: [...ownership.values()], bindings: [...bindings.values()], issues };
}
