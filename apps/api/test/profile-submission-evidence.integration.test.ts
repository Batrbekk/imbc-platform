import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/database.module.js';
import { AuditService } from '../src/common/audit.service.js';
import { lockSubmissionRequirementDictionary } from '../src/database/submission-requirement-lock.js';
import { loadReferenceDirectory, REFERENCE_DATA_DIR } from '../src/database/reference-data.js';
import * as schema from '../src/database/schema/index.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { DictionariesService } from '../src/modules/dictionaries/dictionaries.service.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { validateFrozenSubmissionFiles } from '../src/modules/profiles/submission-file-evidence.js';
import {
  captureSubmissionRequirements,
  currentRequirementIds,
  lockCurrentSubmissionRequirements,
  requirementSnapshotMatches,
} from '../src/modules/profiles/submission-requirements.js';
import type { SectionContext } from '../src/modules/profiles/section-handler.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedProfileGraph } from './support/profile-graph.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'new Send requirement serialization and exact frozen file evidence',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool;
    let db: Database;
    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool, '0019_profile_units');
      await pool.query(
        readFileSync(new URL('../drizzle/0021_submission_requirement_serialization.sql', import.meta.url), 'utf8'),
      );
      db = drizzle(pool, { schema });
      await loadReferenceDirectory(db, join(REFERENCE_DATA_DIR, 'release'), 'release');
    });
    afterAll(async () => {
      await pool?.end();
    });
    const context = async (kind: string) => {
      const g = await seedProfileGraph(pool);
      const section = (
        await pool.query<{ id: string }>('select id from profile_section where profile_id=$1 and kind=$2', [
          g.profile,
          kind,
        ])
      ).rows[0]!;
      return {
        profileId: g.profile,
        organizationId: g.org,
        sectionId: section.id,
        revisionId: g.revisions[kind]!,
      } satisfies SectionContext;
    };
    const freeze = async (c: SectionContext) =>
      db.transaction(async (tx) => {
        await captureRevisionFileVersions(tx, { sectionRevisionId: c.revisionId, organizationId: c.organizationId });
        await tx.execute(sql`update profile_section set working_revision_id=null where id=${c.sectionId}`);
        await tx.execute(
          sql`update section_revision set state='submitted',submitted_at=now() where id=${c.revisionId}`,
        );
      });
    const addRequired = async (executor: pg.Pool | pg.PoolClient, dictionaryCode: string) =>
      (
        await executor.query<{ id: string }>(
          'insert into dictionary_entry (dictionary_id,code,mandatory) select id,$2,true from dictionary where code=$1 returning id',
          [dictionaryCode, `required_${randomUUID()}`],
        )
      ).rows[0]!.id;
    const waitForAdvisory = async (pid: number) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const result = await pool.query<{ waiting: boolean }>(
          "select wait_event='advisory' as waiting from pg_stat_activity where pid=$1",
          [pid],
        );
        if (result.rows[0]?.waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Expected requirement mutation to wait on the shared advisory lock');
    };

    it('keeps fixed baselines mandatory and includes only active administrator-required additional types', async () => {
      const certs = await currentRequirementIds(db, 'certificates');
      const docs = await currentRequirementIds(db, 'documents');
      expect(certs).toHaveLength(3);
      expect(docs).toHaveLength(2);
      await pool.query('update dictionary_entry set mandatory=false where id=any($1::uuid[])', [[...certs, ...docs]]);
      const extra = await addRequired(pool, 'document_type');
      expect(await currentRequirementIds(db, 'documents')).toEqual(expect.arrayContaining([...docs, extra]));
      await pool.query('update dictionary_entry set retired_at=now() where id=$1', [extra]);
      expect(await currentRequirementIds(db, 'documents')).toEqual(docs);
    });
    it('requires a new snapshot when requirements change, preserving frozen evidence', async () => {
      const c = await context('documents');
      const original = await currentRequirementIds(db, 'documents');
      await db.transaction(async (tx) => {
        await lockCurrentSubmissionRequirements(tx);
        await captureSubmissionRequirements(tx, c, original, new Date());
      });
      await freeze(c);
      expect(await requirementSnapshotMatches(db, c, original)).toBe(true);
      const added = await addRequired(pool, 'document_type');
      expect(await requirementSnapshotMatches(db, c, await currentRequirementIds(db, 'documents'))).toBe(false);
      await expect(captureSubmissionRequirements(db, c, [...original, added], new Date())).rejects.toMatchObject({
        code: 'submission_requirements_changed',
      });
      expect(await requirementSnapshotMatches(db, c, original)).toBe(true);
      await pool.query('update dictionary_entry set retired_at=now() where id=$1', [added]);
    });
    it('rejects a foreign profile context without deleting an existing working snapshot', async () => {
      const c = await context('certificates');
      const ids = await currentRequirementIds(db, 'certificates');
      await captureSubmissionRequirements(db, c, ids, new Date());
      await expect(
        captureSubmissionRequirements(db, { ...c, profileId: randomUUID() }, [], new Date()),
      ).rejects.toMatchObject({ code: 'submission_requirements_changed' });
      expect(await requirementSnapshotMatches(db, c, ids)).toBe(true);
      expect(await requirementSnapshotMatches(db, c, ids.slice(1))).toBe(false);
    });
    it('blocks a newly inserted required type until the captured Send set transaction ends', async () => {
      const owner = await pool.connect();
      const mutator = await pool.connect();
      let pending: Promise<string> | undefined;
      try {
        await owner.query('begin');
        const before = await lockCurrentSubmissionRequirements(drizzle(owner, { schema }));
        const pid = (await mutator.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
        pending = addRequired(mutator, 'certificate_type');
        await waitForAdvisory(pid);
        expect(await currentRequirementIds(drizzle(owner, { schema }), 'certificates')).toEqual(before.certificates);
        await owner.query('commit');
        const inserted = await pending;
        expect(await currentRequirementIds(db, 'certificates')).toContain(inserted);
        await pool.query('update dictionary_entry set retired_at=now() where id=$1', [inserted]);
      } finally {
        await owner.query('rollback');
        await pending?.catch(() => undefined);
        owner.release();
        mutator.release();
      }
    });
    it('sees a type committed while waiting for an earlier administrator mutation', async () => {
      const mutator = await pool.connect();
      const sender = await pool.connect();
      let pending: Promise<Awaited<ReturnType<typeof lockCurrentSubmissionRequirements>>> | undefined;
      try {
        await mutator.query('begin');
        const inserted = await addRequired(mutator, 'document_type');
        await sender.query('begin');
        const pid = (await sender.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
        pending = lockCurrentSubmissionRequirements(drizzle(sender, { schema }));
        await waitForAdvisory(pid);
        await mutator.query('commit');
        expect((await pending).documents).toContain(inserted);
        await sender.query('commit');
        await pool.query('update dictionary_entry set retired_at=now() where id=$1', [inserted]);
      } finally {
        await mutator.query('rollback');
        await sender.query('rollback');
        await pending?.catch(() => undefined);
        mutator.release();
        sender.release();
      }
    });
    it('takes the shared lock before the real administrator pathway locks an existing entry', async () => {
      const organization = (await pool.query<{ id: string }>("select id from organizations where type='imbc'"))
        .rows[0]!;
      const actor: AuthUser = {
        id: randomUUID(),
        organizationId: organization.id,
        organizationType: 'imbc',
        role: 'administrator',
        email: `${randomUUID()}@admin.local`,
        fullName: null,
        locale: 'en',
      };
      await pool.query(
        "insert into user_accounts (id,organization_id,role,state,email) values ($1,$2,'administrator','active',$3)",
        [actor.id, actor.organizationId, actor.email],
      );
      const entry = (await currentRequirementIds(db, 'documents'))[0]!;
      const sender = await pool.connect();
      const probe = await pool.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await sender.query('begin');
        await lockSubmissionRequirementDictionary(drizzle(sender, { schema }));
        pending = new DictionariesService(db, pool, new AuditService(db)).setMandatory(
          actor,
          'document_type',
          entry,
          true,
        );
        void pending.catch(() => undefined);
        const deadline = Date.now() + 1000;
        let waiting = false;
        while (Date.now() < deadline) {
          waiting = (
            await pool.query<{ waiting: boolean }>(
              "select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory') as waiting",
            )
          ).rows[0]!.waiting;
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        // The old entry-first implementation already held this row and NOWAIT failed with 55P03.
        await probe.query('begin');
        await expect(
          probe.query('select id from dictionary_entry where id=$1 for no key update nowait', [entry]),
        ).resolves.toMatchObject({ rowCount: 1 });
        await probe.query('rollback');
        await sender.query('commit');
        await pending;
        expect(
          (await pool.query('select mandatory from dictionary_entry where id=$1', [entry])).rows[0]!.mandatory,
        ).toBe(true);
      } finally {
        await probe.query('rollback');
        await sender.query('rollback');
        await pending?.catch(() => undefined);
        sender.release();
        probe.release();
      }
    });
    it('uses a passed captured version when a later replacement is rejected', async () => {
      const c = await context('documents');
      await freeze(c);
      await pool.query(
        `insert into file_version (file_object_id,version_number,original_name,byte_size,declared_media_type,checksum,storage_key,scan_state)
      select file_object_id,2,'replacement.pdf',1,'application/pdf','fixture',$2,'rejected' from revision_file_version where section_revision_id=$1`,
        [c.revisionId, randomUUID()],
      );
      await expect(validateFrozenSubmissionFiles(db, c)).resolves.toBeUndefined();
      await expect(validateFrozenSubmissionFiles(db, { ...c, organizationId: randomUUID() })).rejects.toMatchObject({
        code: 'submission_file_unavailable',
      });
    });
    it('fails closed on a frozen file with no captured version instead of reconstructing latest evidence', async () => {
      const c = await context('personnel');
      await db.transaction(async (tx) => {
        await tx.execute(sql`update profile_section set working_revision_id=null where id=${c.sectionId}`);
        await tx.execute(
          sql`update section_revision set state='submitted',submitted_at=now() where id=${c.revisionId}`,
        );
      });
      await expect(validateFrozenSubmissionFiles(db, c)).rejects.toMatchObject({ code: 'submission_file_unavailable' });
      expect(
        (
          await pool.query('select count(*)::int as count from revision_file_version where section_revision_id=$1', [
            c.revisionId,
          ])
        ).rows[0]!.count,
      ).toBe(0);
    });
    it('captures the shared optional production/equipment photo once and rejects unsafe frozen evidence', async () => {
      const c = await context('production');
      await freeze(c);
      const captured = (
        await pool.query<{ file_version_id: string }>(
          'select file_version_id from revision_file_version where section_revision_id=$1',
          [c.revisionId],
        )
      ).rows;
      expect(captured).toHaveLength(1);
      await expect(validateFrozenSubmissionFiles(db, c)).resolves.toBeUndefined();
      await pool.query("update file_version set scan_state='rejected' where id=$1", [captured[0]!.file_version_id]);
      await expect(validateFrozenSubmissionFiles(db, c)).rejects.toMatchObject({ code: 'submission_file_unavailable' });
    });
  },
);
