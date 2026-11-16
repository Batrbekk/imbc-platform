import { randomUUID } from 'node:crypto';
import type { SectionKind } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';

interface ContentTable {
  name: string;
  revisionColumn?: string;
  parent?: { table: string; column: string };
  hasId: boolean;
  timestampColumns?: readonly string[];
}

const root = (name: string): ContentTable => ({ name, revisionColumn: 'section_revision_id', hasId: true });
const child = (name: string, table: string, column: string, hasId = true): ContentTable => ({
  name,
  parent: { table, column },
  hasId,
});

/**
 * DATA-01: every content row is copied, in parent-first order. Stable identities, file objects,
 * reference entries, and immutable source records keep their IDs. submission_requirement and
 * revision_file_version belong to one send operation and are deliberately absent from this copy graph.
 * Static table/column names only; no identifier comes from an HTTP request.
 */
export const SECTION_CONTENT_TABLES: Readonly<Record<SectionKind, readonly ContentTable[]>> = {
  main_information: [
    { ...root('main_information'), timestampColumns: ['legal_data_checked_at'] },
    child('main_information_oked', 'main_information', 'main_information_id'),
    child('company_founder', 'main_information', 'main_information_id'),
    child('production_site', 'main_information', 'main_information_id'),
    {
      ...child('main_source_pin', 'main_information', 'main_information_id'),
      timestampColumns: ['e_ondiris_observed_at', 'latest_attempt_completed_at'],
    },
    child('main_contact_ownership', 'main_information', 'main_information_id'),
    child('main_site_ownership', 'main_information', 'main_information_id'),
    child('main_site_source_binding', 'main_information', 'main_information_id'),
  ],
  contacts: [root('contact')],
  personnel: [
    root('personnel'),
    child('personnel_org_chart', 'personnel', 'personnel_id'),
    child('personnel_cv', 'personnel', 'personnel_id'),
  ],
  products: [
    root('products_section'),
    root('product_line'),
    child('product_line_kpved', 'product_line', 'product_line_id'),
    child('product_line_certificate', 'product_line', 'product_line_id', false),
  ],
  production: [
    root('production'),
    child('production_process', 'production', 'production_id', false),
    child('production_photo', 'production', 'production_id'),
    root('equipment_item'),
    child('equipment_product_line', 'equipment_item', 'equipment_item_id', false),
  ],
  certificates: [root('certificate')],
  documents: [root('document')],
};

type ContentRow = Record<string, unknown>;
export type RevisionContent = Record<string, ContentRow[]>;

/** Complete before/after values are persisted only in the append-only audit, never application logs. */
export async function revisionContent(
  tx: Database,
  kind: SectionKind,
  revisionId: string,
  organizationId: string,
): Promise<RevisionContent> {
  const content: RevisionContent = {};
  for (const table of SECTION_CONTENT_TABLES[kind]) {
    let selector;
    if (table.revisionColumn) {
      selector = sql`${sql.identifier(table.revisionColumn)} = ${revisionId}`;
    } else {
      const parentIds = content[table.parent!.table]!.map((row) => row.id as string);
      if (parentIds.length === 0) {
        content[table.name] = [];
        continue;
      }
      selector = sql`${sql.identifier(table.parent!.column)} in (${sql.join(
        parentIds.map((id) => sql`${id}`),
        sql`, `,
      )})`;
    }
    const result = await tx.execute(sql`
      select *${
        table.timestampColumns?.length
          ? sql`, ${sql.join(
              table.timestampColumns.map((column) => sql`${sql.identifier(column)}::text AS ${sql.identifier(column)}`),
              sql`, `,
            )}`
          : sql``
      } from ${sql.identifier(table.name)}
      where organization_id = ${organizationId} and ${selector}
      order by ${sql.identifier(table.hasId ? 'id' : table.parent!.column)}
    `);
    content[table.name] = result.rows as ContentRow[];
  }
  return content;
}

/** The caller has already inserted a working target revision and holds the own-profile lock. */
export async function copyRevisionContent(
  tx: Database,
  kind: SectionKind,
  sourceRevisionId: string,
  targetRevisionId: string,
  organizationId: string,
): Promise<void> {
  const content = await revisionContent(tx, kind, sourceRevisionId, organizationId);
  const remapped = new Map<string, Map<string, string>>();
  for (const table of SECTION_CONTENT_TABLES[kind]) {
    const idMap = new Map<string, string>();
    remapped.set(table.name, idMap);
    for (const original of content[table.name]!) {
      const row: ContentRow = { ...original };
      if (table.hasId) {
        const newId = randomUUID();
        idMap.set(original.id as string, newId);
        row.id = newId;
      }
      if (table.revisionColumn) row[table.revisionColumn] = targetRevisionId;
      if (table.parent) {
        const parentId = remapped.get(table.parent.table)?.get(original[table.parent.column] as string);
        if (!parentId) throw new Error('Revision copy parent is missing');
        row[table.parent.column] = parentId;
      }
      const columns = Object.keys(row);
      await tx.execute(sql`
        insert into ${sql.identifier(table.name)} (${sql.join(columns.map(sql.identifier), sql`, `)})
        values (${sql.join(
          // Array-valued provenance is one PostgreSQL parameter, not a SQL tuple (an empty list is not `()`).
          columns.map((column) => sql`${sql.param(row[column])}`),
          sql`, `,
        )})
      `);
    }
  }
}
