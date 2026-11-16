import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { certificateGroup, productLineSource, recordStatus } from './enums.js';
import { fileObject, fileVersion } from './files.js';
import { dictionaryEntry } from './reference.js';
import { eOndirisRecord } from './e-ondiris.js';
import {
  certificateIdentity,
  documentIdentity,
  productionSiteIdentity,
  productLineIdentity,
  sectionRevision,
} from './profile.js';

/** DATA-01/GEN-11: every content link includes its organisation; partial drafts remain nullable (MAN-40). */
const revisionColumns = () => ({
  id: id(),
  sectionRevisionId: uuid('section_revision_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
});
const revisionFk = (name: string, t: { sectionRevisionId: AnyPgColumn; organizationId: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [t.sectionRevisionId, t.organizationId],
    foreignColumns: [sectionRevision.id, sectionRevision.organizationId],
  });
const tenantFk = (
  name: string,
  child: AnyPgColumn,
  org: AnyPgColumn,
  parent: { id: AnyPgColumn; organizationId: AnyPgColumn },
) => foreignKey({ name, columns: [child, org], foreignColumns: [parent.id, parent.organizationId] });
const reference = (name: string) => uuid(name).references(() => dictionaryEntry.id);
const position = () => integer('position_in_list').notNull().default(0);

/** MAN-06/10/21: legal data, founders and OKED are source-owned. No manual confirmation fields. */
export const mainInformation = pgTable(
  'main_information',
  {
    ...revisionColumns(),
    legalName: text('legal_name'),
    nameEn: text('name_en'),
    legalFormId: reference('legal_form_id'),
    legalFormSourceName: text('legal_form_source_name'),
    directorFullName: text('director_full_name'),
    stateRegisteredOn: date('state_registered_on'),
    legalAddress: text('legal_address'),
    legalDataCheckedAt: timestamp('legal_data_checked_at', { withTimezone: true }),
    website: text('website'),
    companyPhone: text('company_phone'),
    contactEmail: text('contact_email'),
    unifiedRegisterRegistered: boolean('unified_register_registered'),
    unifiedRegisterFirstInclusionOn: date('unified_register_first_inclusion_on'),
  },
  (t) => [
    revisionFk('main_information_revision_org_fk', t),
    uniqueIndex('main_information_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('main_information_revision_uq').on(t.sectionRevisionId),
    uniqueIndex('main_information_revision_org_uq').on(t.sectionRevisionId, t.organizationId),
  ],
);

export const mainInformationOked = pgTable(
  'main_information_oked',
  {
    id: id(),
    mainInformationId: uuid('main_information_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    code: text('code').notNull(),
    sourceName: text('source_name'),
    okedEntryId: reference('oked_entry_id'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    tenantFk('main_information_oked_parent_org_fk', t.mainInformationId, t.organizationId, mainInformation),
    uniqueIndex('main_information_oked_code_uq').on(t.mainInformationId, t.code),
  ],
);

export const companyFounder = pgTable(
  'company_founder',
  {
    id: id(),
    mainInformationId: uuid('main_information_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    positionInList: position(),
  },
  (t) => [tenantFk('company_founder_parent_org_fk', t.mainInformationId, t.organizationId, mainInformation)],
);

export const productionSite = pgTable(
  'production_site',
  {
    id: id(),
    mainInformationId: uuid('main_information_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    identityId: uuid('identity_id').notNull(),
    address: text('address'),
    regionId: reference('region_id'),
    city: text('city'),
    positionInList: position(),
  },
  (t) => [
    tenantFk('production_site_parent_org_fk', t.mainInformationId, t.organizationId, mainInformation),
    uniqueIndex('production_site_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('production_site_identity_uq').on(t.mainInformationId, t.identityId),
    tenantFk('production_site_identity_org_fk', t.identityId, t.organizationId, productionSiteIdentity),
  ],
);

/** MAN-13/14: missing fields are saved as NULL; uniqueness applies to supplied normalized values. */
export const contact = pgTable(
  'contact',
  {
    ...revisionColumns(),
    fullName: text('full_name'),
    position: text('position'),
    email: text('email'),
    phone: text('phone'),
    roleId: reference('role_id'),
    isFocalPoint: boolean('is_focal_point').notNull().default(false),
    positionInList: position(),
  },
  (t) => [
    revisionFk('contact_revision_org_fk', t),
    uniqueIndex('contact_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('contact_email_uq').on(t.sectionRevisionId, t.email),
    uniqueIndex('contact_phone_uq').on(t.sectionRevisionId, t.phone),
    uniqueIndex('contact_focal_point_uq')
      .on(t.sectionRevisionId)
      .where(sql`${t.isFocalPoint}`),
  ],
);

export const personnel = pgTable(
  'personnel',
  {
    ...revisionColumns(),
    managersCount: integer('managers_count'),
    engineersCount: integer('engineers_count'),
    productionWorkersCount: integer('production_workers_count'),
    nonresidentCount: integer('nonresident_count'),
  },
  (t) => [
    revisionFk('personnel_revision_org_fk', t),
    uniqueIndex('personnel_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('personnel_revision_uq').on(t.sectionRevisionId),
    check(
      'personnel_counts_ck',
      sql`coalesce(${t.managersCount},0) >= 0 and coalesce(${t.engineersCount},0) >= 0 and coalesce(${t.productionWorkersCount},0) >= 0 and coalesce(${t.nonresidentCount},0) >= 0`,
    ),
  ],
);

export const personnelOrgChart = pgTable(
  'personnel_org_chart',
  {
    id: id(),
    personnelId: uuid('personnel_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    fileObjectId: uuid('file_object_id').notNull(),
    positionInList: position(),
  },
  (t) => [
    tenantFk('personnel_org_chart_parent_org_fk', t.personnelId, t.organizationId, personnel),
    tenantFk('personnel_org_chart_file_org_fk', t.fileObjectId, t.organizationId, fileObject),
  ],
);

export const personnelCv = pgTable(
  'personnel_cv',
  {
    id: id(),
    personnelId: uuid('personnel_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    fileObjectId: uuid('file_object_id').notNull(),
    positionInList: position(),
  },
  (t) => [
    tenantFk('personnel_cv_parent_org_fk', t.personnelId, t.organizationId, personnel),
    tenantFk('personnel_cv_file_org_fk', t.fileObjectId, t.organizationId, fileObject),
  ],
);

/** MAN-23/25: no localization fields or single conformity file; source code spelling is retained. */
export const productLine = pgTable(
  'product_line',
  {
    ...revisionColumns(),
    identityId: uuid('identity_id').notNull(),
    nameEn: text('name_en'),
    nameRu: text('name_ru'),
    commodityTypeId: reference('commodity_type_id'),
    tnVedCode: text('tn_ved_code'),
    tnVedEntryId: reference('tn_ved_entry_id'),
    productionSiteIdentityId: uuid('production_site_identity_id'),
    capacityQuantity: numeric('capacity_quantity'),
    capacityUnitId: reference('capacity_unit_id'),
    capacityText: text('capacity_text'),
    inCountryValueShare: numeric('in_country_value_share', { precision: 5, scale: 2 }),
    enstruCode: text('enstru_code'),
    enstruName: text('enstru_name'),
    eOndirisRecordId: uuid('e_ondiris_record_id'),
    unifiedRegisterRegistrationNumber: text('unified_register_registration_number'),
    unifiedRegisterActive: boolean('unified_register_active'),
    unifiedRegisterIncludedOn: date('unified_register_included_on'),
    note: text('note'),
    source: productLineSource('source').notNull().default('manual'),
    positionInList: position(),
  },
  (t) => [
    revisionFk('product_line_revision_org_fk', t),
    uniqueIndex('product_line_id_org_uq').on(t.id, t.organizationId),
    tenantFk('product_line_identity_org_fk', t.identityId, t.organizationId, productLineIdentity),
    tenantFk('product_line_site_org_fk', t.productionSiteIdentityId, t.organizationId, productionSiteIdentity),
    uniqueIndex('product_line_revision_identity_uq').on(t.sectionRevisionId, t.identityId),
    uniqueIndex('product_line_id_identity_org_uq').on(t.id, t.identityId, t.organizationId),
    index('product_line_registry_number_idx').on(t.organizationId, t.unifiedRegisterRegistrationNumber),
    index('product_line_tn_ved_idx').on(t.organizationId, t.tnVedCode),
    check('product_line_capacity_ck', sql`${t.capacityQuantity} >= 0`),
    check('product_line_share_ck', sql`${t.inCountryValueShare} between 0 and 100`),
    // Historical nullable source links remain readable; linked facts belong to an immutable local snapshot.
    foreignKey({
      name: 'product_line_e_ondiris_snapshot_fk',
      columns: [t.eOndirisRecordId],
      foreignColumns: [eOndirisRecord.id],
    }),
    check('product_line_e_ondiris_source_ck', sql`${t.eOndirisRecordId} is null or ${t.source} = 'e_ondiris'`),
  ],
);

export const productLineKpved = pgTable(
  'product_line_kpved',
  {
    id: id(),
    productLineId: uuid('product_line_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    code: text('code').notNull(),
    sourceName: text('source_name'),
    kpvedEntryId: reference('kpved_entry_id'),
    positionInList: position(),
  },
  (t) => [
    tenantFk('product_line_kpved_parent_org_fk', t.productLineId, t.organizationId, productLine),
    uniqueIndex('product_line_kpved_code_uq').on(t.productLineId, t.code),
  ],
);

export const productsSection = pgTable(
  'products_section',
  {
    ...revisionColumns(),
    unifiedRegisterExtractId: uuid('unified_register_extract_id'),
  },
  (t) => [
    revisionFk('products_section_revision_org_fk', t),
    uniqueIndex('products_section_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('products_section_revision_uq').on(t.sectionRevisionId),
    tenantFk('products_section_extract_org_fk', t.unifiedRegisterExtractId, t.organizationId, fileObject),
  ],
);

export const production = pgTable(
  'production',
  {
    ...revisionColumns(),
    areaSqm: numeric('area_sqm'),
    workshopCount: integer('workshop_count'),
    utilisationPercent: numeric('utilisation_percent', { precision: 5, scale: 2 }),
  },
  (t) => [
    revisionFk('production_revision_org_fk', t),
    uniqueIndex('production_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('production_revision_uq').on(t.sectionRevisionId),
    check(
      'production_values_ck',
      sql`${t.areaSqm} >= 0 and ${t.workshopCount} >= 0 and ${t.utilisationPercent} between 0 and 100`,
    ),
  ],
);

export const productionProcess = pgTable(
  'production_process',
  {
    productionId: uuid('production_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    processEntryId: reference('process_entry_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productionId, t.processEntryId] }),
    tenantFk('production_process_parent_org_fk', t.productionId, t.organizationId, production),
  ],
);

export const productionPhoto = pgTable(
  'production_photo',
  {
    id: id(),
    productionId: uuid('production_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    fileObjectId: uuid('file_object_id').notNull(),
    positionInList: position(),
  },
  (t) => [
    tenantFk('production_photo_parent_org_fk', t.productionId, t.organizationId, production),
    tenantFk('production_photo_file_org_fk', t.fileObjectId, t.organizationId, fileObject),
  ],
);

export const equipmentItem = pgTable(
  'equipment_item',
  {
    ...revisionColumns(),
    name: text('name'),
    equipmentTypeId: reference('equipment_type_id'),
    quantity: integer('quantity'),
    positionInList: position(),
    photoFileId: uuid('photo_file_id'),
  },
  (t) => [
    revisionFk('equipment_item_revision_org_fk', t),
    uniqueIndex('equipment_item_id_org_uq').on(t.id, t.organizationId),
    tenantFk('equipment_item_photo_org_fk', t.photoFileId, t.organizationId, fileObject),
    check('equipment_item_quantity_ck', sql`${t.quantity} >= 0`),
  ],
);

export const equipmentProductLine = pgTable(
  'equipment_product_line',
  {
    equipmentItemId: uuid('equipment_item_id').notNull(),
    productLineIdentityId: uuid('product_line_identity_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.equipmentItemId, t.productLineIdentityId] }),
    tenantFk('equipment_product_line_equipment_org_fk', t.equipmentItemId, t.organizationId, equipmentItem),
    tenantFk('equipment_product_line_product_org_fk', t.productLineIdentityId, t.organizationId, productLineIdentity),
  ],
);

export const certificate = pgTable(
  'certificate',
  {
    ...revisionColumns(),
    identityId: uuid('identity_id').notNull(),
    positionInList: position(),
    group: certificateGroup('group'),
    certificateTypeId: reference('certificate_type_id'),
    customTypeName: text('custom_type_name'),
    notHeld: boolean('not_held').notNull().default(false),
    number: text('number'),
    issuingBody: text('issuing_body'),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    status: recordStatus('status').notNull().default('uploaded'),
    fileObjectId: uuid('file_object_id'),
  },
  (t) => [
    revisionFk('certificate_revision_org_fk', t),
    uniqueIndex('certificate_id_org_uq').on(t.id, t.organizationId),
    tenantFk('certificate_identity_org_fk', t.identityId, t.organizationId, certificateIdentity),
    tenantFk('certificate_file_org_fk', t.fileObjectId, t.organizationId, fileObject),
    uniqueIndex('certificate_revision_identity_uq').on(t.sectionRevisionId, t.identityId),
    check(
      'certificate_absence_ck',
      sql`not ${t.notHeld} or (${t.fileObjectId} is null and ${t.number} is null and ${t.issuingBody} is null and ${t.issuedOn} is null and ${t.expiresOn} is null)`,
    ),
  ],
);

export const productLineCertificate = pgTable(
  'product_line_certificate',
  {
    productLineId: uuid('product_line_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    certificateIdentityId: uuid('certificate_identity_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productLineId, t.certificateIdentityId] }),
    tenantFk('product_line_certificate_product_org_fk', t.productLineId, t.organizationId, productLine),
    tenantFk(
      'product_line_certificate_identity_org_fk',
      t.certificateIdentityId,
      t.organizationId,
      certificateIdentity,
    ),
  ],
);

/** MAN-38: no licence-required declaration. */
export const document = pgTable(
  'document',
  {
    ...revisionColumns(),
    identityId: uuid('identity_id').notNull(),
    positionInList: position(),
    documentTypeId: reference('document_type_id'),
    customName: text('custom_name'),
    status: recordStatus('status').notNull().default('uploaded'),
    fileObjectId: uuid('file_object_id'),
  },
  (t) => [
    revisionFk('document_revision_org_fk', t),
    uniqueIndex('document_id_org_uq').on(t.id, t.organizationId),
    tenantFk('document_identity_org_fk', t.identityId, t.organizationId, documentIdentity),
    uniqueIndex('document_revision_identity_uq').on(t.sectionRevisionId, t.identityId),
    tenantFk('document_file_org_fk', t.fileObjectId, t.organizationId, fileObject),
  ],
);

/** Frozen mandatory-type snapshot; copy-on-write must not inherit a previous submission (DATA-01). */
export const submissionRequirement = pgTable(
  'submission_requirement',
  {
    ...revisionColumns(),
    dictionaryEntryId: reference('dictionary_entry_id').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    revisionFk('submission_requirement_revision_org_fk', t),
    uniqueIndex('submission_requirement_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('submission_requirement_entry_uq').on(t.sectionRevisionId, t.dictionaryEntryId),
  ],
);

/** Technical immutable permitted-file snapshot: late replacements never change frozen reads (DATA-01, MAN-36). */
export const revisionFileVersion = pgTable(
  'revision_file_version',
  {
    sectionRevisionId: uuid('section_revision_id').notNull(),
    fileObjectId: uuid('file_object_id').notNull(),
    fileVersionId: uuid('file_version_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sectionRevisionId, t.fileObjectId] }),
    revisionFk('revision_file_version_revision_org_fk', t),
    tenantFk('revision_file_version_file_org_fk', t.fileObjectId, t.organizationId, fileObject),
    foreignKey({
      name: 'revision_file_version_version_object_fk',
      columns: [t.fileVersionId, t.fileObjectId],
      foreignColumns: [fileVersion.id, fileVersion.fileObjectId],
    }),
  ],
);
