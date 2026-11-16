import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { certificatesWriteSchema, profileCertificateWriteSchema } from '../src/profile-certificates.js';
const empty = () => ({ identityId: randomUUID(), group: null, certificateTypeId: null, customTypeName: null,
  notHeld: false, number: null, issuingBody: null, issuedOn: null, expiresOn: null, fileId: null });
describe('MAN-33–36 partial certificate contract', () => {
  it('permits empty list and partial held fields without a writable status', () => {
    expect(certificatesWriteSchema.parse({ certificates: [] })).toEqual({ certificates: [] });
    expect(profileCertificateWriteSchema.parse(empty()).group).toBeNull();
    expect(profileCertificateWriteSchema.safeParse({ ...empty(), status: 'verified' }).success).toBe(false);
  });
  it('normalizes text and UUID casing before no-op comparison', () => {
    const row = empty();
    expect(profileCertificateWriteSchema.parse({ ...row, identityId: row.identityId.toUpperCase(), number: '  00123  ', issuingBody: ' ' }))
      .toMatchObject({ identityId: row.identityId, number: '00123', issuingBody: null });
  });
  it('rejects duplicate identity even with different UUID casing', () => {
    const row = empty();
    expect(certificatesWriteSchema.safeParse({ certificates: [row, { ...row, identityId: row.identityId.toUpperCase() }] }).success).toBe(false);
  });
  it('keeps perpetual certificates valid but rejects impossible dates and reversed periods', () => {
    expect(profileCertificateWriteSchema.safeParse({ ...empty(), issuedOn: '2024-02-29' }).success).toBe(true);
    expect(profileCertificateWriteSchema.safeParse({ ...empty(), issuedOn: '2025-02-29' }).success).toBe(false);
    expect(profileCertificateWriteSchema.safeParse({ ...empty(), issuedOn: '2026-02-01', expiresOn: '2026-01-31' }).success).toBe(false);
  });
  it('an absence declaration cannot silently retain held evidence', () => {
    expect(profileCertificateWriteSchema.safeParse({ ...empty(), notHeld: true }).success).toBe(true);
    for (const field of ['number', 'issuingBody', 'issuedOn', 'expiresOn', 'fileId']) {
      const value = field === 'fileId' ? randomUUID() : field.endsWith('On') ? '2026-01-01' : 'held';
      expect(profileCertificateWriteSchema.safeParse({ ...empty(), notHeld: true, [field]: value }).success).toBe(false);
    }
  });
});
