import { z } from 'zod';
import { PROFILE_STATUSES } from './enums.js';
import { SECTION_KINDS } from './profile-sections.js';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const editVersion = z.number().int().min(0).max(2_147_483_647);

/** A Send confirms the exact seven revisions the manufacturer viewed, not client-provided completeness. */
export const profileSubmissionVersionSchema = z.strictObject({
  kind: z.enum(SECTION_KINDS),
  revisionId: uuid,
  editVersion,
});
export const profileSubmissionVersionsSchema = z
  .array(profileSubmissionVersionSchema)
  .length(SECTION_KINDS.length)
  .superRefine((sections, context) => {
    const kinds = new Set<string>();
    const revisions = new Set<string>();
    sections.forEach((section, position) => {
      if (kinds.has(section.kind))
        context.addIssue({ code: 'custom', path: [position, 'kind'], message: 'duplicate_section' });
      if (revisions.has(section.revisionId))
        context.addIssue({ code: 'custom', path: [position, 'revisionId'], message: 'duplicate_revision' });
      kinds.add(section.kind);
      revisions.add(section.revisionId);
    });
  });

export const PROFILE_SUBMISSION_MODES = ['initial', 'resubmit', 'verified_changes'] as const;
export type ProfileSubmissionMode = (typeof PROFILE_SUBMISSION_MODES)[number];

/** Accuracy is explicitly true on every new Send; replay is scoped to operation key + canonical request. */
export const profileSubmitInputSchema = z.strictObject({
  operationKey: uuid,
  accuracyConfirmed: z.literal(true),
  expectedSections: profileSubmissionVersionsSchema,
});
export type ProfileSubmitInput = z.infer<typeof profileSubmitInputSchema>;

/** Own-profile target and reviewer are server-derived; the assignment guards stale Unlock requests. */
export const profileUnlockInputSchema = z.strictObject({ operationKey: uuid, expectedAssignmentId: uuid });
export type ProfileUnlockInput = z.infer<typeof profileUnlockInputSchema>;

const submittedSectionSchema = z
  .strictObject({
    kind: z.enum(SECTION_KINDS),
    revisionId: uuid,
    reviewRequired: z.boolean(),
    retainedDecisionId: uuid.nullable(),
  })
  .superRefine((section, context) => {
    // An incomplete unchanged Unlock source may keep a section decision while still needing item review.
    if (!section.reviewRequired && section.retainedDecisionId === null)
      context.addIssue({ code: 'custom', path: ['retainedDecisionId'], message: 'invalid_retained_decision' });
  });

export const profileSubmitResultSchema = z
  .strictObject({
    profileId: uuid,
    profileStatus: z.enum(['submitted', 'verified']),
    assignmentId: uuid,
    receivedAt: z.iso.datetime(),
    mode: z.enum(PROFILE_SUBMISSION_MODES),
    sections: z.array(submittedSectionSchema).length(SECTION_KINDS.length),
  })
  .superRefine((result, context) => {
    const kinds = new Set(result.sections.map((section) => section.kind));
    if (kinds.size !== SECTION_KINDS.length)
      context.addIssue({ code: 'custom', path: ['sections'], message: 'duplicate_section' });
    if (new Set(result.sections.map((section) => section.revisionId)).size !== SECTION_KINDS.length)
      context.addIssue({ code: 'custom', path: ['sections'], message: 'duplicate_revision' });
    const decisions = result.sections.flatMap((section) =>
      section.retainedDecisionId ? [section.retainedDecisionId] : [],
    );
    if (new Set(decisions).size !== decisions.length)
      context.addIssue({ code: 'custom', path: ['sections'], message: 'duplicate_retained_decision' });
    if ((result.mode === 'verified_changes') !== (result.profileStatus === 'verified'))
      context.addIssue({ code: 'custom', path: ['profileStatus'], message: 'invalid_submission_state' });
  });
export type ProfileSubmitResult = z.infer<typeof profileSubmitResultSchema>;

export const profileUnlockResultSchema = z.strictObject({
  profileId: uuid,
  profileStatus: z.enum(['draft', 'verified']),
  assignmentId: uuid,
  unlockedAt: z.iso.datetime(),
});
export type ProfileUnlockResult = z.infer<typeof profileUnlockResultSchema>;

/** Exact subject IDs describe the frozen graph; stable identities never stand in for reviewed row IDs. */
export const profileReviewSubjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('section'), sectionRevisionId: uuid }),
  z.strictObject({ kind: z.literal('certificate'), certificateId: uuid }),
  z.strictObject({ kind: z.literal('document'), documentId: uuid }),
  z.strictObject({ kind: z.literal('file'), fileVersionId: uuid }),
]);
export type ProfileReviewSubject = z.infer<typeof profileReviewSubjectSchema>;
const decisionFields = {
  subject: profileReviewSubjectSchema,
  outcome: z.enum(['verified', 'rejected']),
  comment: z
    .string()
    .trim()
    .nullable()
    .transform((comment) => comment || null),
};
function rejectedComment(value: { outcome: string; comment: string | null }, context: z.RefinementCtx) {
  if (value.outcome === 'rejected' && !value.comment)
    context.addIssue({ code: 'custom', path: ['comment'], message: 'rejected_comment_required' });
}
/** Internal demo/review foundation; this schema does not add a public manufacturer decision endpoint. */
export const profileReviewDecisionInputSchema = z.strictObject(decisionFields).superRefine(rejectedComment);
export type ProfileReviewDecisionInput = z.infer<typeof profileReviewDecisionInputSchema>;
export const profileReviewDecisionSchema = z
  .strictObject({
    id: uuid,
    assignmentId: uuid,
    expertId: uuid,
    ...decisionFields,
    decidedAt: z.iso.datetime(),
  })
  .superRefine(rejectedComment);
export type ProfileReviewDecision = z.infer<typeof profileReviewDecisionSchema>;

/** Business evidence failures retain their section; cached completeness is never part of the request. */
export const PROFILE_SUBMISSION_ERROR_CODES = [
  'profile_locked',
  'section_changed',
  'profile_incomplete',
  'submission_requirements_changed',
  'submission_file_unavailable',
  'submission_graph_invalid',
  'operation_conflict',
  'assignment_changed',
  'profile_no_changes',
] as const;
export const profileSubmissionStateSchema = z.strictObject({
  profileId: uuid,
  profileStatus: z.enum(PROFILE_STATUSES),
  activeAssignmentId: uuid.nullable(),
  /** Retained accepted candidates can still differ from the published Verified graph. */
  hasUnsubmittedChanges: z.boolean(),
});
export type ProfileSubmissionState = z.infer<typeof profileSubmissionStateSchema>;
