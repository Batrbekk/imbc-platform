import { z } from 'zod';
import { DOCUMENT_STATUSES } from './enums.js';
import { draftTextSchema } from './profile-fields.js';
import { profileFileSchema } from './profile-files.js';
import { sectionReadSchema, sectionSaveInputSchema } from './profile-sections.js';

/** MAN-37: these types remain mandatory when an administrator changes optional requirements. */
export const DOCUMENT_REQUIRED_CODES = ['registration_certificate', 'charter'] as const;
const uuidSchema = z.uuid().transform((id) => id.toLowerCase());

export const profileDocumentWriteSchema = z.strictObject({
  identityId: uuidSchema,
  documentTypeId: uuidSchema.nullable(),
  customName: draftTextSchema,
  fileId: uuidSchema.nullable(),
});
export type ProfileDocumentWrite = z.infer<typeof profileDocumentWriteSchema>;

/** MAN-38/40: any number of partial rows; no licensing declaration or writable review status. */
export const documentsWriteSchema = z
  .strictObject({ documents: z.array(profileDocumentWriteSchema) })
  .superRefine(({ documents }, ctx) => {
    const seen = new Set<string>();
    documents.forEach((row, index) => {
      if (seen.has(row.identityId))
        ctx.addIssue({ code: 'custom', message: 'duplicate_document', path: ['documents', index, 'identityId'] });
      seen.add(row.identityId);
    });
  });
export type DocumentsWrite = z.infer<typeof documentsWriteSchema>;

export const profileDocumentTypeSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  names: z.strictObject({ kk: z.string().nullable(), ru: z.string().nullable(), en: z.string().nullable() }),
  customNameAllowed: z.boolean(),
});
export type ProfileDocumentType = z.infer<typeof profileDocumentTypeSchema>;

export const documentsReadSchema = z.strictObject({
  editable: documentsWriteSchema,
  documents: z.array(
    z.strictObject({
      identityId: z.uuid(),
      documentType: profileDocumentTypeSchema.nullable(),
      status: z.enum(DOCUMENT_STATUSES),
      file: profileFileSchema.nullable(),
    }),
  ),
  requiredTypes: z.array(profileDocumentTypeSchema),
  requirementSource: z.enum(['current', 'submission']),
});
export type DocumentsRead = z.infer<typeof documentsReadSchema>;
export const documentEditorChoicesSchema = documentsReadSchema.pick({ requiredTypes: true });
export type DocumentEditorChoices = z.infer<typeof documentEditorChoicesSchema>;
export const ownDocumentsSchema = sectionReadSchema(documentsReadSchema);
export const saveDocumentsSchema = sectionSaveInputSchema(documentsWriteSchema);
