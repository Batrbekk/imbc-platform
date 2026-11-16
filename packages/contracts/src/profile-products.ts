import { z } from 'zod';
import { CAPACITY_UNITS } from './enums.js';
import { draftTextSchema } from './profile-fields.js';
import { profileFileSchema } from './profile-files.js';
import { sectionReadSchema, sectionSaveInputSchema } from './profile-sections.js';

const uuid = z.uuid().transform((value) => value.toLowerCase());
/** These are annual quantities; the shared unit catalogue may contain other forecast units. */
export const MANUAL_CAPACITY_UNIT_CODES = CAPACITY_UNITS;

/** Exact decimal transport: PostgreSQL numeric values never pass through a JS Number. */
export const productCapacitySchema = z.string().trim().max(2000).nullable().transform((value, ctx) => {
  if (!value) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'decimal_format' });
    return z.NEVER;
  }
  const [integer, fraction] = value.split('.');
  const whole = integer!.replace(/^0+(?=\d)/, '');
  const fractional = fraction?.replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : whole;
});
const associations = {
  identityId: uuid,
  productionSiteIdentityId: uuid.nullable(),
  note: draftTextSchema,
  certificateIdentityIds: z.array(uuid),
};
export const profileProductWriteSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('manual'), ...associations,
    nameEn: draftTextSchema, nameRu: draftTextSchema,
    commodityTypeId: uuid.nullable(), tnVedEntryId: uuid.nullable(), kpvedEntryIds: z.array(uuid),
    capacityQuantity: productCapacitySchema, capacityUnitId: uuid.nullable(),
  }),
  // Source-owned facts and source record IDs cannot appear in a manufacturer's write body.
  z.strictObject({ kind: z.literal('registry'), ...associations }),
]);
export type ProfileProductWrite = z.infer<typeof profileProductWriteSchema>;
export const productsWriteSchema = z.strictObject({
  products: z.array(profileProductWriteSchema), unifiedRegisterExtractId: uuid.nullable(),
}).superRefine(({ products }, ctx) => {
  const ids = new Set<string>();
  products.forEach((row, index) => {
    if (ids.has(row.identityId)) ctx.addIssue({ code: 'custom', path: ['products', index, 'identityId'], message: 'duplicate_product' });
    ids.add(row.identityId);
    for (const field of ['certificateIdentityIds', ...(row.kind === 'manual' ? ['kpvedEntryIds'] : [])] as const) {
      const values = field === 'kpvedEntryIds' && row.kind === 'manual' ? row.kpvedEntryIds : row.certificateIdentityIds;
      const seen = new Set<string>();
      values.forEach((id, entryIndex) => {
        if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['products', index, field, entryIndex],
          message: field === 'certificateIdentityIds' ? 'duplicate_certificate' : 'duplicate_reference' });
        seen.add(id);
      });
    }
  });
}).transform((data) => ({ ...data, products: data.products.map((row) => ({ ...row,
  certificateIdentityIds: [...row.certificateIdentityIds].sort(),
})) }));
export type ProductsWrite = z.infer<typeof productsWriteSchema>;
export const productReferenceSchema = z.strictObject({
  id: z.uuid(), code: z.string(),
  names: z.strictObject({ kk: z.string().nullable(), ru: z.string().nullable(), en: z.string().nullable() }),
  retired: z.boolean(),
});
export type ProductReference = z.infer<typeof productReferenceSchema>;
export const productCommodityTypeSchema = productReferenceSchema.extend({ group: productReferenceSchema.nullable() });
export const productsReadSchema = z.strictObject({
  editable: productsWriteSchema,
  lines: z.array(z.strictObject({
    identityId: z.uuid(), source: z.enum(['manual', 'e_ondiris', 'migration']),
    nameEn: z.string().nullable(), nameRu: z.string().nullable(), commodityTypeId: z.uuid().nullable(),
    tnVedCode: z.string().nullable(), tnVedEntryId: z.uuid().nullable(),
    kpved: z.array(z.strictObject({ code: z.string(), sourceName: z.string().nullable(), entryId: z.uuid().nullable() })),
    capacityQuantity: z.string().nullable(), capacityUnitId: z.uuid().nullable(), capacityText: z.string().nullable(),
    inCountryValueShare: z.string().nullable(), enstruCode: z.string().nullable(), enstruName: z.string().nullable(),
    unifiedRegisterRegistrationNumber: z.string().nullable(), unifiedRegisterActive: z.boolean().nullable(),
    unifiedRegisterIncludedOn: z.iso.date().nullable(),
    productionSiteIdentityId: z.uuid().nullable(), note: z.string().nullable(), certificateIdentityIds: z.array(z.uuid()),
  })),
  extract: profileFileSchema.nullable(),
  // Selected metadata only. Large classification catalogues use the existing paginated dictionary API.
  selectedReferences: z.strictObject({ commodityTypes: z.array(productCommodityTypeSchema), tnVed: z.array(productReferenceSchema),
    kpved: z.array(productReferenceSchema), units: z.array(productReferenceSchema) }),
  // Frozen products expose stored facts and stable IDs; never join a later working Main/certificate graph.
  relatedChoices: z.strictObject({
    sites: z.array(z.strictObject({ identityId: z.uuid(), address: z.string().nullable(), city: z.string().nullable(), regionId: z.uuid().nullable() })),
    productCertificates: z.array(z.strictObject({ identityId: z.uuid(), number: z.string().nullable(),
      certificateType: productReferenceSchema.nullable(), customTypeName: z.string().nullable() })),
  }).nullable(),
});
export type ProductsRead = z.infer<typeof productsReadSchema>;
export const ownProductsSchema = sectionReadSchema(productsReadSchema);
export const saveProductsSchema = sectionSaveInputSchema(productsWriteSchema);
