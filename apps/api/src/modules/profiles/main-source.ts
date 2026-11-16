import type { MainInformationRead } from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { adataMainSnapshot, mainSourcePin } from '../../database/schema/main-source-ownership.js';
import type { mainInformation } from '../../database/schema/profile-content.js';
import type { SectionContext } from './section-handler.js';

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

/** MAN-06/07: GET uses this revision's immutable source choice, never the latest Adata attempt. */
export async function pinnedMainSource(
  tx: Database,
  context: SectionContext,
  row: typeof mainInformation.$inferSelect | undefined,
): Promise<MainInformationRead['source']> {
  if (!row) return { state: 'not_requested', readAt: null, provenance: null };
  const [pin] = await tx
    .select()
    .from(mainSourcePin)
    .where(and(eq(mainSourcePin.mainInformationId, row.id), eq(mainSourcePin.organizationId, context.organizationId)));
  if (!pin)
    return row.legalDataCheckedAt
      ? { state: 'received', readAt: row.legalDataCheckedAt.toISOString(), provenance: 'adata' }
      : { state: 'not_requested', readAt: null, provenance: row.legalName ? 'migration' : null };
  const [snapshot] = pin.adataSnapshotId
    ? await tx
        .select()
        .from(adataMainSnapshot)
        .where(
          and(
            eq(adataMainSnapshot.id, pin.adataSnapshotId),
            eq(adataMainSnapshot.organizationId, context.organizationId),
          ),
        )
    : [];
  return {
    state: pin.adataState as MainInformationRead['source']['state'],
    readAt: snapshot?.observedAt.toISOString() ?? row.legalDataCheckedAt?.toISOString() ?? null,
    provenance: snapshot || row.legalDataCheckedAt ? 'adata' : row.legalName ? 'migration' : null,
  };
}
