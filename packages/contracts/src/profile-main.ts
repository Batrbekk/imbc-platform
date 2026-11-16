import { z } from 'zod';
import { ADATA_READ_STATES } from './prefill.js';
import { draftEmailSchema, draftPhoneSchema, draftTextSchema, draftWebsiteSchema } from './profile-fields.js';
import { sectionReadSchema, sectionSaveInputSchema } from './profile-sections.js';

export const productionSiteWriteSchema = z.strictObject({
  /** Null creates a new server-owned stable identity (MAN-11). */
  identityId: z.uuid().nullable(),
  address: draftTextSchema,
  city: draftTextSchema,
  regionId: z.uuid().nullable(),
});
export type ProductionSiteWrite = z.infer<typeof productionSiteWriteSchema>;

/** MAN-06–11: legal data, OKED, BIN and login are deliberately absent from the strict write schema. */
export const mainInformationWriteSchema = z
  .strictObject({
    website: draftWebsiteSchema,
    companyPhone: draftPhoneSchema,
    contactEmail: draftEmailSchema,
    sites: z.array(productionSiteWriteSchema),
  })
  .superRefine(({ sites }, ctx) => {
    const identities = new Set<string>();
    sites.forEach((site, index) => {
      if (site.identityId && identities.has(site.identityId))
        ctx.addIssue({ code: 'custom', message: 'duplicate_site', path: ['sites', index, 'identityId'] });
      if (site.identityId) identities.add(site.identityId);
    });
  });
export type MainInformationWrite = z.infer<typeof mainInformationWriteSchema>;

export const mainInformationReadSchema = z.strictObject({
  bin: z.string().nullable(),
  loginEmail: z.string().nullable(),
  editable: mainInformationWriteSchema,
  /** Stored region labels remain readable after an entry is retired (DATA-04). */
  selectedRegions: z.array(
    z.strictObject({
      id: z.uuid(),
      code: z.string(),
      names: z.strictObject({ kk: z.string().nullable(), ru: z.string().nullable(), en: z.string().nullable() }),
    }),
  ),
  legalInformation: z.strictObject({
    legalName: z.string().nullable(),
    alternativeName: z.string().nullable(),
    legalForm: z.string().nullable(),
    directorFullName: z.string().nullable(),
    stateRegisteredOn: z.string().nullable(),
    legalAddress: z.string().nullable(),
    founders: z.array(z.string()),
    oked: z.array(z.strictObject({ code: z.string(), name: z.string().nullable() })),
  }),
  source: z.strictObject({
    state: z.enum(ADATA_READ_STATES),
    readAt: z.iso.datetime().nullable(),
    provenance: z.enum(['adata', 'migration']).nullable(),
  }),
  registry: z.strictObject({ registered: z.boolean().nullable(), firstInclusionOn: z.string().nullable() }),
});
export type MainInformationRead = z.infer<typeof mainInformationReadSchema>;
export const ownMainInformationSchema = sectionReadSchema(mainInformationReadSchema);
export const saveMainInformationSchema = sectionSaveInputSchema(mainInformationWriteSchema);
