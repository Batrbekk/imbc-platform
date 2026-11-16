import { randomUUID } from 'node:crypto';
import { SECTION_KINDS, type SectionKind } from '@imbc/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import * as schema from '../src/database/schema/index.js';
import {
  effectiveProfileReviewDecisionId,
  profileCandidateRevisions,
  profileSubmissionRevisions,
} from '../src/modules/profiles/profile-candidate.js';
import { copyRevisionContent } from '../src/modules/profiles/revision-copy.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedProfileGraph, type ProfileGraph } from './support/profile-graph.js';

type Connection = pg.Pool | pg.PoolClient;
type Values = Record<string, unknown>;
const received = '2026-11-16T00:00:00.000Z';
const decided = '2026-11-16T00:01:00.000Z';
const closed = '2026-11-16T00:02:00.000Z';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'canonical review expand, immutable exact graph and candidate resolver',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool;
    let expert: string;
    let anotherExpert: string;
    let administrator: string;
    let legacyBefore: unknown[];
    let oldGrantsSucceeded = false;
    const insert = async (db: Connection, table: string, values: Values): Promise<Values> => {
      const columns = Object.keys(values);
      return (
        await db.query<Values>(
          `INSERT INTO "${table}" (${columns.map((name) => `"${name}"`).join(',')})
      VALUES (${columns.map((_, position) => `$${position + 1}`).join(',')}) RETURNING *`,
          Object.values(values),
        )
      ).rows[0]!;
    };
    const inTransaction = async <T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
    const manufacturer = async (graph: ProfileGraph) =>
      String(
        (
          await insert(pool, 'user_accounts', {
            organization_id: graph.org,
            role: 'manufacturer',
            state: 'active',
            email: `${randomUUID()}@review.local`,
          })
        ).id,
      );
    const graph = async (verified = false, prepare?: (g: ProfileGraph) => Promise<void>) => {
      const g = await seedProfileGraph(pool);
      const actor = await manufacturer(g);
      if (prepare) await prepare(g);
      await inTransaction(async (client) => {
        await client.query('UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1', [g.profile]);
        await client.query("UPDATE section_revision SET state='submitted',submitted_at=$1 WHERE organization_id=$2", [
          received,
          g.org,
        ]);
        if (verified) {
          await client.query("UPDATE section_revision SET state='verified' WHERE organization_id=$1", [g.org]);
          await client.query(
            'UPDATE profile_section s SET verified_revision_id=r.id FROM section_revision r WHERE r.profile_section_id=s.id AND s.profile_id=$1',
            [g.profile],
          );
        }
      });
      return { ...g, actor };
    };
    type Graph = Awaited<ReturnType<typeof graph>>;
    const sections = async (g: Graph) =>
      (
        await pool.query<{ id: string; kind: SectionKind }>(
          'SELECT id,kind FROM profile_section WHERE profile_id=$1 ORDER BY kind',
          [g.profile],
        )
      ).rows;
    const newAssignment = async (db: Connection, g: Graph, overrides: Values = {}) =>
      insert(db, 'review_assignment', {
        profile_id: g.profile,
        organization_id: g.org,
        submitted_by: g.actor,
        received_at: received,
        accuracy_confirmed_at: received,
        submission_mode: 'initial',
        operation_key: randomUUID(),
        request_fingerprint: 'a'.repeat(64),
        expert_id: expert,
        assigned_by: expert,
        assigned_at: received,
        ...overrides,
      });
    const map = async (
      db: Connection,
      g: Graph,
      assignment: string,
      retention: Partial<Record<SectionKind, string>> = {},
    ) => {
      for (const s of await sections(g))
        await insert(db, 'review_assignment_section', {
          review_assignment_id: assignment,
          profile_id: g.profile,
          organization_id: g.org,
          profile_section_id: s.id,
          section_revision_id: g.revisions[s.kind],
          review_required: !retention[s.kind],
          retained_decision_id: retention[s.kind] ?? null,
        });
    };
    const send = async (g: Graph, retention: Partial<Record<SectionKind, string>> = {}, overrides: Values = {}) =>
      inTransaction(async (client) => {
        const a = await newAssignment(client, g, overrides);
        await map(client, g, String(a.id), retention);
        return String(a.id);
      });
    const decide = async (
      db: Connection,
      g: Graph,
      assignment: string,
      kind: SectionKind,
      subject: Values = {},
      overrides: Values = {},
    ) => {
      const s = (await sections(g)).find((item) => item.kind === kind)!;
      return insert(db, 'review_decision', {
        review_assignment_id: assignment,
        organization_id: g.org,
        expert_id: expert,
        profile_section_id: s.id,
        subject_revision_id: g.revisions[kind],
        ...(Object.keys(subject).length ? subject : { section_revision_id: g.revisions[kind] }),
        outcome: 'verified',
        decided_at: decided,
        ...overrides,
      });
    };
    const unlock = async (g: Graph, assignment: string) =>
      pool.query(
        `UPDATE review_assignment SET closed_at=$1,
    close_reason='manufacturer_unlock',closed_by=$2,close_operation_key=$3 WHERE id=$4`,
        [closed, g.actor, randomUUID(), assignment],
      );
    const cursor = async (g: Graph, assignment: string, kind: SectionKind, acceptance: string | null = null) => {
      const section = (await sections(g)).find((s) => s.kind === kind)!;
      return insert(pool, 'profile_section_candidate', {
        profile_section_id: section.id,
        organization_id: g.org,
        review_assignment_id: assignment,
        section_revision_id: g.revisions[kind],
        accepted_decision_id: acceptance,
      });
    };
    const cow = async (g: Graph, kind: SectionKind) =>
      inTransaction(async (client) => {
        const section = (await sections(g)).find((s) => s.kind === kind)!;
        const { rows } = await client.query<{ number: number }>(
          'SELECT max(revision_number) AS number FROM section_revision WHERE profile_section_id=$1',
          [section.id],
        );
        const revision = await insert(client, 'section_revision', {
          profile_section_id: section.id,
          organization_id: g.org,
          revision_number: rows[0]!.number + 1,
          author_id: g.actor,
        });
        await copyRevisionContent(drizzle(client, { schema }), kind, g.revisions[kind]!, String(revision.id), g.org);
        await client.query('UPDATE profile_section SET working_revision_id=$1 WHERE id=$2', [revision.id, section.id]);
        return String(revision.id);
      });

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool, '0019_profile_units');
      const imbc = (await pool.query<{ id: string }>("SELECT id FROM organizations WHERE type='imbc'")).rows[0]!;
      expert = String(
        (
          await insert(pool, 'user_accounts', {
            organization_id: imbc.id,
            email: `${randomUUID()}@review.local`,
            role: 'expert',
            state: 'active',
          })
        ).id,
      );
      anotherExpert = String(
        (
          await insert(pool, 'user_accounts', {
            organization_id: imbc.id,
            email: `${randomUUID()}@review.local`,
            role: 'expert',
            state: 'active',
          })
        ).id,
      );
      administrator = String(
        (
          await insert(pool, 'user_accounts', {
            organization_id: imbc.id,
            email: `${randomUUID()}@review.local`,
            role: 'administrator',
            state: 'active',
          })
        ).id,
      );
      const org = await insert(pool, 'organizations', { type: 'manufacturer', name: `R1 ${randomUUID()}` });
      const p = await insert(pool, 'manufacturer_profiles', { organization_id: org.id });
      const s = await insert(pool, 'profile_sections', { profile_id: p.id, kind: 'contacts' });
      const r = await insert(pool, 'section_revisions', { section_id: s.id, number: 1 });
      const a = await insert(pool, 'review_assignments', { profile_id: p.id, expert_id: expert });
      await insert(pool, 'review_decisions', {
        assignment_id: a.id,
        section_revision_id: r.id,
        expert_id: expert,
        decision: 'verified',
      });
      legacyBefore = (await pool.query('SELECT row_to_json(d) AS row FROM review_decisions d')).rows;
      const role = `review_old_${randomUUID().replaceAll('-', '')}`;
      await pool.query(`CREATE ROLE "${role}"`);
      try {
        await applyAppRoleGrants(pool, role);
        oldGrantsSucceeded = true;
      } finally {
        await pool.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
      }
      await migrateThrough(pool);
    });
    afterAll(async () => {
      await pool?.end();
    });

    it('preserves nonempty plural review history and the R1 compatibility view on expand', async () => {
      expect((await pool.query('SELECT row_to_json(d) AS row FROM review_decisions d')).rows).toEqual(legacyBefore);
      expect(
        (await pool.query("SELECT relkind FROM pg_class WHERE oid='manufacturer_profiles'::regclass")).rows[0]!.relkind,
      ).toBe('v');
      expect((await pool.query('SELECT count(*)::int AS count FROM review_assignment')).rows[0]!.count).toBe(0);
      expect(oldGrantsSucceeded).toBe(true);
    });
    it('commits one exact frozen revision per each of the seven sections', async () => {
      const g = await graph();
      const a = await send(g);
      const rows = (
        await pool.query(
          'SELECT s.kind,m.section_revision_id FROM review_assignment_section m JOIN profile_section s ON s.id=m.profile_section_id WHERE m.review_assignment_id=$1',
          [a],
        )
      ).rows;
      expect(rows).toHaveLength(7);
      expect(Object.fromEntries(rows.map((row) => [row.kind, row.section_revision_id]))).toEqual(g.revisions);
    });
    it('resolves exact immutable assignment map with profile/tenant scope after later working edits', async () => {
      const g = await graph(true);
      const a = await send(g);
      const oldMain = g.revisions.main_information;
      await unlock(g, a);
      const edited = await cow(g, 'main_information');
      const db = drizzle(pool, { schema });
      expect(
        (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org })).find(
          (s) => s.kind === 'main_information',
        )!.revisionId,
      ).toBe(edited);
      expect(
        (await profileSubmissionRevisions(db, { assignmentId: a, profileId: g.profile, organizationId: g.org })).find(
          (s) => s.kind === 'main_information',
        )!.revisionId,
      ).toBe(oldMain);
      expect(
        await profileSubmissionRevisions(db, { assignmentId: a, profileId: g.profile, organizationId: randomUUID() }),
      ).toEqual([]);
      expect(
        await profileSubmissionRevisions(db, { assignmentId: a, profileId: randomUUID(), organizationId: g.org }),
      ).toEqual([]);
    });
    it('rejects an incomplete six-section map at COMMIT and leaves no partial assignment', async () => {
      const g = await graph();
      const key = randomUUID();
      await expect(
        inTransaction(async (client) => {
          const a = await newAssignment(client, g, { operation_key: key });
          for (const s of (await sections(g)).slice(0, 6))
            await insert(client, 'review_assignment_section', {
              review_assignment_id: a.id,
              profile_id: g.profile,
              organization_id: g.org,
              profile_section_id: s.id,
              section_revision_id: g.revisions[s.kind],
              review_required: true,
            });
        }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'review_assignment_full_map' });
      expect((await pool.query('SELECT id FROM review_assignment WHERE operation_key=$1', [key])).rows).toEqual([]);
    });
    it('rejects a full map containing a working or unfrozen revision', async () => {
      const g = await graph();
      g.revisions.contacts = await cow(g, 'contacts');
      await expect(send(g)).rejects.toMatchObject({ code: '23514', constraint: 'review_assignment_full_map' });
    });
    it('rejects foreign sections and wrong-section revisions even with legitimate UUIDs', async () => {
      const g = await graph();
      const other = await graph();
      await expect(
        inTransaction(async (client) => {
          const a = await newAssignment(client, g);
          await insert(client, 'review_assignment_section', {
            review_assignment_id: a.id,
            profile_id: g.profile,
            organization_id: g.org,
            profile_section_id: (await sections(other))[0]!.id,
            section_revision_id: other.revisions.contacts,
            review_required: true,
          });
        }),
      ).rejects.toMatchObject({ code: '23514' });
      const wrong = { ...g, revisions: { ...g.revisions, contacts: g.revisions.documents! } };
      await expect(send(wrong)).rejects.toMatchObject({ code: '23503' });
    });
    it('rejects another tenant submit actor and a manufacturer assigned as expert', async () => {
      const g = await graph();
      const other = await graph();
      await expect(send(g, {}, { submitted_by: other.actor })).rejects.toMatchObject({ code: '23514' });
      await expect(send(g, {}, { expert_id: g.actor })).rejects.toMatchObject({ code: '23514' });
    });
    it('denies forged assignment authors and accepts only active IMBC administrator or the assigned expert', async () => {
      const g = await graph();
      const observerOrg = await insert(pool, 'organizations', { type: 'observer', name: `Observer ${randomUUID()}` });
      const observer = await insert(pool, 'user_accounts', {
        organization_id: observerOrg.id,
        role: 'observer',
        state: 'active',
        email: `${randomUUID()}@review.local`,
      });
      for (const author of [g.actor, String(observer.id), anotherExpert])
        await expect(send(g, {}, { assigned_by: author })).rejects.toMatchObject({ code: '23514' });
      const a = await send(g, {}, { assigned_by: administrator });
      for (const author of [g.actor, String(observer.id), anotherExpert])
        await expect(
          pool.query('UPDATE review_assignment SET assigned_by=$1 WHERE id=$2', [author, a]),
        ).rejects.toMatchObject({ code: '23514' });
      await pool.query('UPDATE review_assignment SET assigned_by=$1 WHERE id=$2', [expert, a]);
      expect(
        (await pool.query('SELECT assigned_by FROM review_assignment WHERE id=$1', [a])).rows[0]!.assigned_by,
      ).toBe(expert);
    });
    it('preserves historical inactive assignment author only through a proven automatic repeat', async () => {
      const g = await graph();
      const a = await send(g, {}, { assigned_by: administrator });
      await unlock(g, a);
      await pool.query("UPDATE user_accounts SET state='inactive' WHERE id=$1", [administrator]);
      try {
        await expect(send(g, {}, { assigned_by: administrator })).rejects.toMatchObject({ code: '23514' });
        const repeated = await send(
          g,
          {},
          { assigned_by: administrator, reused_from_assignment_id: a, submission_mode: 'resubmit' },
        );
        expect(
          (
            await pool.query(
              'SELECT reused_from_assignment_id,assigned_by,expert_id FROM review_assignment WHERE id=$1',
              [repeated],
            )
          ).rows[0],
        ).toEqual({ reused_from_assignment_id: a, assigned_by: administrator, expert_id: expert });
        await expect(
          pool.query('UPDATE review_assignment SET assigned_at=$1 WHERE id=$2', [decided, repeated]),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await pool.query("UPDATE user_accounts SET state='active' WHERE id=$1", [administrator]);
      }
    });
    it('requires closed immediate previous same-profile reuse and the same active SME regardless of caller dates', async () => {
      const g = await graph();
      const first = await send(g);
      await unlock(g, first);
      const second = await send(
        g,
        {},
        {
          expert_id: anotherExpert,
          assigned_by: anotherExpert,
          received_at: '2026-11-15T00:00:00.000Z',
          accuracy_confirmed_at: '2026-11-15T00:00:00.000Z',
          submission_mode: 'resubmit',
        },
      );
      await unlock(g, second);
      await expect(
        send(g, {}, { reused_from_assignment_id: first, submission_mode: 'resubmit' }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        send(
          g,
          {},
          {
            reused_from_assignment_id: second,
            submission_mode: 'resubmit',
            expert_id: expert,
            assigned_by: anotherExpert,
          },
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        send(g, {}, { reused_from_assignment_id: second, expert_id: anotherExpert, assigned_by: anotherExpert }),
      ).rejects.toMatchObject({ code: '23514' });
      const other = await graph();
      const foreign = await send(other);
      await unlock(other, foreign);
      await expect(
        send(g, {}, { reused_from_assignment_id: foreign, submission_mode: 'resubmit' }),
      ).rejects.toMatchObject({ code: '23514' });
      await pool.query("UPDATE user_accounts SET state='blocked' WHERE id=$1", [anotherExpert]);
      try {
        await expect(
          send(
            g,
            {},
            {
              reused_from_assignment_id: second,
              submission_mode: 'resubmit',
              expert_id: anotherExpert,
              assigned_by: anotherExpert,
            },
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await pool.query("UPDATE user_accounts SET state='active' WHERE id=$1", [anotherExpert]);
      }
      const third = await send(
        g,
        {},
        {
          reused_from_assignment_id: second,
          submission_mode: 'resubmit',
          expert_id: anotherExpert,
          assigned_by: anotherExpert,
          assignment_order: '9223372036854775806',
        },
      );
      const order = (
        await pool.query(
          'SELECT assignment_order FROM review_assignment WHERE id=ANY($1::uuid[]) ORDER BY assignment_order',
          [[first, second, third]],
        )
      ).rows;
      expect(order).toHaveLength(3);
      expect(BigInt(order[2]!.assignment_order)).toBeLessThan(9_223_372_036_854_775_806n);
      await expect(
        pool.query('UPDATE review_assignment SET assignment_order=assignment_order+1 WHERE id=$1', [third]),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('denies reuse from an open source before the unique active-assignment constraint', async () => {
      const g = await graph();
      const a = await send(g);
      await expect(send(g, {}, { reused_from_assignment_id: a, submission_mode: 'resubmit' })).rejects.toMatchObject({
        code: '23514',
      });
    });
    it('rejects malformed provenance and incomplete closure fields without SQL NULL loopholes', async () => {
      const g = await graph();
      await expect(send(g, {}, { request_fingerprint: 'invalid' })).rejects.toMatchObject({ code: '23514' });
      const a = await send(g);
      await expect(
        pool.query('UPDATE review_assignment SET closed_at=$1,closed_by=$2 WHERE id=$3', [closed, g.actor, a]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pool.query(
          "UPDATE review_assignment SET closed_at=$1,closed_by=$2,close_reason='manufacturer_unlock' WHERE id=$3",
          [closed, g.actor, a],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('permits one active assignment and rejects operation-key reuse after closure', async () => {
      const g = await graph();
      const key = randomUUID();
      const a = await send(g, {}, { operation_key: key });
      await expect(send(g)).rejects.toMatchObject({ code: '23505' });
      await unlock(g, a);
      await expect(send(g, {}, { operation_key: key })).rejects.toMatchObject({ code: '23505' });
      expect(await send(g, {}, { submission_mode: 'resubmit' })).toEqual(expect.any(String));
    });
    it('makes assignment provenance immutable and closed assignment history unchangeable', async () => {
      const g = await graph();
      const a = await send(g);
      await expect(
        pool.query('UPDATE review_assignment SET request_fingerprint=$1 WHERE id=$2', ['b'.repeat(64), a]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(pool.query('DELETE FROM review_assignment WHERE id=$1', [a])).rejects.toMatchObject({
        code: '23514',
      });
      await expect(
        pool.query(
          "UPDATE review_assignment SET closed_at=$1,closed_by=$2,close_reason='manufacturer_unlock',close_operation_key=$3 WHERE id=$4",
          [closed, expert, randomUUID(), a],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await unlock(g, a);
      await expect(
        pool.query('UPDATE review_assignment SET closed_at=closed_at WHERE id=$1', [a]),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('makes the full section map append-only even for no-op writes', async () => {
      const g = await graph();
      const a = await send(g);
      await expect(
        pool.query(
          'UPDATE review_assignment_section SET review_required=review_required WHERE review_assignment_id=$1',
          [a],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pool.query('DELETE FROM review_assignment_section WHERE review_assignment_id=$1', [a]),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('records exactly scoped section, held certificate, document and captured file decisions', async () => {
      const g = await graph();
      const a = await send(g);
      await decide(pool, g, a, 'contacts');
      await decide(pool, g, a, 'certificates', { certificate_id: g.rows.certificate!.id });
      await decide(pool, g, a, 'documents', { document_id: g.rows.document!.id });
      await decide(pool, g, a, 'documents', {
        file_version_id: g.rows.revision_file_version!.file_version_id,
        file_object_id: g.rows.document!.file_object_id,
      });
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM review_decision WHERE review_assignment_id=$1', [a]))
          .rows[0]!.count,
      ).toBe(4);
    });
    it('reviews an ISO absence declaration with the section and never certifies the absent certificate', async () => {
      const g = await graph(false, async (base) => {
        await pool.query('UPDATE certificate SET not_held=true,file_object_id=NULL WHERE id=$1', [
          base.rows.certificate!.id,
        ]);
      });
      const a = await send(g);
      await expect(
        decide(pool, g, a, 'certificates', { certificate_id: g.rows.certificate!.id }),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await decide(pool, g, a, 'certificates')).toMatchObject({ outcome: 'verified', certificate_id: null });
    });
    it('rejects empty/multiple subjects, non-review outcome and blank rejection comment', async () => {
      const g = await graph();
      const a = await send(g);
      await expect(decide(pool, g, a, 'contacts', { section_revision_id: null })).rejects.toMatchObject({
        code: '23514',
      });
      await expect(
        decide(pool, g, a, 'documents', {
          section_revision_id: g.revisions.documents,
          document_id: g.rows.document!.id,
        }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(decide(pool, g, a, 'contacts', {}, { outcome: 'uploaded' })).rejects.toMatchObject({
        code: '23514',
      });
      await expect(decide(pool, g, a, 'contacts', {}, { outcome: 'rejected', comment: '  ' })).rejects.toMatchObject({
        code: '23514',
      });
    });
    it('rejects a foreign row and a legitimate document/certificate outside the mapped revision', async () => {
      const g = await graph();
      const other = await graph();
      const a = await send(g);
      await expect(
        decide(pool, g, a, 'certificates', { certificate_id: other.rows.certificate!.id }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(decide(pool, g, a, 'contacts', { document_id: g.rows.document!.id })).rejects.toMatchObject({
        code: '23514',
      });
      await expect(
        decide(pool, g, a, 'contacts', { section_revision_id: g.revisions.documents }),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('rejects a later passed file version and an exact captured version in a different section', async () => {
      const g = await graph();
      const a = await send(g);
      const object = g.rows.document!.file_object_id;
      const later = await insert(pool, 'file_version', {
        file_object_id: object,
        version_number: 2,
        original_name: 'replacement.pdf',
        byte_size: 1,
        declared_media_type: 'application/pdf',
        checksum: 'later',
        storage_key: randomUUID(),
        scan_state: 'passed',
      });
      await expect(
        decide(pool, g, a, 'documents', { file_version_id: later.id, file_object_id: object }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        decide(pool, g, a, 'contacts', {
          file_version_id: g.rows.revision_file_version!.file_version_id,
          file_object_id: object,
        }),
      ).rejects.toMatchObject({ code: '23514' });
      await decide(pool, g, a, 'documents', {
        file_version_id: g.rows.revision_file_version!.file_version_id,
        file_object_id: object,
      });
    });
    it('uses the current persisted assigned expert and denies decisions after closure', async () => {
      const g = await graph();
      const a = await send(g);
      await expect(decide(pool, g, a, 'contacts', {}, { expert_id: anotherExpert })).rejects.toMatchObject({
        code: '23514',
      });
      await pool.query('UPDATE review_assignment SET expert_id=$1,assigned_by=$1 WHERE id=$2', [anotherExpert, a]);
      await expect(decide(pool, g, a, 'contacts')).rejects.toMatchObject({ code: '23514' });
      await decide(pool, g, a, 'contacts', {}, { expert_id: anotherExpert });
      await unlock(g, a);
      await expect(decide(pool, g, a, 'contacts', {}, { expert_id: anotherExpert })).rejects.toMatchObject({
        code: '23514',
      });
    });
    it('serializes a real decision insert with a concurrent assignment close', async () => {
      const g = await graph();
      const a = await send(g);
      const closer = await pool.connect();
      const reviewer = await pool.connect();
      try {
        await closer.query('BEGIN');
        await closer.query(
          "UPDATE review_assignment SET closed_at=$1,close_reason='manufacturer_unlock',closed_by=$2,close_operation_key=$3 WHERE id=$4",
          [closed, g.actor, randomUUID(), a],
        );
        await reviewer.query('BEGIN');
        await reviewer.query("SET LOCAL lock_timeout='100ms'");
        await expect(decide(reviewer, g, a, 'contacts')).rejects.toMatchObject({ code: '55P03' });
        await reviewer.query('ROLLBACK');
        await closer.query('COMMIT');
        await expect(decide(pool, g, a, 'contacts')).rejects.toMatchObject({ code: '23514' });
      } finally {
        await closer.query('ROLLBACK');
        await reviewer.query('ROLLBACK');
        closer.release();
        reviewer.release();
      }
    });
    it('keeps decisions append-only and history readable after the author is blocked', async () => {
      const g = await graph();
      const a = await send(g);
      const d = await decide(pool, g, a, 'contacts');
      await expect(
        pool.query('UPDATE review_decision SET comment=$1 WHERE id=$2', ['replaced', d.id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(pool.query('DELETE FROM review_decision WHERE id=$1', [d.id])).rejects.toMatchObject({
        code: '23514',
      });
      await pool.query("UPDATE user_accounts SET state='blocked' WHERE id=$1", [expert]);
      try {
        expect((await pool.query('SELECT outcome FROM review_decision WHERE id=$1', [d.id])).rows[0]!.outcome).toBe(
          'verified',
        );
        await expect(decide(pool, g, a, 'products')).rejects.toMatchObject({ code: '23514' });
      } finally {
        await pool.query("UPDATE user_accounts SET state='active' WHERE id=$1", [expert]);
      }
    });
    it('uses DB order for effective d1→d2 and invalidates an earlier cursor after later rejection', async () => {
      const g = await graph(true);
      const a = await send(g);
      const d1 = await decide(
        pool,
        g,
        a,
        'contacts',
        {},
        { decided_at: '2099-01-01T00:00:00.000Z', decision_order: '9223372036854775806' },
      );
      await cursor(g, a, 'contacts', String(d1.id));
      const db = drizzle(pool, { schema });
      const input = {
        profileId: g.profile,
        organizationId: g.org,
        subject: { kind: 'section' as const, sectionRevisionId: g.revisions.contacts! },
      };
      expect(await effectiveProfileReviewDecisionId(db, input)).toBe(d1.id);
      expect((await profileCandidateRevisions(db, input)).find((s) => s.kind === 'contacts')!.acceptedDecisionId).toBe(
        d1.id,
      );
      const d2 = await decide(
        pool,
        g,
        a,
        'contacts',
        {},
        { outcome: 'rejected', comment: 'Latest rejection', decided_at: '2026-11-16T00:00:01.000Z', decision_order: 0 },
      );
      expect(BigInt(String(d2.decision_order))).toBeGreaterThan(BigInt(String(d1.decision_order)));
      expect(BigInt(String(d1.decision_order))).toBeLessThan(9_223_372_036_854_775_806n);
      expect(await effectiveProfileReviewDecisionId(db, input)).toBe(d2.id);
      expect(await effectiveProfileReviewDecisionId(db, { ...input, profileId: randomUUID() })).toBeNull();
      // The raw cursor preserves a historical hint; every effective read rejects its obsolete approval.
      expect(
        (
          await pool.query('SELECT accepted_decision_id FROM profile_section_candidate WHERE section_revision_id=$1', [
            g.revisions.contacts,
          ])
        ).rows[0]!.accepted_decision_id,
      ).toBe(d1.id);
      expect(
        (await profileCandidateRevisions(db, input)).find((s) => s.kind === 'contacts')!.acceptedDecisionId,
      ).toBeNull();
      await expect(
        pool.query('UPDATE profile_section_candidate SET accepted_decision_id=$1 WHERE section_revision_id=$2', [
          d1.id,
          g.revisions.contacts,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await unlock(g, a);
      await expect(send(g, { contacts: String(d1.id) })).rejects.toMatchObject({ code: '23514' });
    });
    it('serializes cursor validation with pending later decision and requires a sealed source for map retention', async () => {
      const g = await graph(true);
      const a = await send(g);
      const d1 = await decide(pool, g, a, 'contacts');
      await expect(
        pool.query('SELECT profile_review_validate_retained($1,$2,$3,$4,true)', [
          d1.id,
          g.revisions.contacts,
          g.profile,
          g.org,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      const reviewer = await pool.connect();
      const editor = await pool.connect();
      try {
        await reviewer.query('BEGIN');
        await decide(reviewer, g, a, 'contacts', {}, { outcome: 'rejected', comment: 'Concurrent rejection' });
        await editor.query('BEGIN');
        await editor.query("SET LOCAL lock_timeout='100ms'");
        const s = (await sections(g)).find((section) => section.kind === 'contacts')!;
        await expect(
          insert(editor, 'profile_section_candidate', {
            profile_section_id: s.id,
            organization_id: g.org,
            review_assignment_id: a,
            section_revision_id: g.revisions.contacts,
            accepted_decision_id: d1.id,
          }),
        ).rejects.toMatchObject({ code: '55P03' });
        await editor.query('ROLLBACK');
        await reviewer.query('COMMIT');
        await expect(cursor(g, a, 'contacts', String(d1.id))).rejects.toMatchObject({ code: '23514' });
      } finally {
        await editor.query('ROLLBACK');
        await reviewer.query('ROLLBACK');
        editor.release();
        reviewer.release();
      }
      await unlock(g, a);
      await expect(decide(pool, g, a, 'contacts')).rejects.toMatchObject({ code: '23514' });
    });
    it('allocates monotonic decision order only after acquiring the assignment lock', async () => {
      const g = await graph();
      const a = await send(g);
      const first = await pool.connect();
      const second = await pool.connect();
      try {
        await first.query('BEGIN');
        const d1 = await decide(first, g, a, 'contacts');
        await second.query('BEGIN');
        await second.query("SET LOCAL lock_timeout='100ms'");
        await expect(
          decide(second, g, a, 'contacts', {}, { outcome: 'rejected', comment: 'Later' }),
        ).rejects.toMatchObject({ code: '55P03' });
        await second.query('ROLLBACK');
        await first.query('COMMIT');
        const d2 = await decide(pool, g, a, 'contacts', {}, { outcome: 'rejected', comment: 'Later' });
        expect(BigInt(String(d2.decision_order))).toBeGreaterThan(BigInt(String(d1.decision_order)));
      } finally {
        await first.query('ROLLBACK');
        await second.query('ROLLBACK');
        first.release();
        second.release();
      }
    });
    it('observes a later rejection after waiting for the source lock in the same cursor INSERT statement', async () => {
      const g = await graph(true);
      const a = await send(g);
      const d1 = await decide(pool, g, a, 'contacts');
      const reviewer = await pool.connect();
      const editor = await pool.connect();
      try {
        await reviewer.query('BEGIN');
        await decide(reviewer, g, a, 'contacts', {}, { outcome: 'rejected', comment: 'Committed while cursor waits' });
        await editor.query('BEGIN');
        await editor.query("SET LOCAL lock_timeout='2s'");
        const pid = (await editor.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const s = (await sections(g)).find((section) => section.kind === 'contacts')!;
        const pending = insert(editor, 'profile_section_candidate', {
          profile_section_id: s.id,
          organization_id: g.org,
          review_assignment_id: a,
          section_revision_id: g.revisions.contacts,
          accepted_decision_id: d1.id,
        }).then(
          (row) => ({ row, error: null }),
          (error: unknown) => ({ row: null, error }),
        );
        let blocked = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          blocked =
            (
              await pool.query<{ blocked: boolean }>(
                "SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",
                [pid],
              )
            ).rows[0]?.blocked ?? false;
          if (blocked) break;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(blocked).toBe(true);
        await reviewer.query('COMMIT');
        expect((await pending).error).toMatchObject({ code: '23514' });
        await editor.query('ROLLBACK');
        expect(
          (
            await pool.query('SELECT * FROM profile_section_candidate WHERE section_revision_id=$1', [
              g.revisions.contacts,
            ])
          ).rows,
        ).toEqual([]);
      } finally {
        await reviewer.query('ROLLBACK');
        await editor.query('ROLLBACK');
        reviewer.release();
        editor.release();
      }
    });
    it('retains rejected candidate after closed assignment and cleared pending; COW beats the cursor', async () => {
      const g = await graph(true);
      const old = g.revisions.contacts!;
      const next = await cow(g, 'contacts');
      await inTransaction(async (client) => {
        await client.query('UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1', [g.profile]);
        await client.query("UPDATE section_revision SET state='submitted',submitted_at=$1 WHERE id=$2", [
          received,
          next,
        ]);
      });
      g.revisions.contacts = next;
      const a = await send(g);
      await cursor(g, a, 'contacts');
      await decide(pool, g, a, 'contacts', {}, { outcome: 'rejected', comment: 'Please correct' });
      await pool.query("UPDATE section_revision SET state='rejected' WHERE id=$1", [next]);
      await unlock(g, a);
      const candidate = (
        await profileCandidateRevisions(drizzle(pool, { schema }), { profileId: g.profile, organizationId: g.org })
      ).find((s) => s.kind === 'contacts')!;
      expect(candidate).toMatchObject({ revisionId: next, candidateRevisionId: next, candidateAssignmentId: a });
      expect(
        (
          await pool.query(
            "SELECT verified_revision_id,pending_revision_id FROM profile_section WHERE profile_id=$1 AND kind='contacts'",
            [g.profile],
          )
        ).rows[0],
      ).toEqual({ verified_revision_id: old, pending_revision_id: null });
      const edited = await cow(g, 'contacts');
      expect(
        (
          await profileCandidateRevisions(drizzle(pool, { schema }), { profileId: g.profile, organizationId: g.org })
        ).find((s) => s.kind === 'contacts')!.revisionId,
      ).toBe(edited);
      expect(
        await profileCandidateRevisions(drizzle(pool, { schema }), {
          profileId: g.profile,
          organizationId: randomUUID(),
        }),
      ).toEqual([]);
    });
    it('retains accepted unpublished exact candidate and decision in the next cycle with changed related map', async () => {
      const g = await graph(true);
      const a = await send(g);
      const accepted = await decide(pool, g, a, 'contacts');
      await cursor(g, a, 'contacts', String(accepted.id));
      await unlock(g, a);
      const newProducts = await cow(g, 'products');
      await inTransaction(async (client) => {
        await client.query('UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1', [g.profile]);
        await client.query("UPDATE section_revision SET state='submitted',submitted_at=$1 WHERE id=$2", [
          received,
          newProducts,
        ]);
      });
      g.revisions.products = newProducts;
      const nextAssignment = await send(g, { contacts: String(accepted.id) }, { submission_mode: 'verified_changes' });
      expect(
        (
          await pool.query(
            "SELECT review_required,retained_decision_id,section_revision_id FROM review_assignment_section m JOIN profile_section s ON s.id=m.profile_section_id WHERE m.review_assignment_id=$1 AND s.kind='contacts'",
            [nextAssignment],
          )
        ).rows[0],
      ).toEqual({
        review_required: false,
        retained_decision_id: accepted.id,
        section_revision_id: g.revisions.contacts,
      });
      await expect(decide(pool, g, nextAssignment, 'contacts')).rejects.toMatchObject({ code: '23514' });
      expect(
        (await pool.query('SELECT closed_at FROM review_assignment WHERE id=$1', [a])).rows[0]!.closed_at,
      ).not.toBeNull();
    });
    it('exposes acceptance only for the exact selected candidate and drops it from a new working COW', async () => {
      const g = await graph(true);
      const a = await send(g);
      const accepted = await decide(pool, g, a, 'contacts');
      await cursor(g, a, 'contacts', String(accepted.id));
      await unlock(g, a);
      const db = drizzle(pool, { schema });
      expect(
        (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org })).find(
          (s) => s.kind === 'contacts',
        )!.acceptedDecisionId,
      ).toBe(accepted.id);
      const next = await cow(g, 'contacts');
      expect(
        (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org })).find(
          (s) => s.kind === 'contacts',
        ),
      ).toMatchObject({ revisionId: next, candidateRevisionId: g.revisions.contacts, acceptedDecisionId: null });
      expect(
        (
          await pool.query('SELECT accepted_decision_id FROM profile_section_candidate WHERE section_revision_id=$1', [
            g.revisions.contacts,
          ])
        ).rows[0]!.accepted_decision_id,
      ).toBe(accepted.id);
    });
    it('rejects foreign cursor ownership and a decision for another exact subject', async () => {
      const g = await graph(true);
      const other = await graph(true);
      const a = await send(g);
      const accepted = await decide(pool, g, a, 'contacts');
      const section = (await sections(g)).find((s) => s.kind === 'contacts')!;
      await expect(
        insert(pool, 'profile_section_candidate', {
          profile_section_id: section.id,
          organization_id: other.org,
          review_assignment_id: a,
          section_revision_id: g.revisions.contacts,
        }),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(cursor(g, a, 'products', String(accepted.id))).rejects.toMatchObject({ code: '23514' });
    });
    it('never transfers a retained decision to a copied revision or a rejected outcome', async () => {
      const g = await graph(true);
      const a = await send(g);
      const accepted = await decide(pool, g, a, 'contacts');
      const rejected = await decide(pool, g, a, 'products', {}, { outcome: 'rejected', comment: 'Fix' });
      await unlock(g, a);
      await expect(send(g, { products: String(rejected.id) })).rejects.toMatchObject({ code: '23514' });
      g.revisions.contacts = await cow(g, 'contacts');
      await inTransaction(async (client) => {
        await client.query('UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1', [g.profile]);
        await client.query("UPDATE section_revision SET state='submitted',submitted_at=$1 WHERE id=$2", [
          received,
          g.revisions.contacts,
        ]);
      });
      await expect(send(g, { contacts: String(accepted.id) })).rejects.toMatchObject({ code: '23514' });
    });
    it('creates a fresh requirement candidate without rewriting frozen baseline or cloning acceptance', async () => {
      const g = await graph(true);
      const old = g.revisions.certificates!;
      const a = await send(g);
      const accepted = await decide(pool, g, a, 'certificates');
      await unlock(g, a);
      const before = (await pool.query('SELECT * FROM submission_requirement WHERE section_revision_id=$1', [old]))
        .rows;
      const next = await cow(g, 'certificates');
      expect(
        (await pool.query('SELECT * FROM submission_requirement WHERE section_revision_id=$1', [next])).rows,
      ).toEqual([]);
      const type = (await pool.query("SELECT id FROM dictionary WHERE code='certificate_type'")).rows[0]!.id;
      const mandatory = await insert(pool, 'dictionary_entry', {
        dictionary_id: type,
        code: randomUUID(),
        mandatory: true,
      });
      await insert(pool, 'submission_requirement', {
        section_revision_id: next,
        organization_id: g.org,
        dictionary_entry_id: mandatory.id,
        captured_at: received,
      });
      await expect(
        pool.query('UPDATE submission_requirement SET captured_at=now() WHERE section_revision_id=$1', [old]),
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        (await pool.query('SELECT * FROM submission_requirement WHERE section_revision_id=$1', [old])).rows,
      ).toEqual(before);
      await inTransaction(async (client) => {
        await client.query('UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1', [g.profile]);
        await client.query("UPDATE section_revision SET state='submitted',submitted_at=$1 WHERE id=$2", [
          received,
          next,
        ]);
      });
      g.revisions.certificates = next;
      await expect(send(g, { certificates: String(accepted.id) })).rejects.toMatchObject({ code: '23514' });
      const newAssignment = await send(g);
      expect(
        (
          await pool.query(
            "SELECT review_required FROM review_assignment_section m JOIN profile_section s ON s.id=m.profile_section_id WHERE m.review_assignment_id=$1 AND s.kind='certificates'",
            [newAssignment],
          )
        ).rows[0]!.review_required,
      ).toBe(true);
    });
    it('grants append-only map/decisions, mutable cursor and close-only assignment history privileges', async () => {
      const role = `review_app_${randomUUID().replaceAll('-', '')}`;
      await pool.query(`CREATE ROLE "${role}"`);
      try {
        await applyAppRoleGrants(pool, role);
        for (const table of ['review_decision', 'review_assignment_section']) {
          for (const permission of ['UPDATE', 'DELETE', 'TRUNCATE'])
            expect(
              (await pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, table, permission])).rows[0]!
                .allowed,
            ).toBe(false);
          expect(
            (await pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, table, 'INSERT'])).rows[0]!
              .allowed,
          ).toBe(true);
        }
        expect(
          (
            await pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [
              role,
              'profile_section_candidate',
              'UPDATE',
            ])
          ).rows[0]!.allowed,
        ).toBe(true);
        expect(
          (await pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, 'review_assignment', 'DELETE']))
            .rows[0]!.allowed,
        ).toBe(false);
        for (const sequence of ['profile_review_assignment_order_seq', 'profile_review_decision_order_seq']) {
          expect(
            (await pool.query('SELECT has_sequence_privilege($1,$2,$3) AS allowed', [role, sequence, 'USAGE'])).rows[0]!
              .allowed,
          ).toBe(true);
          expect(
            (await pool.query('SELECT has_sequence_privilege($1,$2,$3) AS allowed', [role, sequence, 'UPDATE']))
              .rows[0]!.allowed,
          ).toBe(false);
        }
        const g = await graph();
        await inTransaction(async (client) => {
          await client.query(`SET LOCAL ROLE "${role}"`);
          const a = await newAssignment(client, g);
          await map(client, g, String(a.id));
          expect(BigInt(String(a.assignment_order))).toBeGreaterThan(0n);
          expect(await decide(client, g, String(a.id), 'contacts')).toMatchObject({ outcome: 'verified' });
        });
      } finally {
        await pool.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
      }
    });
  },
);
