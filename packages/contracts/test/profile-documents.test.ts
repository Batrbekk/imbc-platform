import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { documentsReadSchema, documentsWriteSchema, type ProfileDocumentWrite } from '../src/profile-documents.js';

const row = (): ProfileDocumentWrite => ({
  identityId: randomUUID(),
  documentTypeId: null,
  customName: null,
  fileId: null,
});

describe('MAN-37–39 document contracts', () => {
  it('accepts an empty section and partial document rows without inventing a licence declaration', () => {
    expect(documentsWriteSchema.parse({ documents: [] })).toEqual({ documents: [] });
    const partial = row();
    expect(documentsWriteSchema.parse({ documents: [partial] })).toEqual({ documents: [partial] });
  });

  it('normalizes UUID spelling and blank custom names before binding and no-op comparison', () => {
    const identityId = randomUUID();
    const documentTypeId = randomUUID();
    const fileId = randomUUID();
    expect(
      documentsWriteSchema.parse({
        documents: [
          {
            identityId: identityId.toUpperCase(),
            documentTypeId: documentTypeId.toUpperCase(),
            fileId: fileId.toUpperCase(),
            customName: '  Evidence  ',
          },
        ],
      }),
    ).toEqual({ documents: [{ identityId, documentTypeId, fileId, customName: 'Evidence' }] });
    expect(documentsWriteSchema.parse({ documents: [{ ...row(), customName: '   ' }] }).documents[0]?.customName).toBe(
      null,
    );
  });

  it('rejects duplicate identities including different UUID casing with the offending row path', () => {
    const first = row();
    const result = documentsWriteSchema.safeParse({
      documents: [first, { ...row(), identityId: first.identityId.toUpperCase() }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'duplicate_document',
          path: ['documents', 1, 'identityId'],
        }),
      );
  });

  it('permits multiple document rows to reference the same uploaded bundle without an invented file uniqueness rule', () => {
    const fileId = randomUUID();
    expect(
      documentsWriteSchema.parse({
        documents: [
          { ...row(), fileId },
          { ...row(), fileId },
        ],
      }).documents,
    ).toHaveLength(2);
  });

  it('has no business cap of 50 document rows', () => {
    const documents = Array.from({ length: 75 }, row);
    expect(documentsWriteSchema.parse({ documents }).documents).toEqual(documents);
  });

  it.each([
    { noLicenceRequired: true },
    { licenceRequired: false },
    { status: 'verified' },
    { reviewComment: 'approved' },
  ])('rejects a licensing or writable review property %j', (extra) => {
    expect(documentsWriteSchema.safeParse({ documents: [{ ...row(), ...extra }] }).success).toBe(false);
  });

  it('rejects arbitrary section properties, malformed IDs and unsafe names', () => {
    expect(documentsWriteSchema.safeParse({ documents: [], licenceNotRequired: true }).success).toBe(false);
    for (const change of [{ identityId: 'not-a-uuid' }, { fileId: 'private-key' }, { customName: 'Unsafe\u0000name' }])
      expect(documentsWriteSchema.safeParse({ documents: [{ ...row(), ...change }] }).success).toBe(false);
  });

  it('represents a frozen revision with captured requirements and unavailable file metadata without exposing storage details', () => {
    const document = row();
    const fileId = randomUUID();
    const data = {
      editable: { documents: [{ ...document, fileId }] },
      documents: [
        {
          identityId: document.identityId,
          documentType: null,
          status: 'uploaded',
          file: {
            fileId,
            versionId: null,
            versionNumber: null,
            originalName: null,
            byteSize: null,
            mediaType: null,
            scanState: null,
            rejectionReason: null,
            uploadedAt: null,
            canDownload: false,
          },
        },
      ],
      requiredTypes: [],
      requirementSource: 'submission',
    };
    expect(documentsReadSchema.parse(data)).toEqual(data);
    expect(documentsReadSchema.safeParse({ ...data, storageKey: 'private-storage-key' }).success).toBe(false);
  });
});
