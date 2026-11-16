import { z } from 'zod';
import { csv } from './catalog.js';
import { PROFILE_STATUSES } from './enums.js';
import { SECTION_KINDS, SECTION_REVISION_STATES } from './profile-sections.js';
import { profileReviewDecisionSchema, profileReviewSubjectSchema } from './profile-submission.js';
import { profileOwnReviewDecisionSchema, profileOwnReviewItemLabelSchema } from './profile-review-details.js';
import { mainInformationReadSchema } from './profile-main.js';
import { contactsReadSchema } from './profile-contacts.js';
import { personnelReadSchema } from './profile-personnel.js';
import { productsReadSchema, productReferenceSchema } from './profile-products.js';
import { productionReadSchema } from './profile-production.js';
import { certificatesReadSchema } from './profile-certificates.js';
import { documentsReadSchema } from './profile-documents.js';

export const QUEUE_STATUSES = ['submitted', 'under_review', 'pending_changes'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
export const REVIEW_WORKFLOW_ERROR_CODES = [
  'assignment_changed',
  'review_incomplete',
  'review_subject_not_found',
  'review_section_changed',
  'review_items_incomplete',
  'review_section_not_required',
  'review_not_opened',
  'review_expert_unavailable',
  'submission_file_unavailable',
  'submission_graph_invalid',
  'busy',
  'forbidden',
  'validation',
  'not_found',
] as const;
const uuid = z.uuid();
const timestamp = z.iso.datetime({ precision: 6 });
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !/[\u0000\uD800-\uDFFF]/u.test(value), { message: 'text_format' });
const assignee = csv(z.union([uuid, z.literal('unassigned')]));
const queueDate = z.iso.date().refine((value) => !value.startsWith('0000-'), { message: 'date_year' });
const queueOffset = z.coerce.number().int().min(0).max(2_147_483_647);
const filterFields = {
  status: csv(z.enum(QUEUE_STATUSES)),
  q: text(200).trim().optional(),
  assignee,
  offset: queueOffset.default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
export const reviewQueueFilterSchema = z
  .strictObject({
    ...filterFields,
    receivedFrom: queueDate.optional(),
    receivedTo: queueDate.optional(),
  })
  .refine((value) => !value.receivedFrom || !value.receivedTo || value.receivedFrom <= value.receivedTo, {
    message: 'date_range_order',
  });
export type ReviewQueueFilter = z.infer<typeof reviewQueueFilterSchema>;
export const reviewAssignmentQueueFilterSchema = z.strictObject(filterFields);
export type ReviewAssignmentQueueFilter = z.infer<typeof reviewAssignmentQueueFilterSchema>;

// R1 read-client subset remains explicit. Operational clients use the strict schema below.
export const reviewQueueItemSchema = z.object({
  profileId: uuid,
  organizationName: z.string(),
  bin: z.string(),
  status: z.enum(PROFILE_STATUSES),
  hasPendingChanges: z.boolean(),
  assignedExpert: z.string().nullable(),
  registeredAt: z.string(),
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;
export const reviewQueueSchema = z.object({
  items: z.array(reviewQueueItemSchema),
  total: z.number().int().nonnegative(),
});
export type ReviewQueue = z.infer<typeof reviewQueueSchema>;

const assignmentMetadata = {
  profileId: uuid,
  organizationName: text(10_000),
  status: z.enum(PROFILE_STATUSES),
  hasPendingChanges: z.boolean(),
  assignmentId: uuid.nullable(),
  assignedExpertId: uuid.nullable(),
  assignedExpert: text(10_000).nullable(),
  unresolved: z.boolean(),
};
export const reviewOperationalQueueItemSchema = z
  .strictObject({
    ...assignmentMetadata,
    bin: z.string().nullable(),
    registeredAt: z.iso.datetime(),
    receivedAt: timestamp.nullable(),
  })
  .refine(
    (row) =>
      row.unresolved === (row.assignmentId === null) && (row.assignmentId === null) === (row.receivedAt === null),
    { message: 'assignment_receipt_mismatch' },
  );
export type ReviewOperationalQueueItem = z.infer<typeof reviewOperationalQueueItemSchema>;
export const reviewOperationalQueueSchema = z.strictObject({
  items: z.array(reviewOperationalQueueItemSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(100),
});
export type ReviewOperationalQueue = z.infer<typeof reviewOperationalQueueSchema>;
export const reviewAssignmentMetadataSchema = z
  .strictObject(assignmentMetadata)
  .refine((row) => row.unresolved === (row.assignmentId === null), { message: 'assignment_identity_mismatch' });
export type ReviewAssignmentMetadata = z.infer<typeof reviewAssignmentMetadataSchema>;
export const reviewAssignmentQueueSchema = z.strictObject({
  items: z.array(reviewAssignmentMetadataSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(100),
});
export type ReviewAssignmentQueue = z.infer<typeof reviewAssignmentQueueSchema>;
export const reviewExpertOptionsSchema = z.array(z.strictObject({ id: uuid, label: text(10_000) }));
export type ReviewExpertOptions = z.infer<typeof reviewExpertOptionsSchema>;
export const reviewTakeInputSchema = z.strictObject({});
export const reviewAssignInputSchema = z.strictObject({ expertId: uuid, expectedExpertId: uuid.nullable() });
export type ReviewAssignInput = z.infer<typeof reviewAssignInputSchema>;

const evidenceSchema = z
  .strictObject({
    subject: profileReviewSubjectSchema,
    stableIdentityId: uuid.nullable(),
    fileObjectId: uuid.nullable(),
    label: profileOwnReviewItemLabelSchema.nullable(),
    decision: profileOwnReviewDecisionSchema.nullable(),
  })
  .refine((item) => (item.subject.kind === 'section' ? item.label === null : item.label?.kind === item.subject.kind), {
    message: 'review_evidence_label_mismatch',
  });
const sectionMetadata = {
  kind: z.enum(SECTION_KINDS),
  revisionId: uuid,
  revisionState: z.enum(SECTION_REVISION_STATES),
  reviewRequired: z.boolean(),
  retainedDecisionId: uuid.nullable(),
  completenessPct: z.number().min(0).max(100),
  decision: profileOwnReviewDecisionSchema.nullable(),
  items: z.array(evidenceSchema),
};
export const reviewWorkbenchSchema = z
  .strictObject({
    profileId: uuid,
    organizationName: text(10_000),
    profileStatus: z.enum(PROFILE_STATUSES),
    hasPendingChanges: z.boolean(),
    assignment: z.strictObject({ id: uuid, expertId: uuid, receivedAt: timestamp, assignedAt: timestamp }),
    sections: z.array(z.strictObject(sectionMetadata)).length(SECTION_KINDS.length),
    canSubmitResult: z.boolean(),
  })
  .superRefine((value, context) => {
    if (new Set(value.sections.map((section) => section.kind)).size !== SECTION_KINDS.length)
      context.addIssue({ code: 'custom', message: 'review_sections_mismatch' });
    for (const section of value.sections) {
      if (!section.reviewRequired && section.retainedDecisionId === null)
        context.addIssue({ code: 'custom', message: 'review_retained_mismatch' });
      if (section.items.some((item) => item.subject.kind === 'section'))
        context.addIssue({ code: 'custom', message: 'section_is_not_item' });
    }
  });
export type ReviewWorkbench = z.infer<typeof reviewWorkbenchSchema>;
const dataBranch = <K extends (typeof SECTION_KINDS)[number], S extends z.ZodType>(kind: K, data: S) =>
  z.strictObject({ ...sectionMetadata, kind: z.literal(kind), data });
export const reviewSectionReadSchema = z.discriminatedUnion('kind', [
  dataBranch('main_information', mainInformationReadSchema),
  dataBranch('contacts', contactsReadSchema).extend({ selectedContactRoles: z.array(productReferenceSchema) }),
  dataBranch('personnel', personnelReadSchema),
  dataBranch('products', productsReadSchema),
  dataBranch('production', productionReadSchema),
  dataBranch('certificates', certificatesReadSchema),
  dataBranch('documents', documentsReadSchema),
]);
export type ReviewSectionRead = z.infer<typeof reviewSectionReadSchema>;
export const reviewSectionDecisionInputSchema = z
  .strictObject({
    sectionRevisionId: uuid,
    expectedDecisionId: uuid.nullable(),
    outcome: z.enum(['verified', 'rejected']),
    comment: text(10_000)
      .trim()
      .nullable()
      .transform((value) => value || null),
    items: z
      .array(z.strictObject({ subject: profileReviewSubjectSchema, outcome: z.enum(['verified', 'rejected']) }))
      .max(10_000),
  })
  .superRefine((value, context) => {
    if ((value.outcome === 'rejected' || value.items.some((item) => item.outcome === 'rejected')) && !value.comment)
      context.addIssue({ code: 'custom', path: ['comment'], message: 'rejected_comment_required' });
    const keys = new Set<string>();
    for (const item of value.items) {
      const key = JSON.stringify(item.subject);
      if (item.subject.kind === 'section' || keys.has(key))
        context.addIssue({ code: 'custom', message: 'invalid_or_duplicate_item' });
      keys.add(key);
    }
  });
export type ReviewSectionDecisionInput = z.infer<typeof reviewSectionDecisionInputSchema>;
export const reviewSectionDecisionResultSchema = z.strictObject({
  assignmentId: uuid,
  sectionRevisionId: uuid,
  decisions: z.array(profileReviewDecisionSchema).min(1),
});
export type ReviewSectionDecisionResult = z.infer<typeof reviewSectionDecisionResultSchema>;
export const reviewSubmitResultInputSchema = z.strictObject({});
export const reviewSubmitResultSchema = z.strictObject({
  profileId: uuid,
  assignmentId: uuid,
  profileStatus: z.enum(['verified', 'returned']),
  closedAt: z.iso.datetime(),
  publishKinds: z.array(z.enum(SECTION_KINDS)),
  retainKinds: z.array(z.enum(SECTION_KINDS)),
});
export type ReviewSubmitResult = z.infer<typeof reviewSubmitResultSchema>;
