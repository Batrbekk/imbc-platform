import { mainInformationWriteSchema, type MainInformationWrite } from '@imbc/contracts';
import type { EOndirisSnapshot } from './ingestion.js';

export interface EOndirisInitialMainPlan {
  companyPhone: string | null;
  contactEmail: string | null;
  addedAddresses: string[];
  issues: ('phone_invalid' | 'phone_ambiguous' | 'email_invalid' | 'email_ambiguous' | 'address_invalid')[];
}

/** Bounded initial defaults only. Later per-field refresh requires durable ownership, not editVersion heuristics. */
export function planEOndirisInitialMain(
  current: MainInformationWrite,
  revision: { editVersion: number; savedAt: Date | null; state: string },
  snapshots: readonly EOndirisSnapshot[],
): EOndirisInitialMainPlan {
  const plan: EOndirisInitialMainPlan = {
    companyPhone: current.companyPhone,
    contactEmail: current.contactEmail,
    addedAddresses: [],
    issues: [],
  };
  if (revision.state !== 'working' || revision.editVersion !== 0 || revision.savedAt !== null) return plan;
  const contacts = (field: 'companyPhone' | 'contactEmail', rawField: 'phone' | 'email') => {
    const values = new Set<string>();
    let invalid = false;
    for (const snapshot of snapshots) {
      const value = snapshot.facts[rawField];
      if (value === null) continue;
      const parsed = mainInformationWriteSchema.safeParse({
        website: null,
        companyPhone: null,
        contactEmail: null,
        sites: [],
        [field]: value,
      });
      if (!parsed.success) {
        invalid = true;
        continue;
      }
      const normalized = parsed.data[field];
      if (normalized !== null) values.add(normalized);
    }
    if (invalid) plan.issues.push(rawField === 'phone' ? 'phone_invalid' : 'email_invalid');
    if (values.size > 1) plan.issues.push(rawField === 'phone' ? 'phone_ambiguous' : 'email_ambiguous');
    // Invalid/conflicting source data never becomes an arbitrary accepted contact default.
    return !invalid && values.size === 1 ? [...values][0]! : null;
  };
  plan.companyPhone ??= contacts('companyPhone', 'phone');
  plan.contactEmail ??= contacts('contactEmail', 'email');
  const existing = new Set(current.sites.flatMap((site) => (site.address === null ? [] : [site.address])));
  for (const snapshot of snapshots) {
    const address = snapshot.facts.productionAddress;
    if (address === null || existing.has(address)) continue;
    const parsed = mainInformationWriteSchema.safeParse({
      website: null,
      companyPhone: null,
      contactEmail: null,
      sites: [{ identityId: null, address, city: null, regionId: null }],
    });
    if (!parsed.success) {
      plan.issues.push('address_invalid');
      continue;
    }
    plan.addedAddresses.push(address);
    existing.add(address);
  }
  return plan;
}
