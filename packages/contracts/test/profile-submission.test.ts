import { describe, expect, it } from 'vitest';
import { SECTION_KINDS } from '../src/profile-sections.js';
import {
  profileReviewDecisionInputSchema,
  profileSubmitInputSchema,
  profileSubmitResultSchema,
  profileUnlockInputSchema,
} from '../src/profile-submission.js';

const id = (index: number) => `89ab89ab-0123-4567-8901-${index.toString(16).padStart(12, '0')}`;
const sections = () => SECTION_KINDS.map((kind, index) => ({ kind, revisionId: id(index), editVersion: index }));
const send = () => ({ operationKey: id(20), accuracyConfirmed: true, expectedSections: sections() });

describe('MAN-42–45 exact Send and Unlock contracts', () => {
  it('requires explicit accuracy and normalizes UUIDs without client-selected scope', () => {
    const input = send();
    input.operationKey = input.operationKey.toUpperCase();
    expect(profileSubmitInputSchema.parse(input).operationKey).toBe(id(20));
    for (const accuracyConfirmed of [false, null, undefined, 'true', 1])
      expect(profileSubmitInputSchema.safeParse({ ...send(), accuracyConfirmed }).success).toBe(false);
  });
  it.each([
    'profileId',
    'organizationId',
    'expertId',
    'mode',
    'status',
    'completenessPct',
    'assignmentOrder',
    'reusedFromAssignmentId',
  ])('rejects forged %s', (key) => {
    expect(profileSubmitInputSchema.safeParse({ ...send(), [key]: id(90) }).success).toBe(false);
  });
  it('requires all seven distinct section kinds and distinct exact revision UUIDs', () => {
    expect(profileSubmitInputSchema.safeParse({ ...send(), expectedSections: sections().slice(0, 6) }).success).toBe(
      false,
    );
    const duplicate = sections();
    duplicate[1] = duplicate[0]!;
    expect(profileSubmitInputSchema.safeParse({ ...send(), expectedSections: duplicate }).success).toBe(false);
    const wrongRevision = sections();
    wrongRevision[1]!.revisionId = wrongRevision[0]!.revisionId.toUpperCase();
    expect(profileSubmitInputSchema.safeParse({ ...send(), expectedSections: wrongRevision }).success).toBe(false);
  });
  it.each([-1, 1.5, 2_147_483_648, '1'])('rejects unrepresentable edit version %s', (editVersion) => {
    expect(
      profileSubmitInputSchema.safeParse({
        ...send(),
        expectedSections: sections().map((item) => ({ ...item, editVersion })),
      }).success,
    ).toBe(false);
  });
  it('accepts zero and PG integer limit while rejecting forged row evidence', () => {
    expect(
      profileSubmitInputSchema.safeParse({
        ...send(),
        expectedSections: sections().map((item) => ({ ...item, editVersion: 2_147_483_647 })),
      }).success,
    ).toBe(true);
    expect(
      profileSubmitInputSchema.safeParse({
        ...send(),
        expectedSections: sections().map((item) => ({ ...item, fileVersionId: id(55) })),
      }).success,
    ).toBe(false);
  });
  it('requires exact expected assignment and idempotency operation key for Unlock', () => {
    expect(profileUnlockInputSchema.parse({ operationKey: id(21), expectedAssignmentId: id(22) })).toEqual({
      operationKey: id(21),
      expectedAssignmentId: id(22),
    });
    expect(profileUnlockInputSchema.safeParse({ operationKey: id(21) }).success).toBe(false);
    expect(
      profileUnlockInputSchema.safeParse({ operationKey: id(21), expectedAssignmentId: id(22), profileId: id(90) })
        .success,
    ).toBe(false);
  });
  it('requires exact retained acceptance and mode-compatible acknowledgement', () => {
    const result = {
      profileId: id(99),
      profileStatus: 'verified',
      assignmentId: id(98),
      receivedAt: '2026-11-16T00:00:00.000Z',
      mode: 'verified_changes',
      sections: sections().map(({ kind, revisionId }, index) => ({
        kind,
        revisionId,
        reviewRequired: false,
        retainedDecisionId: id(100 + index),
      })),
    };
    expect(profileSubmitResultSchema.safeParse(result).success).toBe(true);
    expect(profileSubmitResultSchema.safeParse({ ...result, mode: 'initial' }).success).toBe(false);
    expect(
      profileSubmitResultSchema.safeParse({
        ...result,
        sections: result.sections.map((item) => ({ ...item, reviewRequired: true })),
      }).success,
    ).toBe(false);
    expect(
      profileSubmitResultSchema.safeParse({
        ...result,
        sections: result.sections.map((item) => ({ ...item, retainedDecisionId: id(100) })),
      }).success,
    ).toBe(false);
  });
});

describe('REV-06 immutable exact subject decision contract', () => {
  it.each([
    { kind: 'section', sectionRevisionId: id(1) },
    { kind: 'certificate', certificateId: id(2) },
    { kind: 'document', documentId: id(3) },
    { kind: 'file', fileVersionId: id(4) },
  ])('accepts one exact subject $kind and requires rejected comment', (subject) => {
    expect(profileReviewDecisionInputSchema.parse({ subject, outcome: 'verified', comment: '  ' }).comment).toBeNull();
    expect(
      profileReviewDecisionInputSchema.parse({ subject, outcome: 'rejected', comment: '  Explain  ' }).comment,
    ).toBe('Explain');
    expect(profileReviewDecisionInputSchema.safeParse({ subject, outcome: 'rejected', comment: ' \n ' }).success).toBe(
      false,
    );
  });
  it('rejects multiple subjects, stable identities, client actor and non-review statuses', () => {
    const decision = { subject: { kind: 'section', sectionRevisionId: id(1) }, outcome: 'verified', comment: null };
    expect(
      profileReviewDecisionInputSchema.safeParse({
        ...decision,
        subject: { ...decision.subject, fileVersionId: id(4) },
      }).success,
    ).toBe(false);
    expect(
      profileReviewDecisionInputSchema.safeParse({
        ...decision,
        subject: { kind: 'certificate', certificateIdentityId: id(2) },
      }).success,
    ).toBe(false);
    expect(profileReviewDecisionInputSchema.safeParse({ ...decision, expertId: id(10) }).success).toBe(false);
    expect(profileReviewDecisionInputSchema.safeParse({ ...decision, decisionOrder: 99 }).success).toBe(false);
    expect(profileReviewDecisionInputSchema.safeParse({ ...decision, outcome: 'uploaded' }).success).toBe(false);
  });
});
