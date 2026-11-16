import { z } from 'zod';
import { draftTextSchema } from './profile-fields.js';
import { profileFileSchema } from './profile-files.js';
import { productCapacitySchema, productReferenceSchema } from './profile-products.js';
import { sectionReadSchema, sectionSaveInputSchema } from './profile-sections.js';

const uuid = z.uuid().transform((id) => id.toLowerCase());
/** Nullable draft counts; the ceiling belongs to PostgreSQL int storage, not business completeness. */
export const productionCountSchema = z.number().int().min(0).max(2_147_483_647).nullable();
/** DBML numeric(5,2): reject precision loss instead of letting PostgreSQL round a submitted value. */
export const productionUtilisationSchema = productCapacitySchema.superRefine((value, ctx) => {
  if (value === null) return;
  const [whole, fraction] = value.split('.');
  if (whole!.length > 3 || whole! > '100' && whole!.length === 3 || whole === '100' && fraction !== undefined)
    ctx.addIssue({ code: 'custom', message: 'percent_range' });
  if (fraction && fraction.length > 2) ctx.addIssue({ code: 'custom', message: 'decimal_precision' });
});
export const productionEquipmentWriteSchema = z.strictObject({
  name: draftTextSchema, typeId: uuid.nullable(), quantity: productionCountSchema,
  photoId: uuid.nullable(), productIdentityIds: z.array(uuid),
});
export const productionWriteSchema = z.strictObject({
  areaSqm: productCapacitySchema, workshopCount: productionCountSchema, utilisationPercent: productionUtilisationSchema,
  processEntryIds: z.array(uuid), photoIds: z.array(uuid), equipment: z.array(productionEquipmentWriteSchema),
}).superRefine((data, ctx) => {
  const processes = new Set<string>();
  data.processEntryIds.forEach((id, index) => {
    if (processes.has(id)) ctx.addIssue({ code: 'custom', path: ['processEntryIds', index], message: 'duplicate_reference' });
    processes.add(id);
  });
  const photos = new Set<string>();
  data.photoIds.forEach((id, index) => {
    if (photos.has(id)) ctx.addIssue({ code: 'custom', path: ['photoIds', index], message: 'duplicate_file' });
    photos.add(id);
  });
  data.equipment.forEach((row, index) => {
    const products = new Set<string>();
    row.productIdentityIds.forEach((id, linkIndex) => {
      if (products.has(id)) ctx.addIssue({ code: 'custom', path: ['equipment', index, 'productIdentityIds', linkIndex], message: 'duplicate_product' });
      products.add(id);
    });
  });
}).transform((data) => ({ ...data, processEntryIds: [...data.processEntryIds].sort(), equipment: data.equipment.map((row) => ({
  ...row, productIdentityIds: [...row.productIdentityIds].sort(),
})) }));
export type ProductionWrite = z.infer<typeof productionWriteSchema>;
export const productionProductChoiceSchema = z.strictObject({ identityId: z.uuid(), nameEn: z.string().nullable(), nameRu: z.string().nullable(),
  tnVedCode: z.string().nullable(), source: z.enum(['manual', 'e_ondiris', 'migration']) });
export const productionEditorChoicesSchema = z.array(productionProductChoiceSchema);
export const productionReadSchema = z.strictObject({
  editable: productionWriteSchema,
  photos: z.array(profileFileSchema), equipmentPhotos: z.array(profileFileSchema.nullable()),
  selectedReferences: z.strictObject({ processes: z.array(productReferenceSchema), equipmentTypes: z.array(productReferenceSchema) }),
  productChoices: productionEditorChoicesSchema.nullable(),
});
export type ProductionRead = z.infer<typeof productionReadSchema>;
export const ownProductionSchema = sectionReadSchema(productionReadSchema);
export const saveProductionSchema = sectionSaveInputSchema(productionWriteSchema);
