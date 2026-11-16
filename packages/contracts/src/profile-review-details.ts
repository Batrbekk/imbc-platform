import { z } from 'zod';
import { SECTION_KINDS } from './profile-sections.js';
import { profileReviewSubjectSchema } from './profile-submission.js';

const uuid = z.uuid();
const typeLabel = z.strictObject({
  code: z.string(),
  names: z.strictObject({ en: z.string().nullable(), ru: z.string().nullable(), kk: z.string().nullable() }),
});
/** Row labels come from the reviewed revision; file labels come from its captured exact version. */
export const profileOwnReviewItemLabelSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('document'),
    positionInList: z.number().int().nonnegative(),
    type: typeLabel.nullable(),
    customName: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal('certificate'),
    positionInList: z.number().int().nonnegative(),
    type: typeLabel.nullable(),
    number: z.string().nullable(),
    customTypeName: z.string().nullable(),
  }),
  z.strictObject({ kind: z.literal('file'), originalName: z.string() }),
]);
export type ProfileOwnReviewItemLabel = z.infer<typeof profileOwnReviewItemLabelSchema>;
export const profileOwnReviewDecisionSchema = z.strictObject({
  id: uuid,
  outcome: z.enum(['verified', 'rejected']),
  comment: z.string().nullable(),
  decidedAt: z.iso.datetime(),
});
/** Historical comments remain attached to their exact reviewed row, even after a manufacturer COW. */
export const profileOwnReviewDetailsSchema = z
  .strictObject({
    profileId: uuid,
    assignment: z
      .strictObject({
        id: uuid,
        receivedAt: z.iso.datetime(),
        closedAt: z.iso.datetime().nullable(),
        expertId: uuid.nullable(),
      })
      .nullable(),
    sections: z
      .array(
        z.strictObject({
          kind: z.enum(SECTION_KINDS),
          currentRevisionId: uuid.nullable(),
          reviewedRevisionId: uuid.nullable(),
          reviewRequired: z.boolean().nullable(),
          appliesToCurrentRevision: z.boolean(),
          decision: profileOwnReviewDecisionSchema.nullable(),
          items: z.array(
            z.strictObject({
              subject: profileReviewSubjectSchema,
              stableIdentityId: uuid.nullable(),
              fileObjectId: uuid.nullable(),
              label: profileOwnReviewItemLabelSchema,
              decision: profileOwnReviewDecisionSchema.nullable(),
            }),
          ),
        }),
      )
      .length(SECTION_KINDS.length),
  })
  .superRefine((value, context) => {
    if (new Set(value.sections.map((section) => section.kind)).size !== SECTION_KINDS.length)
      context.addIssue({ code: 'custom', path: ['sections'], message: 'duplicate_section' });
    for (const [index, section] of value.sections.entries()) {
      if (
        section.appliesToCurrentRevision !==
        (section.reviewedRevisionId !== null && section.reviewedRevisionId === section.currentRevisionId)
      )
        context.addIssue({
          code: 'custom',
          path: ['sections', index, 'appliesToCurrentRevision'],
          message: 'invalid_revision_context',
        });
      if (section.items.some((item) => item.subject.kind === 'section'))
        context.addIssue({ code: 'custom', path: ['sections', index, 'items'], message: 'invalid_item_subject' });
      if (section.items.some((item) => item.subject.kind !== item.label.kind))
        context.addIssue({ code: 'custom', path: ['sections', index, 'items'], message: 'invalid_item_label' });
    }
  });
export type ProfileOwnReviewDetails = z.infer<typeof profileOwnReviewDetailsSchema>;
