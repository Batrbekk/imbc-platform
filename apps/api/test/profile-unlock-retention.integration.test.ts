import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { SectionKind } from '@imbc/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import { applyMigrations } from '../src/database/migrator.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedProfileGraph, type ProfileGraph } from './support/profile-graph.js';

type Connection = pg.Pool | pg.PoolClient;
type Values = Record<string, unknown>;
const received = '2026-11-16T00:00:00Z',
  decided = '2026-11-16T00:01:00Z',
  closed = '2026-11-16T00:02:00Z';
const secondReceived = '2026-11-16T00:03:00Z';

describe.skipIf(!process.env.TEST_DATABASE_URL)('MAN43/NOT29 exact unlock retention SQL boundary', () => {
  vi.setConfig({ hookTimeout: 60_000, testTimeout: 30_000 });
  let pool: pg.Pool, expert: string;
  let oldRows: unknown, oldAssignment: string;
  const role = `unlock_retention_${randomUUID().replaceAll('-', '')}`;
  const insert = async (db: Connection, table: string, values: Values) => {
    const columns = Object.keys(values);
    return (
      await db.query<Values>(
        `insert into "${table}" (${columns.map((k) => `"${k}"`).join(',')}) values (${columns.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
        Object.values(values),
      )
    ).rows[0]!;
  };
  const transaction = async <T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await run(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  };
  const graph = async (prepare?: (g: ProfileGraph) => Promise<void>) => {
    const g = await seedProfileGraph(pool);
    if (prepare) await prepare(g);
    const actor = String(
      (
        await insert(pool, 'user_accounts', {
          organization_id: g.org,
          email: `${randomUUID()}@retention.local`,
          role: 'manufacturer',
          state: 'active',
        })
      ).id,
    );
    await transaction(async (client) => {
      await client.query('update profile_section set working_revision_id=null where profile_id=$1', [g.profile]);
      await client.query("update section_revision set state='submitted',submitted_at=$1 where organization_id=$2", [
        received,
        g.org,
      ]);
    });
    return { ...g, actor };
  };
  type Graph = Awaited<ReturnType<typeof graph>>;
  const sections = async (g: ProfileGraph) =>
    (
      await pool.query<{ id: string; kind: SectionKind }>(
        'select id,kind from profile_section where profile_id=$1 order by kind',
        [g.profile],
      )
    ).rows;
  const assignment = async (db: Connection, g: Graph, at = received) =>
    String(
      (
        await insert(db, 'review_assignment', {
          profile_id: g.profile,
          organization_id: g.org,
          submitted_by: g.actor,
          received_at: at,
          accuracy_confirmed_at: at,
          submission_mode: at === received ? 'initial' : 'resubmit',
          operation_key: randomUUID(),
          request_fingerprint: 'a'.repeat(64),
          expert_id: expert,
          assigned_by: expert,
          assigned_at: at,
        })
      ).id,
    );
  const map = async (db: Connection, g: Graph, id: string, changes: Partial<Record<SectionKind, Values>> = {}) => {
    for (const section of await sections(g))
      await insert(db, 'review_assignment_section', {
        review_assignment_id: id,
        profile_id: g.profile,
        organization_id: g.org,
        profile_section_id: section.id,
        section_revision_id: g.revisions[section.kind],
        review_required: true,
        retained_decision_id: null,
        ...changes[section.kind],
      });
  };
  const send = async (g: Graph, changes: Partial<Record<SectionKind, Values>> = {}, at = received) =>
    transaction(async (client) => {
      const id = await assignment(client, g, at);
      await map(client, g, id, changes);
      return id;
    });
  const decision = async (
    g: Graph,
    id: string,
    kind: SectionKind,
    subject: Values = {},
    outcome = 'rejected',
    at = decided,
  ) =>
    String(
      (
        await insert(pool, 'review_decision', {
          review_assignment_id: id,
          organization_id: g.org,
          expert_id: expert,
          profile_section_id: (await sections(g)).find((s) => s.kind === kind)!.id,
          subject_revision_id: g.revisions[kind],
          ...(Object.keys(subject).length ? subject : { section_revision_id: g.revisions[kind] }),
          outcome,
          comment: outcome === 'rejected' ? 'Original immutable rejection' : null,
          decided_at: at,
        })
      ).id,
    );
  const close = async (g: Graph, id: string, reason = 'manufacturer_unlock', at = closed) =>
    pool.query(
      'update review_assignment set closed_at=$1,close_reason=$2,closed_by=$3,close_operation_key=$4 where id=$5',
      [
        at,
        reason,
        reason === 'manufacturer_unlock' ? g.actor : expert,
        reason === 'manufacturer_unlock' ? randomUUID() : null,
        id,
      ],
    );
  const candidate = async (g: Graph, id: string, kind: SectionKind) =>
    pool.query(
      `insert into profile_section_candidate(profile_section_id,organization_id,review_assignment_id,section_revision_id) values($1,$2,$3,$4)
     on conflict(profile_section_id) do update set review_assignment_id=excluded.review_assignment_id,section_revision_id=excluded.section_revision_id,accepted_decision_id=null`,
      [(await sections(g)).find((s) => s.kind === kind)!.id, g.org, id, g.revisions[kind]],
    );
  const source = async (kind: SectionKind = 'contacts') => {
    const g = await graph(),
      id = await send(g),
      kept = await decision(g, id, kind);
    await candidate(g, id, kind);
    await close(g, id);
    return { g, id, kept };
  };
  const retained = (id: string, kept: string | null, reviewRequired = false) => ({
    retained_from_assignment_id: id,
    retained_decision_id: kept,
    review_required: reviewRequired,
  });
  const snapshot = async (id: string) => ({
    assignment: (await pool.query('select to_jsonb(a) as row from review_assignment a where id=$1', [id])).rows,
    map: (
      await pool.query(
        "select to_jsonb(m)-'retained_from_assignment_id' as row from review_assignment_section m where review_assignment_id=$1 order by profile_section_id",
        [id],
      )
    ).rows,
    decisions: (
      await pool.query(
        'select to_jsonb(d) as row from review_decision d where review_assignment_id=$1 order by decision_order',
        [id],
      )
    ).rows,
  });
  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool, '0027_canonical_due_diligence');
    const imbc = (await pool.query<{ id: string }>("select id from organizations where type='imbc'")).rows[0]!;
    expert = String(
      (
        await insert(pool, 'user_accounts', {
          organization_id: imbc.id,
          email: `${randomUUID()}@retention.local`,
          role: 'expert',
          state: 'active',
        })
      ).id,
    );
    const g = await graph();
    oldAssignment = await send(g);
    await decision(g, oldAssignment, 'contacts');
    await close(g, oldAssignment);
    oldRows = await snapshot(oldAssignment);
    await applyMigrations(pool, fileURLToPath(new URL('../drizzle', import.meta.url)));
    await pool.query(`create role "${role}" nologin`);
    await applyAppRoleGrants(pool, role);
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`drop owned by "${role}"; drop role "${role}"`);
      await pool.end();
    }
  });

  it('preserves nonempty closed canonical history and all old map columns on expand and replay', async () => {
    expect(await snapshot(oldAssignment)).toEqual(oldRows);
    expect(
      (
        await pool.query(
          'select retained_from_assignment_id from review_assignment_section where review_assignment_id=$1',
          [oldAssignment],
        )
      ).rows.every((row) => row.retained_from_assignment_id === null),
    ).toBe(true);
    await applyMigrations(pool, fileURLToPath(new URL('../drizzle', import.meta.url)));
    expect(await snapshot(oldAssignment)).toEqual(oldRows);
  });
  it('allows an exact unchanged rejected decision without another mandatory review', async () => {
    const { g, id, kept } = await source();
    const next = await send(g, { contacts: retained(id, kept) }, secondReceived);
    expect(
      (
        await pool.query(
          'select review_required,retained_decision_id,retained_from_assignment_id from review_assignment_section m join profile_section s on s.id=m.profile_section_id where m.review_assignment_id=$1 and s.kind=$2',
          [next, 'contacts'],
        )
      ).rows[0],
    ).toEqual({ review_required: false, retained_decision_id: kept, retained_from_assignment_id: id });
    await expect(decision(g, next, 'contacts', {}, 'verified', '2026-11-16T00:04:00Z')).rejects.toMatchObject({
      code: '23514',
    });
  });
  it('requires completion of missing mandatory items while preserving a nonnull section decision', async () => {
    const g = await graph(),
      id = await send(g),
      kept = await decision(g, id, 'documents', {}, 'verified');
    await candidate(g, id, 'documents');
    await close(g, id);
    await expect(send(g, { documents: retained(id, kept, false) }, secondReceived)).rejects.toMatchObject({
      code: '23514',
    });
    const next = await send(g, { documents: retained(id, kept, true) }, secondReceived);
    expect(
      (
        await pool.query(
          "select review_required,retained_decision_id from review_assignment_section m join profile_section s on s.id=m.profile_section_id where m.review_assignment_id=$1 and s.kind='documents'",
          [next],
        )
      ).rows[0],
    ).toEqual({ review_required: true, retained_decision_id: kept });
  });
  it('refuses retention without a proven Unlock source, from another profile, or from an obsolete source', async () => {
    const { g, id, kept } = await source(),
      other = await source();
    await expect(
      send(g, { contacts: { review_required: false, retained_decision_id: kept } }, secondReceived),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(send(g, { contacts: retained(other.id, other.kept) }, secondReceived)).rejects.toMatchObject({
      code: '23514',
    });
    const next = await send(g, {}, secondReceived);
    await close(g, next, 'manufacturer_unlock', '2026-11-16T00:05:00Z');
    await expect(send(g, { contacts: retained(id, kept) }, '2026-11-16T00:06:00Z')).rejects.toMatchObject({
      code: '23514',
    });
    // A separate valid review_result source is not the broader MAN43 Unlock path.
    const h = await graph(),
      reviewResult = await send(h),
      rejected = await decision(h, reviewResult, 'contacts');
    await candidate(h, reviewResult, 'contacts');
    await close(h, reviewResult, 'review_result');
    await expect(send(h, { contacts: retained(reviewResult, rejected) }, secondReceived)).rejects.toMatchObject({
      code: '23514',
    });
  });
  it('refuses unchanged-source claims after a real new working revision exists', async () => {
    const { g, id, kept } = await source();
    const section = (await sections(g)).find((s) => s.kind === 'contacts')!;
    const working = await insert(pool, 'section_revision', {
      profile_section_id: section.id,
      organization_id: g.org,
      revision_number: 2,
      author_id: g.actor,
    });
    await pool.query('update profile_section set working_revision_id=$1 where id=$2', [working.id, section.id]);
    await expect(send(g, { contacts: retained(id, kept) }, secondReceived)).rejects.toMatchObject({ code: '23514' });
  });
  it('refuses unsafe captured files on Send but historical provenance survives later scanner changes', async () => {
    const g = await graph(),
      id = await send(g),
      kept = await decision(g, id, 'documents');
    await decision(g, id, 'documents', { document_id: g.rows.document!.id });
    await candidate(g, id, 'documents');
    await close(g, id);
    const pin = g.rows.revision_file_version!,
      version = pin.file_version_id;
    await pool.query("update file_version set scan_state='rejected' where id=$1", [version]);
    await expect(send(g, { documents: retained(id, kept) }, secondReceived)).rejects.toMatchObject({ code: '23514' });
    await pool.query("update file_version set scan_state='passed' where id=$1", [version]);
    const next = await send(g, { documents: retained(id, kept) }, secondReceived);
    const section = (await sections(g)).find((s) => s.kind === 'documents')!;
    await pool.query("update file_version set scan_state='rejected' where id=$1", [version]);
    expect(
      (
        await pool.query('select profile_review_unlock_retained_provenance($1,$2,$3,$4,$5,$6,$7) as valid', [
          next,
          id,
          g.revisions.documents,
          section.id,
          g.profile,
          g.org,
          kept,
        ])
      ).rows[0]!.valid,
    ).toBe(true);
  });
  it('keeps a shared file version decision across captured sections without reading a later assignment', async () => {
    const g = await graph(async (g) => {
      const pin = g.rows.revision_file_version!;
      await insert(pool, 'revision_file_version', {
        section_revision_id: g.revisions.production,
        organization_id: g.org,
        file_object_id: pin.file_object_id,
        file_version_id: pin.file_version_id,
      });
    });
    const pin = g.rows.revision_file_version!,
      id = await send(g);
    await decision(
      g,
      id,
      'documents',
      { file_object_id: pin.file_object_id, file_version_id: pin.file_version_id },
      'verified',
    );
    const expected = await decision(g, id, 'production', {
      file_object_id: pin.file_object_id,
      file_version_id: pin.file_version_id,
    });
    await close(g, id);
    const next = await send(g, {}, secondReceived);
    const later = await decision(
      g,
      next,
      'production',
      { file_object_id: pin.file_object_id, file_version_id: pin.file_version_id },
      'verified',
      '2026-11-16T00:04:00Z',
    );
    expect(
      (
        await pool.query('select profile_review_unlock_effective_decision($1,$2,$3,$4,null,null,$5) as id', [
          id,
          g.revisions.documents,
          g.profile,
          g.org,
          pin.file_version_id,
        ])
      ).rows[0]!.id,
    ).toBe(expected);
    expect(
      (
        await pool.query('select profile_review_effective_decision($1,$2,null,null,null,$3) as id', [
          g.profile,
          g.org,
          pin.file_version_id,
        ])
      ).rows[0]!.id,
    ).toBe(later);
    expect(
      (
        await pool.query('select profile_review_unlock_effective_decision($1,$2,$3,$4,null,null,$5) as id', [
          id,
          g.revisions.contacts,
          g.profile,
          g.org,
          pin.file_version_id,
        ])
      ).rows[0]!.id,
    ).toBeNull();
  });
  it('keeps maps append-only and application TRUNCATE forbidden after adding retention provenance', async () => {
    const { g, id, kept } = await source();
    const next = await send(g, { contacts: retained(id, kept) }, secondReceived);
    await expect(
      pool.query(
        'update review_assignment_section set retained_from_assignment_id=null where review_assignment_id=$1',
        [next],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      transaction(async (client) => {
        await client.query(`set local role "${role}"`);
        await client.query('truncate review_assignment_section cascade');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
