import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROFILE_UPLOAD_PURPOSES, profileUploadSchema, profileUploadTargetSchema } from '../src/profile-upload.js';

describe('manufacturer upload contracts', () => {
  it('permits exactly the editable-section file purposes, without source or administrative uploads', () => {
    for (const [kind, purposes] of Object.entries(PROFILE_UPLOAD_PURPOSES))
      for (const purpose of purposes)
        expect(profileUploadTargetSchema.parse({ kind, purpose })).toEqual({ kind, purpose });
    for (const target of [
      { kind: 'main_information', purpose: 'document_file' },
      { kind: 'contacts', purpose: 'cv' },
      { kind: 'personnel', purpose: 'document_file' },
      { kind: 'products', purpose: 'certificate_file' },
      { kind: 'certificates', purpose: 'conformity_certificate' },
      { kind: 'documents', purpose: 'organisation_chart_sample' },
      { kind: 'unknown', purpose: 'cv' },
    ])
      expect(profileUploadTargetSchema.safeParse(target).success).toBe(false);
  });

  const pending = () => ({
    upload: {
      fileId: randomUUID(),
      versionId: randomUUID(),
      versionNumber: 1,
      originalName: 'Evidence.pdf',
      byteSize: 100,
      mediaType: 'application/pdf',
      uploadedAt: new Date().toISOString(),
      scanState: 'pending',
      rejectionReason: null,
      canDownload: false,
    },
  });

  it('returns stable object and exact pending version metadata without implying a saved owner', () => {
    const upload = pending();
    expect(profileUploadSchema.parse(upload)).toEqual(upload);
    expect(profileUploadSchema.safeParse({ ...upload, revisionId: randomUUID() }).success).toBe(false);
  });

  it.each([
    { versionNumber: 2 },
    { versionId: null },
    { scanState: 'passed' },
    { canDownload: true },
    { rejectionReason: 'malware' },
    { byteSize: 25 * 1024 * 1024 + 1 },
    { storageKey: 'private-key' },
  ])('rejects a replacement, scan decision, oversize or storage detail in an upload response %j', (override) => {
    const value = pending();
    expect(profileUploadSchema.safeParse({ upload: { ...value.upload, ...override } }).success).toBe(false);
  });
});
