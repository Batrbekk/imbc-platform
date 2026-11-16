import { describe, expect, it } from 'vitest';
import {
  reviewQueueFilterSchema,
  reviewAssignmentQueueFilterSchema,
  reviewOperationalQueueSchema,
  reviewAssignmentQueueSchema,
  reviewAssignInputSchema,
  reviewSectionDecisionInputSchema,
  reviewWorkbenchSchema,
} from '../src/review.js';
import { SECTION_KINDS } from '../src/profile-sections.js';

const profileId = '00000000-0000-4000-8000-000000000001';
const assignmentId = '00000000-0000-4000-8000-000000000002';
const expertId = '00000000-0000-4000-8000-000000000003';
const timestamp = '2026-11-16T07:02:01.123456Z';
const metadata = {
  profileId,
  organizationName: 'Synthetic manufacturer',
  status: 'submitted',
  hasPendingChanges: false,
  assignmentId,
  assignedExpertId: expertId,
  assignedExpert: 'Synthetic SME',
  unresolved: false,
};

describe('Production review contracts', () => {
  it('parses queue filters with bounded pagination and independent actual receipt date', () => {
    expect(
      reviewQueueFilterSchema.parse({
        status: 'submitted,pending_changes',
        assignee: `${expertId},unassigned`,
        receivedFrom: '2026-11-01',
        receivedTo: '2026-11-16',
      }),
    ).toEqual({
      status: ['submitted', 'pending_changes'],
      assignee: [expertId, 'unassigned'],
      receivedFrom: '2026-11-01',
      receivedTo: '2026-11-16',
      offset: 0,
      limit: 25,
    });
    for (const query of [
      { receivedFrom: '2026-11-17', receivedTo: '2026-11-16' },
      { status: 'verified' },
      { assignee: 'unknown' },
      { limit: 101 },
      { offset: -1 },
      { registeredFrom: '2026-11-01' },
    ])
      expect(reviewQueueFilterSchema.safeParse(query).success).toBe(false);
    expect(reviewAssignmentQueueFilterSchema.safeParse({ receivedFrom: '2026-11-01' }).success).toBe(false);
  });
  it('keeps unresolved rows explicit without inventing receipt time or an assignment', () => {
    const legacy = {
      ...metadata,
      assignmentId: null,
      assignedExpertId: null,
      assignedExpert: null,
      unresolved: true,
      bin: '000000000001',
      registeredAt: '2026-01-01T00:00:00.000Z',
      receivedAt: null,
    };
    expect(
      reviewOperationalQueueSchema.parse({ items: [legacy], total: 1, offset: 0, limit: 25 }).items[0]?.receivedAt,
    ).toBeNull();
    for (const row of [
      { ...legacy, unresolved: false },
      { ...legacy, receivedAt: timestamp },
      { ...legacy, assignmentId },
    ])
      expect(reviewOperationalQueueSchema.safeParse({ items: [row], total: 1, offset: 0, limit: 25 }).success).toBe(
        false,
      );
  });
  it('accepts exact receipt microseconds separately from registration', () => {
    const row = { ...metadata, bin: '000000000001', registeredAt: '2020-01-01T00:00:00.000Z', receivedAt: timestamp };
    expect(
      reviewOperationalQueueSchema.parse({ items: [row], total: 1, offset: 0, limit: 25 }).items[0]?.receivedAt,
    ).toBe(timestamp);
    expect(
      reviewOperationalQueueSchema.safeParse({
        items: [{ ...row, receivedAt: '2026-11-16T07:02:01.123Z' }],
        total: 1,
        offset: 0,
        limit: 25,
      }).success,
    ).toBe(false);
  });
  it('administrator projection refuses private manufacturer/source/file fields and dates', () => {
    const page = { items: [metadata], total: 1, offset: 0, limit: 25 };
    expect(reviewAssignmentQueueSchema.parse(page)).toEqual(page);
    for (const field of ['bin', 'registeredAt', 'receivedAt', 'contact', 'sections', 'reportFileId', 'diligence'])
      expect(
        reviewAssignmentQueueSchema.safeParse({ ...page, items: [{ ...metadata, [field]: 'Synthetic private' }] })
          .success,
      ).toBe(false);
  });
  it('assignment targets only the expert and requires the observed old assignee', () => {
    expect(reviewAssignInputSchema.parse({ expertId, expectedExpertId: null })).toEqual({
      expertId,
      expectedExpertId: null,
    });
    for (const input of [
      { expertId },
      { expertId, expectedExpertId: null, actorId: expertId },
      { expertId, expectedExpertId: 'unknown' },
    ])
      expect(reviewAssignInputSchema.safeParse(input).success).toBe(false);
  });
  it('requires one section comment for rejections and no per-item comment or manufacturer data', () => {
    const input = {
      sectionRevisionId: profileId,
      expectedDecisionId: null,
      outcome: 'rejected',
      comment: 'Correct the section',
      items: [{ subject: { kind: 'document', documentId: assignmentId }, outcome: 'rejected' }],
    };
    expect(reviewSectionDecisionInputSchema.parse(input)).toEqual(input);
    for (const value of [
      { ...input, comment: null },
      { ...input, outcome: 'verified', comment: '' },
      { ...input, expectedDecisionId: undefined },
      { ...input, items: [input.items[0], input.items[0]] },
      { ...input, items: [{ ...input.items[0], comment: 'Per-item comment' }] },
      { ...input, items: [{ subject: { kind: 'section', sectionRevisionId: profileId }, outcome: 'verified' }] },
      { ...input, data: { legalName: 'Edit' } },
      { ...input, comment: 'Bad\u0000text' },
    ])
      expect(reviewSectionDecisionInputSchema.safeParse(value).success).toBe(false);
  });
  it('keeps a partial section decision without asserting its items are complete', () => {
    const view = {
      profileId,
      organizationName: metadata.organizationName,
      profileStatus: 'under_review',
      hasPendingChanges: false,
      assignment: { id: assignmentId, expertId, receivedAt: timestamp, assignedAt: timestamp },
      sections: SECTION_KINDS.map((kind, index) => ({
        kind,
        revisionId: `00000000-0000-4000-8000-${(100 + index).toString().padStart(12, '0')}`,
        revisionState: 'submitted',
        reviewRequired: true,
        retainedDecisionId: `00000000-0000-4000-8000-${(200 + index).toString().padStart(12, '0')}`,
        completenessPct: 100,
        decision: null,
        items: [],
      })),
      canSubmitResult: false,
    };
    expect(reviewWorkbenchSchema.safeParse(view).success).toBe(true);
    expect(
      reviewWorkbenchSchema.safeParse({
        ...view,
        sections: view.sections.map((section) => ({ ...section, reviewRequired: false, retainedDecisionId: null })),
      }).success,
    ).toBe(false);
    expect(
      reviewWorkbenchSchema.safeParse({
        ...view,
        sections: view.sections.map((section) => ({ ...section, retainedFromAssignmentId: assignmentId })),
      }).success,
    ).toBe(false);
  });
});
