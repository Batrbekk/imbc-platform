import { describe, expect, it } from 'vitest';
import { acceptCurrentNdaInputSchema, currentNdaStateSchema } from '../src/current-nda.js';

describe('current NDA contract', () => {
  it('requires an explicit current-version tick without client-selected evidence or scope', () => {
    expect(acceptCurrentNdaInputSchema.safeParse({ versionNumber: 1, accepted: true }).success).toBe(true);
    for (const input of [
      { versionNumber: 1, accepted: false },
      { versionNumber: 0, accepted: true },
      { versionNumber: 1, accepted: true, acceptedAt: new Date().toISOString() },
      { versionNumber: 1, accepted: true, organizationId: 'foreign' },
    ])
      expect(acceptCurrentNdaInputSchema.safeParse(input).success).toBe(false);
  });
  it('distinguishes a lawful pre-profile acceptance from an attached profile without invented time', () => {
    const nda = { version: 1, body: 'Synthetic legal test' };
    expect(
      currentNdaStateSchema.safeParse({
        nda,
        accepted: true,
        acceptedAt: new Date().toISOString(),
        profileLinked: false,
      }).success,
    ).toBe(true);
    expect(
      currentNdaStateSchema.safeParse({ nda, accepted: true, acceptedAt: null, profileLinked: false }).success,
    ).toBe(false);
    expect(
      currentNdaStateSchema.safeParse({ nda, accepted: false, acceptedAt: null, profileLinked: true }).success,
    ).toBe(false);
  });
});
