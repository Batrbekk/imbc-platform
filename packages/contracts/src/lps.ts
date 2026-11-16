import { z } from 'zod';
import { LOCALES } from './enums.js';
import {
  lpsContactEmailSchema,
  lpsContactPhoneSchema,
  lpsDateSchema,
  lpsInvestmentSchema,
  lpsJobCountSchema,
  lpsOptionalTextSchema,
  lpsPlannedLaunchSchema,
  lpsRequiredTextSchema,
  lpsSearchTextSchema,
  lpsUuidSchema,
} from './lps-fields.js';
export * from './lps-fields.js';

const uuidList = z.array(lpsUuidSchema).superRefine((values, ctx) => {
  const seen = new Set<string>();
  values.forEach((id, index) => {
    if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [index], message: 'duplicate_reference' });
    seen.add(id);
  });
});
export const lpsCompanyWriteSchema = z.strictObject({ name: lpsRequiredTextSchema, countryIds: uuidList.default([]) });
export type LpsCompanyWrite = z.infer<typeof lpsCompanyWriteSchema>;
export const lpsLocationWriteSchema = z
  .strictObject({
    id: lpsUuidSchema.nullable().default(null),
    city: lpsOptionalTextSchema,
    regionId: lpsUuidSchema.nullable(),
  })
  .refine((value) => value.city !== null || value.regionId !== null, { message: 'location_required' });
export const lpsContactWriteSchema = z
  .strictObject({
    id: lpsUuidSchema.nullable().default(null),
    fullName: lpsOptionalTextSchema,
    roleTitle: lpsOptionalTextSchema,
    emails: z.array(lpsContactEmailSchema),
    phones: z.array(lpsContactPhoneSchema),
  })
  .superRefine((value, ctx) => {
    if (value.fullName === null && value.emails.length === 0 && value.phones.length === 0)
      ctx.addIssue({ code: 'custom', message: 'contact_required' });
    for (const field of ['emails', 'phones'] as const) {
      const seen = new Set<string>();
      value[field].forEach((method, index) => {
        if (seen.has(method))
          ctx.addIssue({ code: 'custom', path: [field, index], message: 'duplicate_contact_method' });
        seen.add(method);
      });
    }
  });
export const lpsEntryWriteSchema = z
  .strictObject({
    companyId: lpsUuidSchema,
    /** Creation defaults to the approved programme LPS. On edit, omission retains the current Type. */
    sourceTypeId: lpsUuidSchema.optional(),
    scopeDescription: lpsRequiredTextSchema,
    statusId: lpsUuidSchema,
    plannedLaunch: lpsPlannedLaunchSchema.default(null),
    comment: lpsOptionalTextSchema.default(null),
    investmentUsd: lpsInvestmentSchema.default(null),
    newJobs: lpsJobCountSchema.default(null),
    lastUpdatedOn: lpsDateSchema.nullable().default(null),
    commodityTypeIds: uuidList.default([]),
    locations: z.array(lpsLocationWriteSchema).default([]),
    contacts: z.array(lpsContactWriteSchema).default([]),
  })
  .superRefine((data, ctx) => {
    const pairs = new Set<string>();
    data.locations.forEach((location, index) => {
      const key = JSON.stringify([location.city, location.regionId]);
      if (pairs.has(key)) ctx.addIssue({ code: 'custom', path: ['locations', index], message: 'duplicate_location' });
      pairs.add(key);
    });
    for (const field of ['locations', 'contacts'] as const) {
      const seen = new Set<string>();
      data[field].forEach((item, index) => {
        if (item.id !== null && seen.has(item.id))
          ctx.addIssue({ code: 'custom', path: [field, index, 'id'], message: 'duplicate_child' });
        if (item.id !== null) seen.add(item.id);
      });
    }
  });
export type LpsEntryWrite = z.infer<typeof lpsEntryWriteSchema>;
export const lpsReferenceBaseSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  names: z.strictObject({ en: z.string().nullable(), ru: z.string().nullable(), kk: z.string().nullable() }),
  sortOrder: z.number().int(),
  retiredAt: z.iso.datetime({ offset: true }).nullable(),
});
export const lpsReferenceSchema = lpsReferenceBaseSchema.extend({ parent: lpsReferenceBaseSchema.nullable() });
export type LpsReference = z.infer<typeof lpsReferenceSchema>;
export type LpsReferenceBase = z.infer<typeof lpsReferenceBaseSchema>;
const authoring = {
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
  updatedBy: z.uuid(),
};
export const lpsCompanyReadSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  countries: z.array(lpsReferenceSchema),
  ...authoring,
});
export type LpsCompanyRead = z.infer<typeof lpsCompanyReadSchema>;
export const lpsLocationReadSchema = z.strictObject({
  id: z.uuid(),
  city: z.string().nullable(),
  region: lpsReferenceSchema.nullable(),
});
export const lpsContactReadSchema = z.strictObject({
  id: z.uuid(),
  fullName: z.string().nullable(),
  roleTitle: z.string().nullable(),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
});
export const lpsEntryReadSchema = z.strictObject({
  id: z.uuid(),
  company: lpsCompanyReadSchema,
  sourceType: lpsReferenceSchema,
  scopeDescription: z.string(),
  status: lpsReferenceSchema,
  plannedLaunch: lpsPlannedLaunchSchema,
  comment: z.string().nullable(),
  investmentUsd: lpsInvestmentSchema,
  newJobs: lpsJobCountSchema,
  lastUpdatedOn: lpsDateSchema.nullable(),
  commodityTypes: z.array(lpsReferenceSchema),
  commodityGroups: z.array(lpsReferenceBaseSchema),
  locations: z.array(lpsLocationReadSchema),
  contacts: z.array(lpsContactReadSchema),
  ...authoring,
});
export type LpsEntryRead = z.infer<typeof lpsEntryReadSchema>;
export const LPS_SORT_COLUMNS = [
  'company',
  'sourceType',
  'countries',
  'commodityTypes',
  'commodityGroups',
  'scopeDescription',
  'status',
  'plannedLaunch',
  'comment',
  'investmentUsd',
  'newJobs',
  'cities',
  'regions',
  'contactNames',
  'contactTitles',
  'emails',
  'phones',
  'lastUpdatedOn',
] as const;
export const LPS_TABLE_COLUMNS = [
  'rowNumber',
  'company',
  'sourceType',
  'countries',
  'commodityTypes',
  'commodityGroups',
  'scopeDescription',
  'status',
  'plannedLaunch',
  'comment',
  'investmentUsd',
  'newJobs',
  'cities',
  'regions',
  'contactNames',
  'contactTitles',
  'emails',
  'phones',
  'lastUpdatedOn',
] as const;
export type LpsSortColumn = (typeof LPS_SORT_COLUMNS)[number];
const queryList = <T extends z.ZodType>(schema: T) =>
  z
    .union([schema, z.array(schema)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .default([]);
const filterReference = z.union([lpsUuidSchema, z.literal('unknown')]);
export const lpsFiltersSchema = z
  .strictObject({
    q: lpsSearchTextSchema,
    sourceTypeIds: queryList(lpsUuidSchema),
    countryIds: queryList(filterReference),
    commodityTypeIds: queryList(filterReference),
    commodityGroupIds: queryList(filterReference),
    statusIds: queryList(lpsUuidSchema),
    cities: queryList(lpsRequiredTextSchema),
    regionIds: queryList(filterReference),
    lastUpdatedFrom: lpsDateSchema.optional(),
    lastUpdatedTo: lpsDateSchema.optional(),
  })
  .refine(
    (data) =>
      data.lastUpdatedFrom === undefined ||
      data.lastUpdatedTo === undefined ||
      data.lastUpdatedFrom <= data.lastUpdatedTo,
    { message: 'date_range', path: ['lastUpdatedTo'] },
  );
export type LpsFilters = z.infer<typeof lpsFiltersSchema>;
export const lpsQuerySchema = lpsFiltersSchema.safeExtend({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(LPS_SORT_COLUMNS).default('company'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  locale: z.enum(LOCALES).default('kk'),
});
export type LpsQuery = z.infer<typeof lpsQuerySchema>;
export const lpsCompanyQuerySchema = z.strictObject({
  q: lpsSearchTextSchema,
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  locale: z.enum(LOCALES).default('kk'),
});
export type LpsCompanyQuery = z.infer<typeof lpsCompanyQuerySchema>;
export const lpsListSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  items: z.array(lpsEntryReadSchema.extend({ rowNumber: z.number().int().positive() })),
});
export const lpsDashboardSchema = z.strictObject({
  totalEntries: z.number().int().nonnegative(),
  totalCompanies: z.number().int().nonnegative(),
  statuses: z.array(z.strictObject({ reference: lpsReferenceSchema, count: z.number().int().nonnegative() })),
  regions: z.array(z.strictObject({ reference: lpsReferenceSchema.nullable(), count: z.number().int().nonnegative() })),
  commodityGroups: z.array(
    z.strictObject({ reference: lpsReferenceBaseSchema.nullable(), count: z.number().int().nonnegative() }),
  ),
});
export type LpsDashboard = z.infer<typeof lpsDashboardSchema>;
export const lpsCompanyListSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  items: z.array(lpsCompanyReadSchema),
});
export const LPS_PROBLEM_CODES = [
  'validation',
  'unauthenticated',
  'mfa_required',
  'responsibility_required',
  'forbidden',
  'bad_origin',
  'not_found',
  'lps_reference',
  'lps_child_scope',
  'lps_company_in_use',
  'lps_default_unavailable',
  'busy',
  'internal',
] as const;
export type LpsProblemCode = (typeof LPS_PROBLEM_CODES)[number];
