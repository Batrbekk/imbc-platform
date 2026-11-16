import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { MainInformationRead } from '@imbc/contracts';
import { and, asc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import {
  adataMainSnapshot,
  mainContactOwnership,
  mainSiteOwnership,
  mainSiteSourceBinding,
  mainSourcePin,
} from '../../database/schema/main-source-ownership.js';
import {
  companyFounder,
  mainInformation,
  mainInformationOked,
  productionSite,
} from '../../database/schema/profile-content.js';
import { productionSiteIdentity } from '../../database/schema/profile.js';
import { dictionary, dictionaryEntry } from '../../database/schema/reference.js';
import { eOndirisRecord, eOndirisSyncScope } from '../../database/schema/e-ondiris.js';
import { companyInfoDataSchema, companyInfoMatchesBin, extractPrefill } from '../adata/company-info.js';
import {
  chooseMainContact,
  initialContactOwnership,
  planMainSiteRefresh,
  refreshMainContact,
  validatedSourceContact,
  type MainContactOwnership,
  type MainSiteOwnership,
  type MainSiteBinding,
  type ExistingMainSite,
} from './main-source-ownership.js';
import type { SectionContext } from './section-handler.js';

type Snapshot = typeof adataMainSnapshot.$inferSelect;
type MainRow = typeof mainInformation.$inferSelect;
type Pin = typeof mainSourcePin.$inferSelect;
const chunks = <T>(rows: readonly T[], size = 1000): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

/** Exact normalized allowed values from the stored response; never provider calls or raw-body persistence. */
export function normalizeAdataMain(
  value: unknown,
  expectedBin: string,
): Pick<typeof adataMainSnapshot.$inferInsert, 'legal' | 'phones' | 'emails'> {
  const rows = extractPrefill(value, { completeLegalLists: true });
  const first = (field: string) => rows.find((row) => row.field === field)?.value ?? null;
  const parsed = companyInfoDataSchema.safeParse(value);
  const basic = parsed.success ? parsed.data.basic : null;
  const founders = parsed.success ? parsed.data.founders : null;
  const text = (value: unknown): string | null => {
    const result =
      typeof value === 'string'
        ? value.trim()
        : typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : '';
    if (/[\u0000\uD800-\uDFFF]/u.test(result)) throw new Error('Adata Main source text is not representable');
    return result || null;
  };
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const oked = new Map<string, { code: string; name: string | null }>();
  for (const item of [...list(basic?.okeds), ...list(basic?.secondary_okeds)]) {
    if (!item || typeof item !== 'object' || !('i' in item)) continue;
    const code = text(item.i);
    if (code === null) continue;
    const name = 'name_ru' in item ? text(item.name_ru) : null;
    const previous = oked.get(code);
    if (previous && previous.name !== name) throw new Error('Adata Main source OKED code has conflicting names');
    oked.set(code, { code, name });
  }
  if (oked.size === 0 && text(basic?.oked) !== null)
    oked.set(text(basic?.oked)!, { code: text(basic?.oked)!, name: null });
  const contacts = parsed.success ? parsed.data.kzCoContact : null;
  const values = (raw: unknown): (string | null)[] =>
    Array.isArray(raw)
      ? raw.map((item) => {
          const candidate =
            typeof item === 'string'
              ? item
              : item && typeof item === 'object' && 'contact' in item
                ? item.contact
                : null;
          return typeof candidate === 'string' ? candidate : null;
        })
      : [];
  const valid = (field: 'companyPhone' | 'contactEmail', raw: unknown): string[] =>
    [
      ...new Set(
        values(raw).flatMap((value) => {
          const result = validatedSourceContact(field, [value]);
          return result.kind === 'value' ? [result.value!] : [];
        }),
      ),
    ].sort();
  const facts = {
    legal: {
      legalName: text(basic?.name_ru) ?? text(basic?.name_kz),
      legalForm: text(basic?.legal_form),
      directorFullName: text(basic?.fullname_director),
      stateRegisteredOn: first('state_registered_on'),
      legalAddress: text(basic?.legal_address) ?? text(basic?.legal_address_kz),
      founders: list(founders?.founders_dtl).flatMap((item) =>
        item && typeof item === 'object' && 'name' in item && text(item.name) !== null ? [text(item.name)!] : [],
      ),
      oked: [...oked.values()],
    },
    phones: valid('companyPhone', contacts?.phones),
    emails: valid('contactEmail', contacts?.emails),
  };
  if (!/^\d{12}$/.test(expectedBin)) throw new Error('Adata Main requested identity is invalid');
  const returnedBin = basic?.biin;
  if (returnedBin === undefined || returnedBin === null) {
    if (
      !companyInfoMatchesBin(value, expectedBin) ||
      Object.entries(facts.legal).some(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== null)) ||
      facts.phones.length ||
      facts.emails.length
    )
      throw new Error('Adata Main facts have no verified source identity');
  } else if (typeof returnedBin !== 'string' || !/^\d{12}$/.test(returnedBin) || returnedBin !== expectedBin) {
    throw new Error('Adata Main returned identity differs from the requested identity');
  }
  return facts;
}

export interface LatestMainAdata {
  attemptId: string | null;
  state: MainInformationRead['source']['state'];
  snapshot: Snapshot | null;
  completedAt: string | null;
}

/** Capture the actual latest committed attempt under the own-profile lock. Completion time comes from the row. */
export async function latestMainAdata(tx: Database, context: SectionContext): Promise<LatestMainAdata> {
  const { rows } = await tx.execute<{
    id: string;
    state: string;
    completedAt: string | null;
    value: unknown;
    bin: string;
  }>(sql`
    select a.id,a.state,to_char(a.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "completedAt",a.value,a.bin
    from external_check c join external_check_attempt a on a.id=c.latest_attempt_id and a.external_check_id=c.id
    join organizations o on o.id=c.organization_id
    where c.profile_id=${context.profileId} and c.organization_id=${context.organizationId}
      and c.connector='adata' and a.bin=o.bin for share of c,a`);
  const attempt = rows[0];
  if (!attempt) return { attemptId: null, state: 'not_requested', snapshot: null, completedAt: null };
  const state =
    attempt.state === 'queued' || attempt.state === 'polling' ? 'waiting' : (attempt.state as LatestMainAdata['state']);
  if (state !== 'received' || !attempt.completedAt)
    return {
      attemptId: attempt.id,
      state: state === 'received' ? 'unavailable' : state,
      snapshot: null,
      completedAt: attempt.completedAt,
    };
  const facts = normalizeAdataMain(attempt.value, attempt.bin);
  const packet = companyInfoDataSchema.safeParse(attempt.value);
  if (!packet.success || packet.data.basic?.biin !== attempt.bin) {
    // {} / all-null is a no-data receipt, not evidence that previously checked legal facts disappeared.
    return { attemptId: attempt.id, state, snapshot: null, completedAt: attempt.completedAt };
  }
  const hash = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
  const [existing] = await tx.select().from(adataMainSnapshot).where(eq(adataMainSnapshot.attemptId, attempt.id));
  if (existing) {
    if (
      existing.contentHash !== hash ||
      existing.organizationId !== context.organizationId ||
      existing.profileId !== context.profileId
    )
      throw new Error('Adata source attempt differs from its immutable Main snapshot');
    return { attemptId: attempt.id, state, snapshot: existing, completedAt: attempt.completedAt };
  }
  const [snapshot] = await tx
    .insert(adataMainSnapshot)
    .values({
      profileId: context.profileId,
      organizationId: context.organizationId,
      bin: attempt.bin,
      attemptId: attempt.id,
      observedAt: sql`${attempt.completedAt}::timestamptz`,
      contentHash: hash,
      ...facts,
    })
    .returning();
  if (!snapshot) throw new Error('Adata Main snapshot insertion failed');
  return { attemptId: attempt.id, state, snapshot, completedAt: attempt.completedAt };
}

export interface MainSourcePlan {
  changed: boolean;
  row: MainRow;
  legal: Snapshot | null;
  pin: Omit<typeof mainSourcePin.$inferInsert, 'id' | 'mainInformationId' | 'organizationId'>;
  contacts: MainContactOwnership[];
  sites: ExistingMainSite[];
  siteOwnership: MainSiteOwnership[];
  siteBindings: MainSiteBinding[];
  issues: { code: string; field?: string; registrationNumbers?: string[] }[];
}

/** Shared by the first-read pin, e-Ondiris source-COW and Adata quarterly source-COW. */
export async function planMainSource(tx: Database, context: SectionContext, fresh = false): Promise<MainSourcePlan> {
  const [row] = await tx
    .select()
    .from(mainInformation)
    .where(
      and(
        eq(mainInformation.sectionRevisionId, context.revisionId),
        eq(mainInformation.organizationId, context.organizationId),
      ),
    );
  if (!row) throw new Error('Main source content is missing');
  const [pin] = await tx
    .select({
      ...getTableColumns(mainSourcePin),
      latestAttemptCompletedAt: sql<
        string | null
      >`to_char(${mainSourcePin.latestAttemptCompletedAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(mainSourcePin)
    .where(and(eq(mainSourcePin.mainInformationId, row.id), eq(mainSourcePin.organizationId, context.organizationId)));
  const { rows: organizations } = await tx.execute<{ bin: string }>(
    sql`select bin from organizations where id=${context.organizationId}`,
  );
  const bin = organizations[0]?.bin;
  if (!bin) throw new Error('Main source BIN is missing');
  // Same profile -> sections -> BIN order as 0024. An ingestion event cannot rewind materialization after a lock wait.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('e-ondiris:bin:' || ${bin},0))`);
  const [scope] = await tx.select().from(eOndirisSyncScope).where(eq(eOndirisSyncScope.bin, bin)).for('update');
  const eo = await tx
    .select()
    .from(eOndirisRecord)
    .where(and(eq(eOndirisRecord.bin, bin), eq(eOndirisRecord.isCurrent, true)));
  const adata = await latestMainAdata(tx, context);
  const ownedContacts = await tx
    .select()
    .from(mainContactOwnership)
    .where(
      and(
        eq(mainContactOwnership.mainInformationId, row.id),
        eq(mainContactOwnership.organizationId, context.organizationId),
      ),
    );
  const contactMap = new Map(ownedContacts.map((owned) => [owned.field, owned]));
  const contacts: MainContactOwnership[] = [];
  const issues: MainSourcePlan['issues'] = [];
  for (const field of ['companyPhone', 'contactEmail'] as const) {
    const old = contactMap.get(field) as MainContactOwnership | undefined;
    const current = old ?? initialContactOwnership(field, row[field], fresh);
    if (current.value !== row[field]) throw new Error('Main source contact ownership is inconsistent');
    const candidate = chooseMainContact(
      field,
      eo.map((record) => ({ id: record.id, value: field === 'companyPhone' ? record.phone : record.email })),
      adata.snapshot
        ? {
            snapshotId: adata.snapshot.id,
            values: field === 'companyPhone' ? adata.snapshot.phones : adata.snapshot.emails,
          }
        : null,
      adata.state !== 'received' && adata.state !== 'not_requested',
    );
    if (candidate.kind === 'ambiguous') issues.push({ code: 'source_contact_ambiguous', field });
    contacts.push(refreshMainContact(current, candidate));
  }
  const currentSites = await tx
    .select({
      identityId: productionSite.identityId,
      address: productionSite.address,
      city: productionSite.city,
      regionId: productionSite.regionId,
    })
    .from(productionSite)
    .where(and(eq(productionSite.mainInformationId, row.id), eq(productionSite.organizationId, context.organizationId)))
    .orderBy(asc(productionSite.positionInList));
  const oldSiteOwners = await tx
    .select()
    .from(mainSiteOwnership)
    .where(
      and(
        eq(mainSiteOwnership.mainInformationId, row.id),
        eq(mainSiteOwnership.organizationId, context.organizationId),
      ),
    );
  const oldBindings = await tx
    .select()
    .from(mainSiteSourceBinding)
    .where(
      and(
        eq(mainSiteSourceBinding.mainInformationId, row.id),
        eq(mainSiteSourceBinding.organizationId, context.organizationId),
      ),
    );
  const sites = planMainSiteRefresh(
    currentSites,
    oldSiteOwners as MainSiteOwnership[],
    oldBindings,
    eo.map((record) => ({
      id: record.id,
      registrationNumber: record.registrationNumber,
      productionAddress: record.productionAddress,
    })),
    randomUUID,
  );
  issues.push(...sites.issues);
  const nextPin = {
    adataSnapshotId: adata.snapshot?.id ?? pin?.adataSnapshotId ?? null,
    latestAttemptId: adata.attemptId,
    latestAttemptCompletedAt: adata.completedAt,
    adataState: adata.state,
    eOndirisObservedAt: scope?.acceptedObservedAt ?? null,
    eOndirisScopeHash: scope?.acceptedScopeHash ?? null,
  };
  const simplePin = (value: Pin) => ({
    adataSnapshotId: value.adataSnapshotId,
    latestAttemptId: value.latestAttemptId,
    latestAttemptCompletedAt: value.latestAttemptCompletedAt,
    adataState: value.adataState,
    eOndirisObservedAt: value.eOndirisObservedAt,
    eOndirisScopeHash: value.eOndirisScopeHash,
  });
  const oldContacts = ownedContacts.map(({ field, owner, value, adataSnapshotId, eOndirisRecordIds }) => ({
    field,
    owner,
    value,
    adataSnapshotId,
    eOndirisRecordIds,
  }));
  const oldOwners = oldSiteOwners.map(({ identityId, addressOwner, cityOwner, regionOwner, deleted }) => ({
    identityId,
    addressOwner,
    cityOwner,
    regionOwner,
    deleted,
  }));
  const oldLinks = oldBindings.map(({ registrationNumber, identityId, snapshotId }) => ({
    registrationNumber,
    identityId,
    snapshotId,
  }));
  const sort = <T>(values: T[]) => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  return {
    changed:
      !pin ||
      !isDeepStrictEqual(simplePin(pin), nextPin) ||
      !isDeepStrictEqual(sort(oldContacts), sort(contacts)) ||
      !isDeepStrictEqual(currentSites, sites.sites) ||
      !isDeepStrictEqual(sort(oldOwners), sort(sites.ownership)) ||
      !isDeepStrictEqual(sort(oldLinks), sort(sites.bindings)),
    row,
    legal: adata.snapshot,
    pin: nextPin,
    contacts,
    sites: sites.sites,
    siteOwnership: sites.ownership,
    siteBindings: sites.bindings,
    issues,
  };
}

async function sourceEntry(tx: Database, kind: string, code: string | null): Promise<string | null> {
  if (code === null) return null;
  const [entry] = await tx
    .select({ id: dictionaryEntry.id })
    .from(dictionaryEntry)
    .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
    .where(and(eq(dictionary.code, kind), isNull(dictionaryEntry.retiredAt), eq(dictionaryEntry.code, code)))
    .for('share', { of: dictionaryEntry });
  return entry?.id ?? null;
}

/** Caller owns an unfrozen working revision and its exact full-value audit/COW transaction. */
export async function applyMainSourcePlan(tx: Database, context: SectionContext, plan: MainSourcePlan): Promise<void> {
  const [target] = await tx
    .select()
    .from(mainInformation)
    .where(
      and(
        eq(mainInformation.sectionRevisionId, context.revisionId),
        eq(mainInformation.organizationId, context.organizationId),
      ),
    );
  if (!target) throw new Error('Target Main source content is missing');
  const legal = plan.legal?.legal;
  await tx
    .update(mainInformation)
    .set({
      companyPhone: plan.contacts.find((owned) => owned.field === 'companyPhone')!.value,
      contactEmail: plan.contacts.find((owned) => owned.field === 'contactEmail')!.value,
      ...(legal
        ? {
            legalName: legal.legalName,
            legalFormId: await sourceEntry(tx, 'legal_form', legal.legalForm),
            legalFormSourceName: legal.legalForm,
            directorFullName: legal.directorFullName,
            stateRegisteredOn: legal.stateRegisteredOn,
            legalAddress: legal.legalAddress,
            legalDataCheckedAt: sql`(select observed_at from adata_main_snapshot where id=${plan.legal!.id})`,
          }
        : {}),
    })
    .where(and(eq(mainInformation.id, target.id), eq(mainInformation.organizationId, context.organizationId)));
  if (legal) {
    await tx.delete(mainInformationOked).where(eq(mainInformationOked.mainInformationId, target.id));
    const entries = new Map<string, string>();
    for (const codes of chunks(legal.oked.map((activity) => activity.code))) {
      const rows = await tx
        .select({ id: dictionaryEntry.id, code: dictionaryEntry.code })
        .from(dictionaryEntry)
        .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
        .where(
          and(eq(dictionary.code, 'oked'), isNull(dictionaryEntry.retiredAt), inArray(dictionaryEntry.code, codes)),
        )
        .for('share', { of: dictionaryEntry });
      for (const entry of rows) entries.set(entry.code, entry.id);
    }
    const activities = legal.oked.map((activity, position) => ({
      mainInformationId: target.id,
      organizationId: context.organizationId,
      code: activity.code,
      sourceName: activity.name,
      okedEntryId: entries.get(activity.code) ?? null,
      position,
    }));
    for (const batch of chunks(activities)) await tx.insert(mainInformationOked).values(batch);
    await tx.delete(companyFounder).where(eq(companyFounder.mainInformationId, target.id));
    for (const batch of chunks(
      legal.founders.map((name, positionInList) => ({
        mainInformationId: target.id,
        organizationId: context.organizationId,
        name,
        positionInList,
      })),
    ))
      await tx.insert(companyFounder).values(batch);
  }
  for (const table of [mainSourcePin, mainContactOwnership, mainSiteOwnership, mainSiteSourceBinding])
    await tx.delete(table).where(eq(table.mainInformationId, target.id));
  await tx
    .insert(mainSourcePin)
    .values({ mainInformationId: target.id, organizationId: context.organizationId, ...plan.pin });
  await tx.insert(mainContactOwnership).values(
    plan.contacts.map((owned) => ({
      mainInformationId: target.id,
      organizationId: context.organizationId,
      ...owned,
    })),
  );
  const knownIdentities = new Set(
    (
      await tx.execute<{ id: string }>(
        sql`select id from production_site_identity where profile_id=${context.profileId} and organization_id=${context.organizationId}`,
      )
    ).rows.map((row) => row.id),
  );
  for (const batch of chunks(
    plan.sites
      .filter((site) => !knownIdentities.has(site.identityId))
      .map((site) => ({ id: site.identityId, profileId: context.profileId, organizationId: context.organizationId })),
  ))
    await tx.insert(productionSiteIdentity).values(batch);
  await tx
    .delete(productionSite)
    .where(
      and(eq(productionSite.mainInformationId, target.id), eq(productionSite.organizationId, context.organizationId)),
    );
  for (const batch of chunks(
    plan.sites.map((site, positionInList) => ({
      ...site,
      mainInformationId: target.id,
      organizationId: context.organizationId,
      positionInList,
    })),
  ))
    await tx.insert(productionSite).values(batch);
  for (const batch of chunks(
    plan.siteOwnership.map((owned) => ({
      ...owned,
      mainInformationId: target.id,
      organizationId: context.organizationId,
    })),
  ))
    await tx.insert(mainSiteOwnership).values(batch);
  for (const batch of chunks(
    plan.siteBindings.map((binding) => ({
      ...binding,
      mainInformationId: target.id,
      organizationId: context.organizationId,
    })),
  ))
    await tx.insert(mainSiteSourceBinding).values(batch);
}
