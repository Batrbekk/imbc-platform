import { describe, expect, it } from 'vitest';
import { profileCandidateRevisionSql, selectedCandidateRevisionId } from '../src/modules/profiles/profile-candidate.js';

describe('current manufacturer candidate precedence', () => {
  const input = {
    workingRevisionId: 'working',
    pendingRevisionId: 'pending',
    candidateRevisionId: 'candidate',
    verifiedRevisionId: 'verified',
  };
  it('prefers working, sent pending, durable rejected/accepted candidate, then publication', () => {
    expect(selectedCandidateRevisionId(input)).toBe('working');
    expect(selectedCandidateRevisionId({ ...input, workingRevisionId: null })).toBe('pending');
    expect(selectedCandidateRevisionId({ ...input, workingRevisionId: null, pendingRevisionId: null })).toBe(
      'candidate',
    );
    expect(
      selectedCandidateRevisionId({
        ...input,
        workingRevisionId: null,
        pendingRevisionId: null,
        candidateRevisionId: null,
      }),
    ).toBe('verified');
    expect(
      selectedCandidateRevisionId({
        workingRevisionId: null,
        pendingRevisionId: null,
        candidateRevisionId: null,
        verifiedRevisionId: null,
      }),
    ).toBeNull();
  });
  it('accepts internal SQL aliases and rejects interpolated SQL syntax', () => {
    expect(profileCandidateRevisionSql('s')).toBeDefined();
    for (const alias of ['s; drop table x', 's.id', 's"', 's join x', ''])
      expect(() => profileCandidateRevisionSql(alias)).toThrow('Invalid internal section alias');
  });
});
