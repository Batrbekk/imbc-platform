import { z } from 'zod';

/** IMBC-15 / DBML1351–1410: Class C historical context, independent of outreach and Class G LPS. */
export const IMBC_NOTE_KINDS = ['general', 'legacy_ranking', 'registry_review', 'migration_context'] as const;
export const IMBC_EOI_RESPONSES = ['interested', 'not_interested'] as const;
export const IMBC_RECORD_SOURCES = ['expert', 'migration'] as const;
export const IMBC_RECORD_KINDS = ['note', 'engagement', 'product_context'] as const;
export const imbcRecordTimestampSchema = z.iso.datetime({ precision: 6 });
export const imbcRecordIdempotencyKeySchema = z.uuid();
const uuid = z.uuid();
const safeText = (max: number) => z.string().refine(v => Array.from(v).length <= max, { message: 'text_length' }).refine(v => !/[\u0000\uD800-\uDFFF]/u.test(v), { message: 'text_format' });
const body = safeText(10_000).refine(v => v.trim().length > 0, { message: 'note_blank' });
const day = z.iso.date().refine(v => Number(v.slice(0, 4)) > 0, { message: 'date_year' });
const nullableText = safeText(10_000).nullable();
/** Native SQL and immutable reads share this stored href shape; never transform history. */
const storedFolderValid = (value: string) => {
  if (!/^[\x21-\x7e]+$/.test(value)) return false;
  const parts = /^(https?):\/\/(\[[0-9a-f:]+\]|[^/?#:@]+)(?::([0-9]{1,5}))?(\/.*)$/.exec(value);
  if (!parts || parts[3] !== undefined && Number(parts[3]) > 65535) return false;
  const host = parts[2]!;
  if (host.startsWith('[')) {
    const address = host.slice(1, -1), halves = address.split('::');
    if (halves.length > 2) return false;
    const groups = halves.flatMap(half => half === '' ? [] : half.split(':'));
    return groups.every(group => /^[0-9a-f]{1,4}$/.test(group))
      && (halves.length === 2 ? groups.length < 8 : groups.length === 8);
  }
  return !/[A-Z#%/:<>?@[\]\\^|]/.test(host);
};
const folderRead = safeText(2048).refine(storedFolderValid, { message: 'folder_url' }).nullable();
/** Safe WHATWG parsing keeps ordinary IPv6/IDN URLs and stores only the checked canonical href. */
const folder = safeText(2048).transform((value, ctx) => {
  try {
    const authority = /^https?:\/\/([^/?#\\]*)/i.exec(value);
    if (!authority || authority[1]!.includes('@') || /[\u0000-\u001f\u007f]/.test(value) || value.trim() !== value) throw new Error('folder_url');
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.href.length > 2048 || !storedFolderValid(parsed.href)) throw new Error('folder_url');
    return parsed.href;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'folder_url' });
    return z.NEVER;
  }
}).nullable();
const unique = (ids: string[]) => new Set(ids.map(id => id.toLowerCase())).size === ids.length;
export const imbcNoteCreateSchema = z.strictObject({ body });
export const imbcNoteUpdateSchema = z.strictObject({ body, expectedUpdatedAt: imbcRecordTimestampSchema });
const eoiIntent = z.strictObject({ id: uuid, sentOn: day });
export const imbcEngagementPutSchema = z.strictObject({
  receiptConfirmed: z.boolean().nullable(), response: z.enum(IMBC_EOI_RESPONSES).nullable(),
  responseSummary: nullableText, readyForSiteVisit: z.boolean().nullable(),
  addedToImbcYear: z.number().int().min(1).max(9999).nullable(), folderUrl: folder,
  sourceEntryIds: z.array(uuid).max(100).refine(unique, { message: 'source_duplicate' }),
  eoiEvents: z.array(eoiIntent).max(200).refine(v => unique(v.map(e => e.id)), { message: 'event_duplicate' })
    .refine(v => new Set(v.map(e => e.sentOn)).size === v.length, { message: 'event_date_duplicate' }),
  expectedUpdatedAt: imbcRecordTimestampSchema.nullable(),
});
export const imbcProductContextPutSchema = z.strictObject({
  programmeId: uuid.nullable(), priorityId: uuid.nullable(), expectedUpdatedAt: imbcRecordTimestampSchema.nullable(),
});
const provenance = {
  source: z.enum(IMBC_RECORD_SOURCES), recordedBy: uuid.nullable(), recordedByName: safeText(500).nullable(),
  createdAt: imbcRecordTimestampSchema, updatedAt: imbcRecordTimestampSchema,
};
export const imbcNoteReadSchema = z.strictObject({
  id: uuid, profileId: uuid, organizationId: uuid, authorId: uuid.nullable(), authorName: safeText(500).nullable(),
  kind: z.enum(IMBC_NOTE_KINDS), body, source: z.enum(IMBC_RECORD_SOURCES),
  createdAt: imbcRecordTimestampSchema, updatedAt: imbcRecordTimestampSchema,
});
export const imbcEoiEventReadSchema = z.strictObject({ id: uuid, sentOn: day, ...provenance });
export const imbcEngagementReadSchema = z.strictObject({
  profileId: uuid, organizationId: uuid, receiptConfirmed: z.boolean().nullable(), response: z.enum(IMBC_EOI_RESPONSES).nullable(),
  responseSummary: nullableText, readyForSiteVisit: z.boolean().nullable(), addedToImbcYear: z.number().int().min(1).max(9999).nullable(),
  folderUrl: folderRead, sourceEntryIds: z.array(uuid).max(100), eoiEvents: z.array(imbcEoiEventReadSchema).max(200), ...provenance,
});
export const imbcProductContextReadSchema = z.strictObject({
  productLineIdentityId: uuid, profileId: uuid, organizationId: uuid, programmeId: uuid.nullable(), priorityId: uuid.nullable(), ...provenance,
});
export const imbcRecordReadSchema = z.union([imbcNoteReadSchema, imbcEngagementReadSchema, imbcProductContextReadSchema]);
export const imbcRecordListQuerySchema = z.strictObject({
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export const imbcNoteListSchema = z.strictObject({
  profileId: uuid, organizationId: uuid, organizationName: safeText(500), canEdit: z.boolean(),
  items: z.array(imbcNoteReadSchema).max(100), total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(100),
});
export const imbcRecordHistoryQuerySchema = z.strictObject({ beforeId: uuid.optional(), limit: z.coerce.number().int().positive().max(50).default(25) });
export const IMBC_RECORD_ACTIONS = [
  'imbc_note.created', 'imbc_note.updated', 'imbc_engagement.created', 'imbc_engagement.updated',
  'imbc_product_context.created', 'imbc_product_context.updated',
] as const;
export const imbcRecordHistoryEntrySchema = z.strictObject({
  id: uuid, at: imbcRecordTimestampSchema, action: z.enum(IMBC_RECORD_ACTIONS), actorId: uuid,
  actorName: safeText(500).nullable(), before: imbcRecordReadSchema.nullable(), after: imbcRecordReadSchema,
}).superRefine((entry, ctx) => {
  const kind = (row: z.infer<typeof imbcRecordReadSchema>) => 'id' in row ? 'note' : 'productLineIdentityId' in row ? 'product_context' : 'engagement';
  const key = (row: z.infer<typeof imbcRecordReadSchema>) => 'id' in row ? row.id : 'productLineIdentityId' in row ? row.productLineIdentityId : row.profileId;
  if (entry.action !== `imbc_${kind(entry.after)}.${entry.before === null ? 'created' : 'updated'}` || entry.at !== entry.after.updatedAt)
    ctx.addIssue({ code: 'custom', message: 'history_action_clock_mismatch' });
  if (entry.before && (kind(entry.before) !== kind(entry.after) || key(entry.before) !== key(entry.after)
    || entry.before.profileId !== entry.after.profileId || entry.before.organizationId !== entry.after.organizationId
    || entry.before.createdAt !== entry.after.createdAt || entry.before.source !== entry.after.source))
    ctx.addIssue({ code: 'custom', message: 'history_scope_provenance_mismatch' });
});
export const imbcRecordHistorySchema = z.strictObject({ items: z.array(imbcRecordHistoryEntrySchema).max(50), nextCursor: uuid.nullable() });
export type ImbcNoteCreate = z.infer<typeof imbcNoteCreateSchema>;
export type ImbcNoteUpdate = z.infer<typeof imbcNoteUpdateSchema>;
export type ImbcEngagementPut = z.infer<typeof imbcEngagementPutSchema>;
export type ImbcProductContextPut = z.infer<typeof imbcProductContextPutSchema>;
export type ImbcNoteRead = z.infer<typeof imbcNoteReadSchema>;
export type ImbcEngagementRead = z.infer<typeof imbcEngagementReadSchema>;
export type ImbcProductContextRead = z.infer<typeof imbcProductContextReadSchema>;
export type ImbcRecordRead = z.infer<typeof imbcRecordReadSchema>;
export type ImbcRecordKind = typeof IMBC_RECORD_KINDS[number];

/** Minimal Class C workbench choices; names come from the exact current internal product revision. */
export const imbcRecordProductOptionsSchema = z.strictObject({
  profileId: uuid, organizationId: uuid, sectionRevisionId: uuid.nullable(),
  items: z.array(z.strictObject({ productLineIdentityId: uuid, nameEn: safeText(10_000).nullable(), nameRu: safeText(10_000).nullable() })).max(100),
  total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(100),
});
export const IMBC_RECORD_DICTIONARIES = ['programme', 'imbc_priority', 'acquisition_source'] as const;
export const imbcRecordDictionaryCodeSchema = z.enum(IMBC_RECORD_DICTIONARIES);
const referenceIds = z.string().transform(v => v.split(',')).pipe(z.array(uuid).min(1).max(100).refine(unique, { message: 'reference_duplicate' }));
/** Exact selected/history metadata lookup includes retired values; it cannot be combined with paging. */
export const imbcRecordReferenceOptionsQuerySchema = z.union([z.strictObject({ ids: referenceIds }), imbcRecordListQuerySchema]);
export const imbcRecordReferenceOptionsSchema = z.strictObject({
  dictionaryCode: imbcRecordDictionaryCodeSchema,
  items: z.array(z.strictObject({ id: uuid, code: safeText(64), names: z.strictObject({
    en: safeText(500).nullable(), ru: safeText(500).nullable(), kk: safeText(500).nullable(),
  }), retiredAt: imbcRecordTimestampSchema.nullable() })).max(100),
  total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(100),
});
export const imbcRecordContextProductsQuerySchema = imbcRecordReferenceOptionsQuerySchema;
/** A retained Class C context stays reachable even when the current product list no longer includes it. */
export const imbcRecordContextProductsSchema = z.strictObject({
  profileId: uuid, organizationId: uuid,
  items: z.array(z.strictObject({ context: imbcProductContextReadSchema, product: z.strictObject({
    productLineIdentityId: uuid, nameEn: safeText(10_000).nullable(), nameRu: safeText(10_000).nullable(),
    sectionRevisionId: uuid.nullable(), isCurrent: z.boolean(),
  }) })).max(100), total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(100),
}).superRefine((page, ctx) => {
  if(page.items.some(item=>item.context.profileId!==page.profileId || item.context.organizationId!==page.organizationId
    || item.product.productLineIdentityId!==item.context.productLineIdentityId || item.product.isCurrent && item.product.sectionRevisionId===null))
    ctx.addIssue({code:'custom',message:'context_descriptor_scope_mismatch'});
});
