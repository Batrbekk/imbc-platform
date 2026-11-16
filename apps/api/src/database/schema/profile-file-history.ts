import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { userAccounts } from './access.js';
import { fileObject, fileVersion } from './files.js';
import { sectionRevision } from './profile.js';

/** MAN-36: once-bound versions survive replacement in a working draft as well as frozen revisions. */
export const profileFileHistory = pgTable('profile_file_history', {
  id: id(),
  sectionRevisionId: uuid('section_revision_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  editVersion: integer('edit_version').notNull(),
  fileObjectId: uuid('file_object_id').notNull(),
  fileVersionId: uuid('file_version_id').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  actorId: uuid('actor_id').references(() => userAccounts.id),
}, (t) => [
  foreignKey({ name: 'profile_file_history_revision_org_fk', columns: [t.sectionRevisionId, t.organizationId],
    foreignColumns: [sectionRevision.id, sectionRevision.organizationId] }),
  foreignKey({ name: 'profile_file_history_file_org_fk', columns: [t.fileObjectId, t.organizationId],
    foreignColumns: [fileObject.id, fileObject.organizationId] }),
  foreignKey({ name: 'profile_file_history_version_object_fk', columns: [t.fileVersionId, t.fileObjectId],
    foreignColumns: [fileVersion.id, fileVersion.fileObjectId] }),
  uniqueIndex('profile_file_history_binding_uq').on(t.sectionRevisionId, t.editVersion, t.fileObjectId, t.fileVersionId),
  index('profile_file_history_revision_time_idx').on(t.sectionRevisionId, t.recordedAt, t.id),
  check('profile_file_history_edit_version_ck', sql`${t.editVersion} >= 0`),
]);
