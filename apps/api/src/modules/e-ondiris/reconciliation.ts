import type { EOndirisSnapshot } from './ingestion.js';

export interface ExistingProductIdentity {
  identityId: string;
  source: 'manual' | 'e_ondiris';
  registrationNumber: string | null;
  nameEn: string | null;
  nameRu: string | null;
  tnVedCode: string | null;
  productionSiteIdentityId: string | null;
  certificateIdentityIds: readonly string[];
  manufacturerNote: string | null;
  positionInList: number;
}
export interface RegistryProductCandidate {
  /** Null asks the COW transaction to allocate a new stable identity. */
  identityId: string | null;
  replacedManual: boolean;
  snapshot: EOndirisSnapshot;
  productionSiteIdentityId: string | null;
  certificateIdentityIds: readonly string[];
  manufacturerNote: string | null;
  positionInList: number;
}
export interface EOndirisReconciliationIssue {
  code: 'duplicate_registration' | 'ambiguous_manual_match' | 'duplicate_identity' | 'scope_mismatch';
  registrationNumber: string | null;
  identityIds: string[];
}
export type EOndirisReconciliationPlan =
  | { kind: 'ready'; candidates: RegistryProductCandidate[]; untouchedIdentityIds: string[] }
  | { kind: 'ambiguous'; issues: EOndirisReconciliationIssue[] };

/** Same comparison aliases as MAN-25 manual duplicate validation; persisted names remain untouched. */
const nameAlias = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const aliases = (row: Pick<ExistingProductIdentity, 'nameEn' | 'nameRu'>) => [
  ...new Set([row.nameEn, row.nameRu].flatMap((value) => (value === null ? [] : [nameAlias(value)])).filter(Boolean)),
];

/** Pure planning only. A caller must materialize a NEW working/candidate revision under profile locks. */
export function planEOndirisProducts(
  bin: string,
  existing: readonly ExistingProductIdentity[],
  snapshots: readonly EOndirisSnapshot[],
): EOndirisReconciliationPlan {
  const issues: EOndirisReconciliationIssue[] = [];
  const seenIdentity = new Set<string>();
  for (const row of existing) {
    if (seenIdentity.has(row.identityId))
      issues.push({ code: 'duplicate_identity', registrationNumber: null, identityIds: [row.identityId] });
    seenIdentity.add(row.identityId);
  }
  const registrations = new Map<string, EOndirisSnapshot[]>();
  for (const snapshot of snapshots) {
    if (snapshot.facts.bin !== bin)
      issues.push({ code: 'scope_mismatch', registrationNumber: snapshot.facts.registrationNumber, identityIds: [] });
    const bucket = registrations.get(snapshot.facts.registrationNumber) ?? [];
    bucket.push(snapshot);
    registrations.set(snapshot.facts.registrationNumber, bucket);
  }
  for (const [registrationNumber, rows] of registrations)
    if (rows.length > 1) issues.push({ code: 'duplicate_registration', registrationNumber, identityIds: [] });
  const registry = new Map<string, ExistingProductIdentity[]>();
  const manualKeys = new Map<string, ExistingProductIdentity[]>();
  for (const row of existing) {
    if (row.source === 'e_ondiris' && row.registrationNumber !== null) {
      const bucket = registry.get(row.registrationNumber) ?? [];
      bucket.push(row);
      registry.set(row.registrationNumber, bucket);
    } else if (row.source === 'manual' && row.tnVedCode !== null) {
      for (const alias of aliases(row)) {
        const key = JSON.stringify([row.tnVedCode, alias]);
        const bucket = manualKeys.get(key) ?? [];
        bucket.push(row);
        manualKeys.set(key, bucket);
      }
    }
  }
  for (const [registrationNumber, rows] of registry)
    if (rows.length > 1)
      issues.push({ code: 'duplicate_registration', registrationNumber, identityIds: rows.map((r) => r.identityId) });
  const matches = new Map<string, ExistingProductIdentity | null>();
  const manualClaims = new Map<string, string[]>();
  for (const snapshot of snapshots) {
    const registration = snapshot.facts.registrationNumber;
    const byRegistration = registry.get(registration);
    const candidates =
      snapshot.facts.tnVedCode !== null && snapshot.facts.productName !== null
        ? (manualKeys.get(JSON.stringify([snapshot.facts.tnVedCode, nameAlias(snapshot.facts.productName)])) ?? [])
        : [];
    if (byRegistration?.length === 1) {
      // MAN-25: a registry rename/code change cannot silently collide with a separate manual identity.
      // Neither identity nor its local associations may be discarded by preferring registration alone.
      if (candidates.length > 0)
        issues.push({
          code: 'ambiguous_manual_match',
          registrationNumber: registration,
          identityIds: [byRegistration[0]!.identityId, ...candidates.map((row) => row.identityId)],
        });
      matches.set(registration, byRegistration[0]!);
      continue;
    }
    if (candidates.length > 1)
      issues.push({
        code: 'ambiguous_manual_match',
        registrationNumber: registration,
        identityIds: candidates.map((r) => r.identityId),
      });
    const candidate = candidates.length === 1 ? candidates[0]! : null;
    matches.set(registration, candidate);
    if (candidate) {
      const claims = manualClaims.get(candidate.identityId) ?? [];
      claims.push(registration);
      manualClaims.set(candidate.identityId, claims);
    }
  }
  for (const [identityId, claims] of manualClaims)
    if (claims.length > 1)
      for (const registrationNumber of claims)
        issues.push({ code: 'ambiguous_manual_match', registrationNumber, identityIds: [identityId] });
  if (issues.length > 0) return { kind: 'ambiguous', issues };
  const used = new Set<string>();
  let nextPosition = existing.reduce((max, r) => Math.max(max, r.positionInList), -1) + 1;
  const candidates = [...snapshots]
    .sort((a, b) => a.facts.registrationNumber.localeCompare(b.facts.registrationNumber, 'en'))
    .map((snapshot) => {
      const previous = matches.get(snapshot.facts.registrationNumber);
      if (previous) used.add(previous.identityId);
      return {
        identityId: previous?.identityId ?? null,
        replacedManual: previous?.source === 'manual',
        snapshot,
        productionSiteIdentityId: previous?.productionSiteIdentityId ?? null,
        certificateIdentityIds: [...(previous?.certificateIdentityIds ?? [])],
        manufacturerNote: previous?.manufacturerNote ?? null,
        positionInList: previous?.positionInList ?? nextPosition++,
      };
    });
  // An absent upstream row never deletes a local/registry product, its identity, or certificate links.
  return {
    kind: 'ready',
    candidates,
    untouchedIdentityIds: existing.filter((r) => !used.has(r.identityId)).map((r) => r.identityId),
  };
}

export type SourceOwnedValue<T> = { value: T | null; owner: 'manufacturer' | 'adata' | 'e_ondiris' | 'empty' };
/** Contact/site defaults can only replace source/empty values; an explicit manufacturer clear is an edit. */
export function planEOndirisPrefill<T>(current: SourceOwnedValue<T>, sourceValue: T | null): SourceOwnedValue<T> {
  if (current.owner === 'manufacturer' || sourceValue === null) return { ...current };
  return { value: sourceValue, owner: 'e_ondiris' };
}

/** MAN-06/09/10: legal name and the full OKED list are exclusively Adata-owned in v1.4. */
export function adataLegalNameValue(adataName: string | null): {
  kind: 'resolved';
  value: string | null;
  source: 'adata' | null;
} {
  return { kind: 'resolved', value: adataName, source: adataName === null ? null : 'adata' };
}
