import { z } from 'zod';
import { DOCUMENT_STATUSES } from './enums.js';
import { draftTextSchema } from './profile-fields.js';
import { profileFileSchema } from './profile-files.js';
import { sectionReadSchema, sectionSaveInputSchema } from './profile-sections.js';

export const COMPANY_ISO_CODES = ['ISO 9001', 'ISO 14001', 'ISO 45001'] as const;
export const CERTIFICATE_GROUPS = ['company', 'product', 'other'] as const;
const uuid = z.uuid().transform((value) => value.toLowerCase());
export const profileCertificateWriteSchema = z
  .strictObject({
    identityId: uuid,
    group: z.enum(CERTIFICATE_GROUPS).nullable(),
    certificateTypeId: uuid.nullable(),
    customTypeName: draftTextSchema,
    notHeld: z.boolean(),
    number: draftTextSchema,
    issuingBody: draftTextSchema,
    issuedOn: z.iso.date().nullable(),
    expiresOn: z.iso.date().nullable(),
    fileId: uuid.nullable(),
  })
  .superRefine((row, ctx) => {
    if (row.issuedOn !== null && row.expiresOn !== null && row.expiresOn < row.issuedOn)
      ctx.addIssue({ code: 'custom', path: ['expiresOn'], message: 'date_range_invalid' });
    if (
      row.notHeld &&
      [row.number, row.issuingBody, row.issuedOn, row.expiresOn, row.fileId].some((value) => value !== null)
    )
      ctx.addIssue({ code: 'custom', path: ['notHeld'], message: 'absence_fields_not_empty' });
  });
export type ProfileCertificateWrite = z.infer<typeof profileCertificateWriteSchema>;
export const certificatesWriteSchema = z
  .strictObject({ certificates: z.array(profileCertificateWriteSchema) })
  .superRefine(({ certificates }, ctx) => {
    const ids = new Set<string>();
    certificates.forEach((row, index) => {
      if (ids.has(row.identityId))
        ctx.addIssue({ code: 'custom', path: ['certificates', index, 'identityId'], message: 'duplicate_certificate' });
      ids.add(row.identityId);
    });
  });
export type CertificatesWrite = z.infer<typeof certificatesWriteSchema>;
export const profileCertificateTypeSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  names: z.strictObject({ kk: z.string().nullable(), ru: z.string().nullable(), en: z.string().nullable() }),
  customNameAllowed: z.boolean(),
});
export type ProfileCertificateType = z.infer<typeof profileCertificateTypeSchema>;
export const certificatesReadSchema = z.strictObject({
  editable: certificatesWriteSchema,
  certificates: z.array(
    z.strictObject({
      identityId: z.uuid(),
      certificateType: profileCertificateTypeSchema.nullable(),
      status: z.enum(DOCUMENT_STATUSES).nullable(),
      file: profileFileSchema.nullable(),
    }),
  ),
  requiredTypes: z.array(profileCertificateTypeSchema),
  requirementSource: z.enum(['current', 'submission']),
});
export type CertificatesRead = z.infer<typeof certificatesReadSchema>;
export const certificateEditorChoicesSchema = certificatesReadSchema.pick({ requiredTypes: true });
export type CertificateEditorChoices = z.infer<typeof certificateEditorChoicesSchema>;
export const ownCertificatesSchema = sectionReadSchema(certificatesReadSchema);
export const saveCertificatesSchema = sectionSaveInputSchema(certificatesWriteSchema);
