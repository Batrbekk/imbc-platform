import { z } from 'zod';
import { FILE_REJECTION_REASONS, FILE_SCAN_STATES } from './files.js';

/** DATA-07: section metadata may show an unscanned file, while content remains unavailable. */
export const profileFileSchema = z.strictObject({
  fileId: z.uuid(),
  versionId: z.uuid().nullable(),
  versionNumber: z.number().int().positive().nullable(),
  originalName: z.string().nullable(),
  byteSize: z.number().int().positive().nullable(),
  mediaType: z.string().nullable(),
  scanState: z.enum(FILE_SCAN_STATES).nullable(),
  rejectionReason: z.enum(FILE_REJECTION_REASONS).nullable(),
  uploadedAt: z.iso.datetime().nullable(),
  canDownload: z.boolean(),
}).superRefine((file, ctx) => {
  if (file.canDownload && (file.versionId === null || file.scanState !== 'passed'))
    ctx.addIssue({ code: 'custom', path: ['canDownload'], message: 'file_invalid' });
});
export type ProfileFile = z.infer<typeof profileFileSchema>;

export const profileFileHistoryQuerySchema = z.strictObject({
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const profileFileHistoryItemSchema = z.strictObject({
  id: z.uuid(),
  revisionId: z.uuid(),
  editVersion: z.number().int().nonnegative(),
  recordedAt: z.iso.datetime(),
  file: profileFileSchema,
});
export const profileFileHistorySchema = z.strictObject({
  items: z.array(profileFileHistoryItemSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(100),
});
export type ProfileFileHistory = z.infer<typeof profileFileHistorySchema>;

/** A frozen revision without a captured version never falls back to a later upload. */
export const unavailableProfileFile = (fileId: string): ProfileFile => ({
  fileId, versionId: null, versionNumber: null, originalName: null, byteSize: null,
  mediaType: null, scanState: null, rejectionReason: null, uploadedAt: null, canDownload: false,
});
