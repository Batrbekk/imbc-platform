import { randomUUID } from 'node:crypto';
import type pg from 'pg';
export type ProfileGraphRow = Record<string, unknown>;
export type ProfileGraph = {
  profile: string;
  org: string;
  revisions: Record<string, string>;
  rows: Record<string, ProfileGraphRow>;
};
type Row = ProfileGraphRow;
type Graph = ProfileGraph;

/** Valid graph for PostgreSQL tests, including all child links and immutable file-version snapshot. */
export async function seedProfileGraph(
  pool: pg.Pool,
  base?: { profile: string; org: string },
  newRevisions = false,
): Promise<Graph> {
  const insert = async (table: string, values: Row): Promise<Row> => {
    const keys = Object.keys(values);
    return (
      await pool.query<Row>(
        `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        Object.values(values),
      )
    ).rows[0]!;
  };
  const newProfile = async () => {
    const o = await insert('organizations', { type: 'manufacturer', name: `Graph test ${randomUUID()}` });
    const p = await insert('manufacturer_profiles', { organization_id: o.id });
    return { profile: p.id as string, org: o.id as string };
  };
  const entry = async (code: string) => {
    const d = (await pool.query<{ id: string }>('SELECT id FROM dictionary WHERE code=$1', [code])).rows[0]!;
    return (await insert('dictionary_entry', { dictionary_id: d.id, code: `000${randomUUID()}` })).id;
  };
  const g: Graph = { ...(base ?? (await newProfile())), revisions: {}, rows: {} };
  const sections = (
    await pool.query<{ id: string; kind: string; working_revision_id: string }>(
      'SELECT * FROM profile_section WHERE profile_id=$1',
      [g.profile],
    )
  ).rows;
  for (const s of sections) {
    if (newRevisions) {
      const r = await insert('section_revision', {
        profile_section_id: s.id,
        organization_id: g.org,
        revision_number: 2,
      });
      await pool.query('UPDATE profile_section SET working_revision_id=$1 WHERE id=$2', [r.id, s.id]);
      g.revisions[s.kind] = r.id as string;
    } else g.revisions[s.kind] = s.working_revision_id;
  }
  const root = async (table: string, kind: string, values: Row = {}) => {
    g.rows[table] = await insert(table, { section_revision_id: g.revisions[kind], organization_id: g.org, ...values });
    return g.rows[table]!;
  };
  const child = async (table: string, parentColumn: string, parent: string, values: Row = {}) => {
    g.rows[table] = await insert(table, { [parentColumn]: g.rows[parent]!.id, organization_id: g.org, ...values });
    return g.rows[table]!;
  };
  const main = (
    await pool.query<Row>('SELECT * FROM main_information WHERE section_revision_id=$1', [g.revisions.main_information])
  ).rows[0];
  if (main) g.rows.main_information = main;
  else await root('main_information', 'main_information');
  const siteIdentity = await insert('production_site_identity', { profile_id: g.profile, organization_id: g.org });
  const productIdentity = await insert('product_line_identity', { profile_id: g.profile, organization_id: g.org });
  const certificateIdentity = await insert('certificate_identity', { profile_id: g.profile, organization_id: g.org });
  const hasDocumentIdentity = (await pool.query<{ exists: boolean }>(
    "select to_regclass('document_identity') is not null as exists",
  )).rows[0]!.exists;
  const documentIdentity = hasDocumentIdentity
    ? await insert('document_identity', { profile_id: g.profile, organization_id: g.org }) : null;
  const file = async (purpose: string) => {
    const object = await insert('file_object', { organization_id: g.org, purpose, data_class: 'b_manufacturer' });
    const version = await insert('file_version', {
      file_object_id: object.id,
      version_number: 1,
      original_name: 'test.pdf',
      byte_size: 1,
      declared_media_type: 'application/pdf',
      checksum: 'hash',
      storage_key: randomUUID(),
      scan_state: 'passed',
    });
    return { object, version };
  };
  const docFile = await file('document_file');
  const orgFile = await file('organisation_chart');
  const cvFile = await file('cv');
  const extractFile = await file('unified_register_extract');
  const photoFile = await file('production_photo');
  const certFile = await file('conformity_certificate');
  await child('main_information_oked', 'main_information_id', 'main_information', {
    code: '00123',
    source_name: 'Source spelling',
  });
  await child('company_founder', 'main_information_id', 'main_information', { name: 'Source founder' });
  await child('production_site', 'main_information_id', 'main_information', { identity_id: siteIdentity.id });
  await root('contact', 'contacts');
  await root('personnel', 'personnel');
  await child('personnel_org_chart', 'personnel_id', 'personnel', { file_object_id: orgFile.object.id });
  await child('personnel_cv', 'personnel_id', 'personnel', { file_object_id: cvFile.object.id });
  await root('products_section', 'products', { unified_register_extract_id: extractFile.object.id });
  await root('product_line', 'products', {
    identity_id: productIdentity.id,
    production_site_identity_id: siteIdentity.id,
    tn_ved_code: '0012345678',
  });
  await child('product_line_kpved', 'product_line_id', 'product_line', { code: '00121' });
  await root('production', 'production');
  await child('production_process', 'production_id', 'production', { process_entry_id: await entry('process') });
  await child('production_photo', 'production_id', 'production', { file_object_id: photoFile.object.id });
  await root('equipment_item', 'production', { photo_file_id: photoFile.object.id });
  await child('equipment_product_line', 'equipment_item_id', 'equipment_item', {
    product_line_identity_id: productIdentity.id,
  });
  await root('certificate', 'certificates', {
    identity_id: certificateIdentity.id,
    group: 'product',
    file_object_id: certFile.object.id,
  });
  await child('product_line_certificate', 'product_line_id', 'product_line', {
    certificate_identity_id: certificateIdentity.id,
  });
  await root('document', 'documents', { file_object_id: docFile.object.id,
    ...(documentIdentity ? { identity_id: documentIdentity.id } : {}) });
  await root('submission_requirement', 'certificates', {
    dictionary_entry_id: await entry('certificate_type'),
    captured_at: new Date(),
  });
  g.rows.revision_file_version = await insert('revision_file_version', {
    section_revision_id: g.revisions.documents,
    organization_id: g.org,
    file_object_id: docFile.object.id,
    file_version_id: docFile.version.id,
  });
  return g;
}
