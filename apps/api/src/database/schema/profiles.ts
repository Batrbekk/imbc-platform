import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_shared.js';
import { organizations, userAccounts } from './access.js';
import {
  capacityUnit,
  commodityGroup,
  contactRole,
  decision,
  documentStatus,
  profileSection,
  profileStatus,
  revisionState,
  scanState,
  updateStatus,
  valueSource,
} from './enums.js';

/** Профиль производителя: один на организацию (D-01, MAN-03). */
export const manufacturerProfiles = pgTable(
  'manufacturer_profiles',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    status: profileStatus('status').notNull().default('draft'),
    hasPendingChanges: boolean('has_pending_changes').notNull().default(false),
    /** Статус актуальности появляется после первой верификации (UPD-01). */
    updateStatus: updateStatus('update_status'),
    quarterAnchorAt: date('quarter_anchor_at'),
    missedQuarters: smallint('missed_quarters').notNull().default(0),
    finalNoticeDueAt: date('final_notice_due_at'),
    assignedExpertId: uuid('assigned_expert_id').references(() => userAccounts.id),
    completenessPct: smallint('completeness_pct').notNull().default(0),
    /** «Как вы узнали о нас» — только для IMBC (MAN-01, класс B). */
    heardAboutUs: text('heard_about_us'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    source: valueSource('source').notNull().default('manual'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('manufacturer_profiles_org_uq').on(t.organizationId),
    index('manufacturer_profiles_status_idx').on(t.status),
  ],
);

/**
 * Секция профиля с двумя указателями (ADR-02): verified — что видят операторы,
 * pending — что ждёт эксперта. Редакции неизменяемы после отправки (DATA-01).
 */
export const profileSections = pgTable(
  'profile_sections',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
    kind: profileSection('kind').notNull(),
    verifiedRevisionId: uuid('verified_revision_id'),
    pendingRevisionId: uuid('pending_revision_id'),
    workingRevisionId: uuid('working_revision_id'),
    completenessPct: smallint('completeness_pct').notNull().default(0),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('profile_sections_uq').on(t.profileId, t.kind)],
);

/** Редакция секции: скалярные поля в data, строки — в дочерних таблицах по revision_id. */
export const sectionRevisions = pgTable(
  'section_revisions',
  {
    id: id(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => profileSections.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    state: revisionState('state').notNull().default('working'),
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`),
    source: valueSource('source').notNull().default('manual'),
    authorId: uuid('author_id').references(() => userAccounts.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('section_revisions_number_uq').on(t.sectionId, t.number)],
);

/** Контакт (MAN-20, MAN-21): ≥ 3 на профиль, ровно один focal point на редакцию. */
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => sectionRevisions.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    position: text('position').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    role: contactRole('role').notNull(),
    isFocalPoint: boolean('is_focal_point').notNull().default(false),
    sortOrder: smallint('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('contacts_focal_point_uq')
      .on(t.revisionId)
      .where(sql`${t.isFocalPoint}`),
    index('contacts_revision_idx').on(t.revisionId),
  ],
);

/** Акционер (MAN-40). Сумма ≠ 100 % — предупреждение, не блокировка (MAN-41). */
export const shareholders = pgTable('shareholders', {
  id: id(),
  revisionId: uuid('revision_id')
    .notNull()
    .references(() => sectionRevisions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sharePct: numeric('share_pct', { precision: 5, scale: 2 }).notNull(),
  country: text('country').notNull(),
});

/** Продуктовая линия (MAN-50…52). Коды — текст с ведущими нулями (DATA-03). */
export const productLines = pgTable(
  'product_lines',
  {
    id: id(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => sectionRevisions.id, { onDelete: 'cascade' }),
    nameEn: text('name_en').notNull(),
    nameRu: text('name_ru').notNull(),
    commodityGroup: commodityGroup('commodity_group').notNull(),
    commodityType: text('commodity_type').notNull(),
    tnved: text('tnved').notNull(),
    kpved: text('kpved'),
    capacityValue: numeric('capacity_value', { precision: 14, scale: 2 }).notNull(),
    capacityUnit: capacityUnit('capacity_unit').notNull(),
    inCountryValuePct: numeric('in_country_value_pct', { precision: 5, scale: 2 }),
    localizationSteps: smallint('localization_steps'),
    localizationStepsOf: smallint('localization_steps_of'),
    conformityFileId: uuid('conformity_file_id'),
    source: valueSource('source').notNull().default('manual'),
  },
  (t) => [index('product_lines_revision_idx').on(t.revisionId), index('product_lines_tnved_idx').on(t.tnved)],
);

/** Оборудование: название, тип, количество; без года и места (MAN-62). */
export const equipmentItems = pgTable('equipment_items', {
  id: id(),
  revisionId: uuid('revision_id')
    .notNull()
    .references(() => sectionRevisions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  quantity: integer('quantity').notNull(),
});

export const equipmentProductLinks = pgTable(
  'equipment_product_links',
  {
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),
    productLineId: uuid('product_line_id')
      .notNull()
      .references(() => productLines.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.equipmentId, t.productLineId] })],
);

/** Файл и его версии: объект в S3 отдельно от записи (DATA-05, ADR-12). */
export const fileObjects = pgTable('file_objects', {
  id: id(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  /** Класс данных для policy-слоя (архитектура §9): A, B, C, D, E, F. */
  dataClass: text('data_class').notNull(),
  createdAt: createdAt(),
});

export const fileVersions = pgTable(
  'file_versions',
  {
    id: id(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => fileObjects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    scanState: scanState('scan_state').notNull().default('pending'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    uploadedBy: uuid('uploaded_by').references(() => userAccounts.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('file_versions_uq').on(t.fileId, t.version)],
);

/** Сертификат (MAN-70…73). Истечение не скрывает профиль (REV-20). */
export const certificates = pgTable(
  'certificates',
  {
    id: id(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => sectionRevisions.id, { onDelete: 'cascade' }),
    typeCode: text('type_code').notNull(),
    customTypeName: text('custom_type_name'),
    number: text('number').notNull(),
    issuer: text('issuer').notNull(),
    issuedOn: date('issued_on').notNull(),
    expiresOn: date('expires_on'),
    fileId: uuid('file_id').references(() => fileObjects.id),
    status: documentStatus('status').notNull().default('uploaded'),
  },
  (t) => [index('certificates_expires_idx').on(t.expiresOn)],
);

/** Документ (MAN-80…83); «лицензия не требуется» — заявление со статусом (MAN-81). */
export const documents = pgTable('documents', {
  id: id(),
  revisionId: uuid('revision_id')
    .notNull()
    .references(() => sectionRevisions.id, { onDelete: 'cascade' }),
  typeCode: text('type_code').notNull(),
  fileId: uuid('file_id').references(() => fileObjects.id),
  noLicenceRequired: boolean('no_licence_required').notNull().default(false),
  status: documentStatus('status').notNull().default('uploaded'),
});

/** Очередь проверки (REV-01…04). */
export const reviewAssignments = pgTable('review_assignments', {
  id: id(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
  expertId: uuid('expert_id').references(() => userAccounts.id),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closeReason: text('close_reason'),
});

/** Решение эксперта привязано к конкретной редакции или версии файла (ADR-02). */
export const reviewDecisions = pgTable('review_decisions', {
  id: id(),
  assignmentId: uuid('assignment_id')
    .notNull()
    .references(() => reviewAssignments.id, { onDelete: 'cascade' }),
  sectionRevisionId: uuid('section_revision_id').references(() => sectionRevisions.id),
  fileVersionId: uuid('file_version_id').references(() => fileVersions.id),
  decision: decision('decision').notNull(),
  comment: text('comment'),
  expertId: uuid('expert_id')
    .notNull()
    .references(() => userAccounts.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Подтверждения актуальности (UPD-05): каждая секция при возврате из unresponsive. */
export const updateConfirmations = pgTable('update_confirmations', {
  id: id(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
  section: profileSection('section'),
  confirmedBy: uuid('confirmed_by')
    .notNull()
    .references(() => userAccounts.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  ip: inet('ip'),
});
