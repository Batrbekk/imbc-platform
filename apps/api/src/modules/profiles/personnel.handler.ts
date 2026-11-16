import {
  personnelReadSchema,
  personnelWriteSchema,
  type CompletenessInput,
  type PersonnelRead,
  type PersonnelWrite,
} from '@imbc/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { personnel, personnelCv, personnelOrgChart } from '../../database/schema/index.js';
import { profileFileComplete, profileFiles, validateProfileFileBindings } from './profile-files.js';
import type { SectionContext, TypedSectionHandler } from './section-handler.js';

/** MAN-17–20: own manufacturer-entered counts and ordered file references, with no source prefill. */
@Injectable()
export class PersonnelHandler implements TypedSectionHandler<PersonnelWrite, PersonnelRead> {
  readonly kind = 'personnel' as const;
  readonly readSchema = personnelReadSchema;

  parse(input: unknown): PersonnelWrite {
    return personnelWriteSchema.parse(input);
  }

  private async row(tx: Database, context: SectionContext) {
    const [row] = await tx
      .select()
      .from(personnel)
      .where(
        and(eq(personnel.sectionRevisionId, context.revisionId), eq(personnel.organizationId, context.organizationId)),
      );
    return row;
  }

  async editable(tx: Database, context: SectionContext): Promise<PersonnelWrite> {
    const row = await this.row(tx, context);
    const organisationChartIds = row
      ? (
          await tx
            .select({ fileId: personnelOrgChart.fileObjectId })
            .from(personnelOrgChart)
            .where(
              and(
                eq(personnelOrgChart.personnelId, row.id),
                eq(personnelOrgChart.organizationId, context.organizationId),
              ),
            )
            .orderBy(asc(personnelOrgChart.positionInList))
        ).map(({ fileId }) => fileId)
      : [];
    const cvFileIds = row
      ? (
          await tx
            .select({ fileId: personnelCv.fileObjectId })
            .from(personnelCv)
            .where(and(eq(personnelCv.personnelId, row.id), eq(personnelCv.organizationId, context.organizationId)))
            .orderBy(asc(personnelCv.positionInList))
        ).map(({ fileId }) => fileId)
      : [];
    return {
      managersCount: row?.managersCount ?? null,
      engineersCount: row?.engineersCount ?? null,
      productionWorkersCount: row?.productionWorkersCount ?? null,
      nonresidentCount: row?.nonresidentCount ?? null,
      organisationChartIds,
      cvFileIds,
    };
  }

  async read(tx: Database, context: SectionContext): Promise<PersonnelRead> {
    const editable = await this.editable(tx, context);
    const { managersCount, engineersCount, productionWorkersCount } = editable;
    return {
      editable,
      totalHeadcount:
        managersCount !== null && engineersCount !== null && productionWorkersCount !== null
          ? managersCount + engineersCount + productionWorkersCount
          : null,
      organisationCharts: await profileFiles(tx, context, editable.organisationChartIds),
      cvs: await profileFiles(tx, context, editable.cvFileIds),
    };
  }

  async save(tx: Database, context: SectionContext, input: PersonnelWrite): Promise<void> {
    await validateProfileFileBindings(tx, context, [
      ...input.organisationChartIds.map((fileId, index) => ({
        fileId,
        purposes: ['organisation_chart'] as const,
        path: `organisationChartIds.${index}`,
      })),
      ...input.cvFileIds.map((fileId, index) => ({
        fileId,
        purposes: ['cv'] as const,
        path: `cvFileIds.${index}`,
      })),
    ]);
    const counts = {
      managersCount: input.managersCount,
      engineersCount: input.engineersCount,
      productionWorkersCount: input.productionWorkersCount,
      nonresidentCount: input.nonresidentCount,
    };
    const [saved] = await tx
      .insert(personnel)
      .values({
        sectionRevisionId: context.revisionId,
        organizationId: context.organizationId,
        ...counts,
      })
      .onConflictDoUpdate({ target: personnel.sectionRevisionId, set: counts })
      .returning({ id: personnel.id });
    if (!saved) throw new Error('Saved personnel row is missing');
    await tx
      .delete(personnelOrgChart)
      .where(
        and(eq(personnelOrgChart.personnelId, saved.id), eq(personnelOrgChart.organizationId, context.organizationId)),
      );
    await tx
      .delete(personnelCv)
      .where(and(eq(personnelCv.personnelId, saved.id), eq(personnelCv.organizationId, context.organizationId)));
    for (let start = 0; start < input.organisationChartIds.length; start += 1000)
      await tx.insert(personnelOrgChart).values(
        input.organisationChartIds.slice(start, start + 1000).map((fileObjectId, index) => ({
          personnelId: saved.id,
          organizationId: context.organizationId,
          fileObjectId,
          positionInList: start + index,
        })),
      );
    for (let start = 0; start < input.cvFileIds.length; start += 1000)
      await tx.insert(personnelCv).values(
        input.cvFileIds.slice(start, start + 1000).map((fileObjectId, index) => ({
          personnelId: saved.id,
          organizationId: context.organizationId,
          fileObjectId,
          positionInList: start + index,
        })),
      );
  }

  async mandatoryInputs(tx: Database, context: SectionContext): Promise<CompletenessInput[]> {
    const data = await this.read(tx, context);
    return [
      ...(['managersCount', 'engineersCount', 'productionWorkersCount', 'nonresidentCount'] as const).map((field) => ({
        path: field,
        code: 'required',
        satisfied: data.editable[field] !== null,
      })),
      {
        path: 'organisationChartIds',
        code: 'organisation_chart_required',
        satisfied: data.organisationCharts.some(profileFileComplete),
      },
    ];
  }
}
