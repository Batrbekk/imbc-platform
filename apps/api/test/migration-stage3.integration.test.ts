import { randomUUID } from 'node:crypto';
import { SECTION_KINDS } from '@imbc/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedProfileGraph, type ProfileGraph as Graph } from './support/profile-graph.js';

const LAST = '0015_stage3_profile_data';
const OLD = '0012_file_rejection_reason';
const legacyKinds = [
  'main',
  'contacts',
  'personnel',
  'shareholders',
  'products',
  'production',
  'certificates',
  'documents',
];
type Row = Record<string, unknown>;
const content = [
  ['main_information', 'main_information'],
  ['main_information_oked', 'main_information'],
  ['company_founder', 'main_information'],
  ['production_site', 'main_information'],
  ['contact', 'contacts'],
  ['personnel', 'personnel'],
  ['personnel_org_chart', 'personnel'],
  ['personnel_cv', 'personnel'],
  ['products_section', 'products'],
  ['product_line', 'products'],
  ['product_line_kpved', 'products'],
  ['product_line_certificate', 'products'],
  ['production', 'production'],
  ['production_process', 'production'],
  ['production_photo', 'production'],
  ['equipment_item', 'production'],
  ['equipment_product_line', 'production'],
  ['certificate', 'certificates'],
  ['document', 'documents'],
  ['submission_requirement', 'certificates'],
  ['revision_file_version', 'documents'],
] as const;
const pk = (table: string, row: Row) => {
  const keys =
    table === 'production_process'
      ? ['production_id', 'process_entry_id']
      : table === 'equipment_product_line'
        ? ['equipment_item_id', 'product_line_identity_id']
        : table === 'product_line_certificate'
          ? ['product_line_id', 'certificate_identity_id']
          : table === 'revision_file_version'
            ? ['section_revision_id', 'file_object_id']
            : ['id'];
  return { sql: keys.map((k, i) => `"${k}"=$${i + 1}`).join(' AND '), values: keys.map((k) => row[k]) };
};

// DATA-01/GEN-11/NFR-06: exercise SQL constraints and triggers, not copies of TypeScript validation.
describe.skipIf(!process.env.TEST_DATABASE_URL)('stage 3 profile migration and immutable graph', () => {
  vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });
  let pool: pg.Pool;
  let frozen: Graph;
  let working: Graph;
  let other: Graph;
  let legacyProfiles: string[];
  let author: string;
  const created = '2026-11-10T08:00:00.000Z';
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
    const o = await insert('organizations', {
      type: 'manufacturer',
      name: `Profile test ${randomUUID()}`,
      bin: randomUUID().replaceAll('-', '').slice(0, 12),
    });
    const p = await insert('manufacturer_profiles', { organization_id: o.id });
    return { profile: p.id as string, org: o.id as string };
  };
  const entry = async (code: string) => {
    const d = (await pool.query<{ id: string }>('SELECT id FROM dictionary WHERE code=$1', [code])).rows[0]!;
    return (await insert('dictionary_entry', { dictionary_id: d.id, code: `000${randomUUID()}` })).id;
  };
  const graph = (base?: { profile: string; org: string }, newRevisions = false) =>
    seedProfileGraph(pool, base, newRevisions);
  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool, OLD);
    const first = await newProfile();
    author = (
      await insert('user_accounts', {
        organization_id: first.org,
        role: 'manufacturer',
        email: `history-${randomUUID()}@imbc.local`,
      })
    ).id as string;
    legacyProfiles = [first.profile];
    for (let n = 0; n < 10; n++) legacyProfiles.push((await newProfile()).profile);
    for (const profile of legacyProfiles)
      for (const kind of legacyKinds) {
        const s = await insert('profile_sections', { profile_id: profile, kind });
        const r = await insert('section_revisions', {
          section_id: s.id,
          number: 1,
          author_id: author,
          created_at: created,
        });
        await pool.query('UPDATE profile_sections SET working_revision_id=$1 WHERE id=$2', [r.id, s.id]);
      }
    for (let n = 0; n < 12; n++) await newProfile();
    await migrateThrough(pool, LAST);
    frozen = await graph();
    await pool.query('BEGIN');
    try {
      await pool.query('UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1', [frozen.profile]);
      await pool.query("UPDATE section_revision SET state='submitted', submitted_at=now() WHERE id=ANY($1::uuid[])", [
        Object.values(frozen.revisions),
      ]);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
    working = await graph(frozen, true);
    other = await graph();
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('explicitly maps 88 empty skeleton containers to 77 new sections and preserves their author/time/history', async () => {
    const count = (await pool.query<{ n: number }>('SELECT count(*)::int n FROM profile_sections')).rows[0]!.n;
    expect(count).toBe(88);
    const rows = (
      await pool.query<{ kind: string; author_id: string; created_at: Date; revision_number: number; origin: string }>(
        'SELECT s.kind,r.author_id,r.created_at,r.revision_number,r.origin FROM profile_section s JOIN section_revision r ON r.profile_section_id=s.id WHERE s.profile_id=ANY($1::uuid[])',
        [legacyProfiles],
      )
    ).rows;
    expect(rows).toHaveLength(77);
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(SECTION_KINDS));
    for (const row of rows) {
      expect(row.author_id).toBe(author);
      expect(row.created_at.toISOString()).toBe(created);
      expect(row.revision_number).toBe(1);
      expect(row.origin).toBe('migration');
    }
  });
  it('idempotent bootstrap and R1 INSERT ON CONFLICT DO NOTHING/DO UPDATE/RETURNING/read/update/row lock remain valid through the view', async () => {
    const a = await newProfile();
    const initial = (
      await pool.query<{ id: string }>('SELECT id FROM profile_section WHERE profile_id=$1', [a.profile])
    ).rows
      .map((r) => r.id)
      .sort();
    await pool.query('SELECT stage3_create_sections($1,$2)', [a.profile, a.org]);
    const again = (
      await pool.query<{ id: string }>('SELECT id FROM profile_section WHERE profile_id=$1', [a.profile])
    ).rows
      .map((r) => r.id)
      .sort();
    expect(again).toEqual(initial);
    expect(
      (
        await pool.query(
          'INSERT INTO manufacturer_profiles (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING RETURNING id',
          [a.org],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "INSERT INTO manufacturer_profiles (organization_id,source) VALUES ($1,'migration') ON CONFLICT (organization_id) DO UPDATE SET source=excluded.source RETURNING id,source",
          [a.org],
        )
      ).rows[0],
    ).toMatchObject({ id: a.profile, source: 'migration' });
    expect(
      (await pool.query('SELECT p.id FROM manufacturer_profiles p WHERE organization_id=$1 FOR UPDATE OF p', [a.org]))
        .rows[0],
    ).toMatchObject({ id: a.profile });
    expect(
      (
        await pool.query('UPDATE manufacturer_profiles SET heard_about_us=$1 WHERE id=$2 RETURNING heard_about_us', [
          'R1',
          a.profile,
        ])
      ).rows[0],
    ).toEqual({ heard_about_us: 'R1' });
    expect(
      (
        await pool.query(
          'SELECT origin FROM section_revision WHERE profile_section_id IN (SELECT id FROM profile_section WHERE profile_id=$1)',
          [a.profile],
        )
      ).rows.every((r: Row) => r.origin === 'manufacturer'),
    ).toBe(true);
  });
  it('allows partial contact rows, one focal point, leading zero codes and decimal completeness', async () => {
    await insert('contact', { section_revision_id: working.revisions.contacts, organization_id: working.org });
    await insert('contact', {
      section_revision_id: working.revisions.contacts,
      organization_id: working.org,
      is_focal_point: true,
    });
    await expect(
      insert('contact', {
        section_revision_id: working.revisions.contacts,
        organization_id: working.org,
        is_focal_point: true,
      }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(working.rows.main_information_oked!.code).toBe('00123');
    expect(working.rows.product_line!.tn_ved_code).toBe('0012345678');
    await pool.query('UPDATE section_revision SET completeness_percent=$1 WHERE id=$2', [
      '66.66666666666667',
      working.revisions.contacts,
    ]);
    expect(
      (await pool.query('SELECT completeness_percent FROM section_revision WHERE id=$1', [working.revisions.contacts]))
        .rows[0]!.completeness_percent,
    ).toBe('66.66666666666667');
  });
  it('rejects another working revision, wrong section kind, wrong section pointer and wrong pointer state', async () => {
    const s = (
      await pool.query('SELECT profile_section_id FROM section_revision WHERE id=$1', [working.revisions.contacts])
    ).rows[0]!.profile_section_id;
    await expect(
      insert('section_revision', { profile_section_id: s, organization_id: working.org, revision_number: 3 }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query("UPDATE section_revision SET state='superseded' WHERE id=$1", [working.revisions.contacts]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('contact', { section_revision_id: working.revisions.documents, organization_id: working.org }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE profile_section SET working_revision_id=$1 WHERE id=$2', [working.revisions.documents, s]),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query('UPDATE profile_section SET verified_revision_id=$1 WHERE id=$2', [working.revisions.contacts, s]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('rejects cross-tenant root, child, identity, dictionary and file-version associations; referenced dictionary values cannot be deleted', async () => {
    await expect(
      insert('contact', { section_revision_id: working.revisions.contacts, organization_id: other.org }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      insert('production_site', {
        main_information_id: working.rows.main_information!.id,
        organization_id: other.org,
        identity_id: other.rows.production_site!.identity_id,
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      insert('product_line', {
        section_revision_id: working.revisions.products,
        organization_id: working.org,
        identity_id: other.rows.product_line!.identity_id,
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      insert('document', {
        section_revision_id: working.revisions.documents,
        organization_id: working.org,
        file_object_id: other.rows.document!.file_object_id,
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      insert('revision_file_version', {
        section_revision_id: working.revisions.contacts,
        organization_id: working.org,
        file_object_id: working.rows.document!.file_object_id,
        file_version_id: other.rows.revision_file_version!.file_version_id,
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      insert('contact', {
        section_revision_id: working.revisions.contacts,
        organization_id: working.org,
        role_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query('DELETE FROM dictionary_entry WHERE id=$1', [working.rows.production_process!.process_entry_id]),
    ).rejects.toMatchObject({ code: '23503' });
  });
  for (const [table] of content)
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      it(`${table}: frozen ${operation} is refused before content can change`, async () => {
        const row = frozen.rows[table]!;
        const selector = pk(table, row);
        if (operation === 'INSERT') {
          const value = { ...row, ...('id' in row ? { id: randomUUID() } : {}) };
          await expect(
            pool.query(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_record(NULL::"${table}",$1::jsonb)`, [
              JSON.stringify(value),
            ]),
          ).rejects.toMatchObject({ code: '23514' });
        } else if (operation === 'UPDATE') {
          const first = Object.keys(row)[0]!;
          await expect(
            pool.query(`UPDATE "${table}" SET "${first}"="${first}" WHERE ${selector.sql}`, selector.values),
          ).rejects.toMatchObject({ code: '23514' });
        } else
          await expect(
            pool.query(`DELETE FROM "${table}" WHERE ${selector.sql}`, selector.values),
          ).rejects.toMatchObject({ code: '23514' });
      });
    }
  for (const [table, parentColumn, parentTable] of [
    ['company_founder', 'main_information_id', 'main_information'],
    ['production_site', 'main_information_id', 'main_information'],
    ['personnel_cv', 'personnel_id', 'personnel'],
    ['product_line_kpved', 'product_line_id', 'product_line'],
    ['production_photo', 'production_id', 'production'],
    ['equipment_product_line', 'equipment_item_id', 'equipment_item'],
  ])
    for (const direction of ['from_frozen', 'to_frozen']) {
      it(`${table}: UPDATE checks both parents (${direction})`, async () => {
        const source = direction === 'from_frozen' ? frozen : working;
        const target = direction === 'from_frozen' ? working : frozen;
        const selector = pk(table!, source.rows[table!]!);
        await expect(
          pool.query(`UPDATE "${table}" SET "${parentColumn}"=$${selector.values.length + 1} WHERE ${selector.sql}`, [
            ...selector.values,
            target.rows[parentTable!]!.id,
          ]),
        ).rejects.toMatchObject({ code: '23514' });
      });
    }
  it('frozen metadata and source_refresh cannot bypass business immutability; review state can progress', async () => {
    await expect(
      pool.query("UPDATE section_revision SET origin='source_refresh' WHERE id=$1", [frozen.revisions.products]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE section_revision SET saved_at=now() WHERE id=$1', [frozen.revisions.contacts]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE section_revision SET state='working' WHERE id=$1", [frozen.revisions.contacts]),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query("UPDATE section_revision SET state='verified' WHERE id=$1", [frozen.revisions.contacts]);
    await expect(
      pool.query('DELETE FROM section_revision WHERE id=$1', [frozen.revisions.contacts]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('early SET CONSTRAINTS serializes pointer assignment with a concurrent non-key revision state transition', async () => {
    const g = await newProfile();
    const s = (
      await pool.query<{ id: string; working_revision_id: string }>(
        "SELECT id,working_revision_id FROM profile_section WHERE profile_id=$1 AND kind='contacts'",
        [g.profile],
      )
    ).rows[0]!;
    const setup = await pool.connect();
    try {
      await setup.query('BEGIN');
      await setup.query('UPDATE profile_section SET working_revision_id=NULL WHERE id=$1', [s.id]);
      await setup.query("UPDATE section_revision SET state='submitted',submitted_at=now() WHERE id=$1", [
        s.working_revision_id,
      ]);
      await setup.query('COMMIT');
    } catch (e) {
      await setup.query('ROLLBACK');
      throw e;
    } finally {
      setup.release();
    }
    const pointer = await pool.connect();
    const review = await pool.connect();
    try {
      await pointer.query('BEGIN');
      await pointer.query('UPDATE profile_section SET pending_revision_id=$1 WHERE id=$2', [
        s.working_revision_id,
        s.id,
      ]);
      await pointer.query('SET CONSTRAINTS ALL IMMEDIATE');
      await review.query('BEGIN');
      await review.query("SET LOCAL lock_timeout='100ms'");
      let outcome = 'committed';
      try {
        await review.query("UPDATE section_revision SET state='verified' WHERE id=$1", [s.working_revision_id]);
        await review.query('COMMIT');
      } catch (e) {
        await review.query('ROLLBACK');
        if ((e as { code?: string }).code !== '55P03') throw e;
        outcome = 'lock_timeout';
      }
      await pointer.query('COMMIT');
      const current = (
        await pool.query<{ state: string; pending_revision_id: string }>(
          'SELECT r.state,s.pending_revision_id FROM profile_section s JOIN section_revision r ON r.id=s.pending_revision_id WHERE s.id=$1',
          [s.id],
        )
      ).rows[0]!;
      expect(current).toEqual({ state: 'submitted', pending_revision_id: s.working_revision_id });
      expect(outcome).toBe('lock_timeout');
      // After the pointer commits, an isolated state-only transition must fail its final pointer check.
      await review.query('BEGIN');
      await review.query("UPDATE section_revision SET state='verified' WHERE id=$1", [s.working_revision_id]);
      await expect(review.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await pointer.query('ROLLBACK');
      await review.query('ROLLBACK');
      pointer.release();
      review.release();
    }
  });
  it('actual content-write locks serialize with freezing in both directions', async () => {
    const writer = await pool.connect();
    const sender = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('UPDATE contact SET full_name=$1 WHERE id=$2', ['Uncommitted', working.rows.contact!.id]);
      await sender.query('BEGIN');
      await sender.query("SET LOCAL lock_timeout='100ms'");
      await expect(
        sender.query("UPDATE section_revision SET state='submitted',submitted_at=now() WHERE id=$1", [
          working.revisions.contacts,
        ]),
      ).rejects.toMatchObject({ code: '55P03' });
      await sender.query('ROLLBACK');
      await writer.query('ROLLBACK');
      await sender.query('BEGIN');
      await sender.query("UPDATE section_revision SET state='submitted',submitted_at=now() WHERE id=$1", [
        working.revisions.contacts,
      ]);
      await writer.query('BEGIN');
      await writer.query("SET LOCAL lock_timeout='100ms'");
      await expect(
        writer.query('UPDATE contact SET full_name=$1 WHERE id=$2', ['Race', working.rows.contact!.id]),
      ).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await writer.query('ROLLBACK');
      await sender.query('ROLLBACK');
      writer.release();
      sender.release();
    }
  });
  for (const state of ['submitted', 'verified', 'rejected'])
    it(`immutable content also holds in ${state} state`, async () => {
      const g = await graph();
      const revision = g.revisions.contacts;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1 AND kind='contacts'",
          [g.profile],
        );
        await client.query("UPDATE section_revision SET state='submitted',submitted_at=now() WHERE id=$1", [revision]);
        if (state !== 'submitted')
          await client.query('UPDATE section_revision SET state=$1 WHERE id=$2', [state, revision]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      await expect(
        pool.query('UPDATE contact SET full_name=$1 WHERE id=$2', ['Forbidden', g.rows.contact!.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  it('a snapshot may not include a pending or rejected scan', async () => {
    const f = await insert('file_object', {
      organization_id: working.org,
      purpose: 'document_file',
      data_class: 'b_manufacturer',
    });
    const v = await insert('file_version', {
      file_object_id: f.id,
      version_number: 1,
      original_name: 'scan.pdf',
      byte_size: 1,
      declared_media_type: 'application/pdf',
      checksum: 'hash',
      storage_key: randomUUID(),
    });
    await expect(
      insert('revision_file_version', {
        section_revision_id: working.revisions.contacts,
        organization_id: working.org,
        file_object_id: f.id,
        file_version_id: v.id,
      }),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query("UPDATE file_version SET scan_state='rejected' WHERE id=$1", [v.id]);
    await expect(
      insert('revision_file_version', {
        section_revision_id: working.revisions.contacts,
        organization_id: working.org,
        file_object_id: f.id,
        file_version_id: v.id,
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('app role cannot TRUNCATE around immutable row guards; stable identity ownership cannot be moved', async () => {
    const role = `stage3_test_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE ROLE "${role}"`);
    try {
      await applyAppRoleGrants(pool, role);
      expect(
        (await pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, 'section_revision', 'TRUNCATE']))
          .rows[0]!.allowed,
      ).toBe(false);
      expect(
        (await pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, 'contact', 'INSERT'])).rows[0]!
          .allowed,
      ).toBe(true);
    } finally {
      await pool.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
    }
    await expect(
      pool.query('UPDATE production_site_identity SET profile_id=$1,organization_id=$2 WHERE id=$3', [
        other.profile,
        other.org,
        working.rows.production_site!.identity_id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'stage 3 refuses nonempty legacy business data without deleting history',
  () => {
    let pool: pg.Pool;
    beforeAll(() => {
      pool = openTestPool();
    });
    afterAll(async () => {
      await pool?.end();
    });
    it('one legacy JSON business value rolls the whole upgrade back, including the table rename', async () => {
      await resetDatabase(pool);
      await migrateThrough(pool, OLD);
      const org = (
        await pool.query("INSERT INTO organizations (type,name) VALUES ('manufacturer','Refusal test') RETURNING id")
      ).rows[0]!.id;
      const p = (
        await pool.query('INSERT INTO manufacturer_profiles (organization_id) VALUES ($1) RETURNING id', [org])
      ).rows[0]!.id;
      const s = (
        await pool.query("INSERT INTO profile_sections (profile_id,kind) VALUES ($1,'main') RETURNING id", [p])
      ).rows[0]!.id;
      const r = (
        await pool.query(
          'INSERT INTO section_revisions (section_id,number,data) VALUES ($1,1,\'{"website":"https://history.local"}\') RETURNING id,data',
          [s],
        )
      ).rows[0]!;
      await expect(migrateThrough(pool, LAST)).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/section_revisions.*converter required/) }),
      });
      expect((await pool.query('SELECT data FROM section_revisions WHERE id=$1', [r.id])).rows[0]!.data).toEqual(
        r.data,
      );
      expect((await pool.query("SELECT to_regclass('public.manufacturer_profile') AS name")).rows[0]!.name).toBeNull();
      expect(
        (await pool.query("SELECT relkind FROM pg_class WHERE oid='public.manufacturer_profiles'::regclass")).rows[0]!
          .relkind,
      ).toBe('r');
    });
  },
);
