import { z } from 'zod';
import { MAX_FILE_BYTES } from './enums.js';
import { FILE_PURPOSES, type FilePurpose } from './files.js';
import { profileFileSchema } from './profile-files.js';

/** Manufacturer uploads are file candidates; only explicit section Save creates their owner binding. */
export const PROFILE_UPLOAD_PURPOSES = {
  personnel: ['organisation_chart', 'cv'],
  products: ['unified_register_extract'],
  production: ['production_photo'],
  certificates: ['certificate_file'],
  documents: ['document_file'],
} as const satisfies Record<string, readonly FilePurpose[]>;
export const PROFILE_UPLOAD_SECTION_KINDS = [
  'personnel',
  'products',
  'production',
  'certificates',
  'documents',
] as const;

export const profileUploadTargetSchema = z
  .strictObject({
    kind: z.enum(PROFILE_UPLOAD_SECTION_KINDS),
    purpose: z.enum(FILE_PURPOSES),
  })
  .superRefine((target, ctx) => {
    if (!(PROFILE_UPLOAD_PURPOSES[target.kind] as readonly FilePurpose[]).includes(target.purpose))
      ctx.addIssue({ code: 'custom', path: ['purpose'], message: 'file_purpose_not_allowed' });
  });
export type ProfileUploadTarget = z.infer<typeof profileUploadTargetSchema>;

/** POST own/sections/:kind/files/:purpose — 202, an exact new pending version; never content permission. */
export const profileUploadSchema = z.strictObject({
  upload: profileFileSchema.safeExtend({
    versionId: z.uuid(),
    versionNumber: z.literal(1),
    originalName: z.string(),
    byteSize: z.number().int().positive().max(MAX_FILE_BYTES),
    mediaType: z.string(),
    uploadedAt: z.iso.datetime(),
    scanState: z.literal('pending'),
    rejectionReason: z.null(),
    canDownload: z.literal(false),
  }),
});
export type ProfileUpload = z.infer<typeof profileUploadSchema>;

/** Own unused-upload preview polling; a frozen section continues to read its captured version instead. */
export const profileUploadStateSchema = z.strictObject({ upload: profileFileSchema });
export type ProfileUploadState = z.infer<typeof profileUploadStateSchema>;
