import { z } from 'zod';
import { profileFileSchema } from './profile-files.js';
import { sectionReadSchema, sectionSaveInputSchema } from './profile-sections.js';

/** MAN-17–18: nullable partial drafts; the integer ceiling is PostgreSQL's storage boundary. */
export const personnelCountSchema = z.number().int().min(0).max(2_147_483_647).nullable();
const fileIdSchema = z.uuid().transform((id) => id.toLowerCase());

export const personnelWriteSchema = z
  .strictObject({
    managersCount: personnelCountSchema,
    engineersCount: personnelCountSchema,
    productionWorkersCount: personnelCountSchema,
    nonresidentCount: personnelCountSchema,
    organisationChartIds: z.array(fileIdSchema),
    cvFileIds: z.array(fileIdSchema),
  })
  .superRefine((input, ctx) => {
    const counts = [input.managersCount, input.engineersCount, input.productionWorkersCount];
    if (counts.every((count) => count !== null) && input.nonresidentCount !== null) {
      const total = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
      if (input.nonresidentCount > total)
        ctx.addIssue({ code: 'custom', message: 'nonresident_exceeds_total', path: ['nonresidentCount'] });
    }
    const seen = new Set<string>();
    for (const field of ['organisationChartIds', 'cvFileIds'] as const)
      input[field].forEach((id, index) => {
        if (seen.has(id)) ctx.addIssue({ code: 'custom', message: 'duplicate_file', path: [field, index] });
        seen.add(id);
      });
  });
export type PersonnelWrite = z.infer<typeof personnelWriteSchema>;

/** MAN-17: total is computed, never writable; file IDs stay stable across section revisions. */
export const personnelReadSchema = z.strictObject({
  editable: personnelWriteSchema,
  totalHeadcount: z
    .number()
    .int()
    .min(0)
    .max(3 * 2_147_483_647)
    .nullable(),
  organisationCharts: z.array(profileFileSchema),
  cvs: z.array(profileFileSchema),
});
export type PersonnelRead = z.infer<typeof personnelReadSchema>;
export const ownPersonnelSchema = sectionReadSchema(personnelReadSchema);
export const savePersonnelSchema = sectionSaveInputSchema(personnelWriteSchema);
