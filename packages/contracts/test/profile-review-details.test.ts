import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { profileOwnReviewDetailsSchema } from '../src/profile-review-details.js';
import { SECTION_KINDS } from '../src/profile-sections.js';

const fixture = () => ({
  profileId: randomUUID(),
  assignment: null,
  sections: SECTION_KINDS.map((kind) => ({
    kind,
    currentRevisionId: randomUUID(),
    reviewedRevisionId: null,
    reviewRequired: null,
    appliesToCurrentRevision: false,
    decision: null,
    items: [],
  })),
});
describe('own exact review context', () => {
  it('accepts historical comments without transferring acceptance to a new working revision', () => {
    const value = fixture();
    const section = value.sections[0]!;
    const historical = {
      ...section,
      reviewedRevisionId: randomUUID(),
      reviewRequired: true,
      decision: {
        id: randomUUID(),
        outcome: 'verified',
        comment: 'Earlier revision',
        decidedAt: new Date().toISOString(),
      },
    };
    expect(
      profileOwnReviewDetailsSchema.safeParse({ ...value, sections: [historical, ...value.sections.slice(1)] }).success,
    ).toBe(true);
    expect(
      profileOwnReviewDetailsSchema.safeParse({
        ...value,
        sections: [{ ...historical, appliesToCurrentRevision: true }, ...value.sections.slice(1)],
      }).success,
    ).toBe(false);
  });
  it('requires exactly seven distinct sections and rejects forged section-as-item subjects', () => {
    const value = fixture();
    expect(
      profileOwnReviewDetailsSchema.safeParse({
        ...value,
        sections: [value.sections[0], ...value.sections.slice(0, 6)],
      }).success,
    ).toBe(false);
    expect(
      profileOwnReviewDetailsSchema.safeParse({
        ...value,
        sections: [
          {
            ...value.sections[0],
            items: [
              {
                subject: { kind: 'section', sectionRevisionId: randomUUID() },
                stableIdentityId: null,
                fileObjectId: null,
                label: { kind: 'document', positionInList: 0, type: null, customName: null },
                decision: null,
              },
            ],
          },
          ...value.sections.slice(1),
        ],
      }).success,
    ).toBe(false);
  });
});
