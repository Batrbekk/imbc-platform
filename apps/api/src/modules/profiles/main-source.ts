import { type MainInformationRead, type MainInformationWrite, mainInformationWriteSchema } from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { externalCheck, externalCheckAttempt } from '../../database/schema/index.js';
import { extractPrefill } from '../adata/company-info.js';
import type { SectionContext } from './section-handler.js';

export interface StoredMainSource {
  source: MainInformationRead['source'];
  legalInformation: MainInformationRead['legalInformation'];
  contactDefaults: Pick<MainInformationWrite, 'companyPhone' | 'contactEmail'>;
}

export const emptyLegalInformation = (): MainInformationRead['legalInformation'] => ({
  legalName: null,
  alternativeName: null,
  legalForm: null,
  directorFullName: null,
  stateRegisteredOn: null,
  legalAddress: null,
  founders: [],
  oked: [],
});

/**
 * MAN-06–10: only already stored Adata data. No connector, quota or job call. Used for the
 * first working revision only; frozen reads use main_information and its children.
 * Complete legal lists are extracted from the retained response, since legacy prefilled_value
 * limits lists to 50. Raw source payload, tokens and diagnostic failures never leave this adapter.
 */
export async function storedMainSource(tx: Database, context: SectionContext): Promise<StoredMainSource> {
  const [attempt] = await tx
    .select({
      state: externalCheckAttempt.state,
      completedAt: externalCheckAttempt.completedAt,
      value: externalCheckAttempt.value,
    })
    .from(externalCheck)
    .leftJoin(externalCheckAttempt, and(eq(externalCheckAttempt.id, externalCheck.latestAttemptId), eq(externalCheckAttempt.externalCheckId, externalCheck.id)))
    .where(
      and(
        eq(externalCheck.profileId, context.profileId),
        eq(externalCheck.organizationId, context.organizationId),
        eq(externalCheck.connector, 'adata'),
      ),
    );
  const empty = {
    legalInformation: emptyLegalInformation(),
    contactDefaults: { companyPhone: null, contactEmail: null },
  };
  if (!attempt?.state) return { ...empty, source: { state: 'not_requested', readAt: null, provenance: null } };
  if (attempt.state !== 'received')
    return {
      ...empty,
      source: {
        state: attempt.state === 'queued' || attempt.state === 'polling' ? 'waiting' : attempt.state,
        readAt: null,
        provenance: null,
      },
    };
  const rows = extractPrefill(attempt.value, { completeLegalLists: true });
  const first = (field: string) => rows.find((row) => row.field === field)?.value ?? null;
  const validDefaults = mainInformationWriteSchema.safeParse({
    website: null,
    companyPhone: first('company_phone'),
    contactEmail: first('company_email'),
    sites: [],
  });
  // A malformed source contact is not saved as a validated manufacturer value.
  const phone = mainInformationWriteSchema.safeParse({
    website: null,
    companyPhone: first('company_phone'),
    contactEmail: null,
    sites: [],
  });
  const email = mainInformationWriteSchema.safeParse({
    website: null,
    companyPhone: null,
    contactEmail: first('company_email'),
    sites: [],
  });
  return {
    source: { state: 'received', readAt: attempt.completedAt?.toISOString() ?? null, provenance: 'adata' },
    legalInformation: {
      legalName: first('legal_name'),
      alternativeName: null,
      legalForm: first('legal_form'),
      directorFullName: first('director_full_name'),
      stateRegisteredOn: first('state_registered_on'),
      legalAddress: first('legal_address'),
      founders: rows.filter((row) => row.field === 'shareholders').map((row) => row.value),
      oked: rows.filter((row) => row.field === 'activity').map((row) => ({ code: row.value, name: row.label })),
    },
    contactDefaults: validDefaults.success
      ? { companyPhone: validDefaults.data.companyPhone, contactEmail: validDefaults.data.contactEmail }
      : {
          companyPhone: phone.success ? phone.data.companyPhone : null,
          contactEmail: email.success ? email.data.contactEmail : null,
        },
  };
}
