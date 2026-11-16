import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import { openTestPool, resetDatabase, migrateThrough } from './support/database.js';
import { seedSubmissionProfile } from './support/profile-submit.js';
import { createVerifiedFixtureWorkflow } from './support/verified-fixture.js';

/** Nonempty29→30 technical upgrade; synthetic legacy/journal rows are preservation controls, not SMTP evidence. */
describe.skipIf(!process.env.TEST_DATABASE_URL)('Survey durable-notice nonempty migration and identity guards', () => {
  vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
  let pool: pg.Pool,
    workflow: Awaited<ReturnType<typeof createVerifiedFixtureWorkflow>>,
    profile: string,
    notice: string;
  let canonicalBefore: unknown, legacyBefore: unknown, journalBefore: unknown;
  const canonical = async () =>
    (
      await pool.query(`select jsonb_build_object(
    'records',(select jsonb_agg(to_jsonb(r) order by r.id) from site_survey_record r),
    'operations',(select jsonb_agg(to_jsonb(o) order by o.id) from site_survey_operation o),
    'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from audit_entries a),
    'files',(select jsonb_agg(to_jsonb(f) order by f.id) from file_object f),
    'versions',(select jsonb_agg(to_jsonb(v) order by v.id) from file_version v)) as data`)
    ).rows[0]!.data;
  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool, '0029_canonical_site_surveys');
    workflow = await createVerifiedFixtureWorkflow(pool);
    const g = await seedSubmissionProfile(pool);
    profile = g.profile;
    const record = await workflow.addSurvey(g);
    notice = (await pool.query('select id from site_survey_notice_outbox where profile_id=$1', [profile])).rows[0]!.id;
    await pool.query("update site_survey_notice_outbox set state='queued',queued_at=now() where id=$1", [notice]);
    await pool.query(
      "insert into site_survey_records(profile_id,result_yes,visit_from,source,comment) values($1,true,null,'migration','UNKNOWN LEGACY VISIT')",
      [profile],
    );
    await pool.query(
      `insert into notification(rule_code,recipient_email,language,dedup_key,related_object_type,related_object_id)
      values('NOT-11','legacy-receipt@migration.local','en',$1,'site_survey_notice',$2)`,
      [randomUUID(), notice],
    );
    canonicalBefore = await canonical();
    legacyBefore = (await pool.query('select jsonb_agg(to_jsonb(r) order by r.id) as data from site_survey_records r'))
      .rows[0]!.data;
    journalBefore = (await pool.query('select jsonb_agg(to_jsonb(n) order by n.id) as data from notification n'))
      .rows[0]!.data;
    expect(record.id).toBeTruthy();
    await migrateThrough(pool);
  });
  afterAll(async () => {
    await workflow?.close();
    await pool?.end();
  });
  it('preserves all canonical record/audit/pins, unresolved legacy rows and existing journal receipts', async () => {
    expect(await canonical()).toEqual(canonicalBefore);
    expect(
      (await pool.query('select jsonb_agg(to_jsonb(r) order by r.id) as data from site_survey_records r')).rows[0]!
        .data,
    ).toEqual(legacyBefore);
    expect(
      (await pool.query('select jsonb_agg(to_jsonb(n) order by n.id) as data from notification n')).rows[0]!.data,
    ).toEqual(journalBefore);
  });
  it('recovers old queued marks as pending without inventing sent mail or rewinding generations', async () => {
    expect(
      (
        await pool.query(
          `select state,queued_at,dispatch_id,notification_job_id,resolved_at,last_outcome,generation::text as generation
      from site_survey_notice_outbox where id=$1`,
          [notice],
        )
      ).rows[0],
    ).toEqual({
      state: 'pending',
      queued_at: null,
      dispatch_id: null,
      notification_job_id: null,
      resolved_at: null,
      last_outcome: 'legacy_queue_recovery',
      generation: '1',
    });
  });
  it('replays without changing business or notice data', async () => {
    const before = (
      await pool.query('select to_jsonb(n) as data from site_survey_notice_outbox n where id=$1', [notice])
    ).rows[0]!.data;
    await migrateThrough(pool);
    expect(await canonical()).toEqual(canonicalBefore);
    expect(
      (await pool.query('select to_jsonb(n) as data from site_survey_notice_outbox n where id=$1', [notice])).rows[0]!
        .data,
    ).toEqual(before);
  });
  it('keeps existing record/publication writers compatible with the additive delivery columns', async () => {
    const g = await seedSubmissionProfile(pool);
    await workflow.addSurvey(g);
    expect(
      (
        await pool.query(
          'select state,dispatch_id,notification_job_id from site_survey_notice_outbox where profile_id=$1',
          [g.profile],
        )
      ).rows[0],
    ).toEqual({ state: 'pending', dispatch_id: null, notification_job_id: null });
  });
  it('refuses event identity and generation rewrites', async () => {
    await expect(
      pool.query('update site_survey_notice_outbox set generation=generation+1 where id=$1', [notice]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("update site_survey_notice_outbox set created_at=created_at+interval '1 second' where id=$1", [
        notice,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        'update site_survey_publication_state set generation=0,site_surveyed=false,effective_until=null where profile_id=$1',
        [profile],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('requires a queued delivery token/job pair and prevents reopening terminal outcomes', async () => {
    await expect(
      pool.query("update site_survey_notice_outbox set state='queued',queued_at=now() where id=$1", [notice]),
    ).rejects.toMatchObject({ code: '23514' });
    // Technical state construction; actual SMTP/queue lifecycle is proved by the separate notice suite.
    await pool.query(
      "update site_survey_notice_outbox set state='queued',queued_at=now(),dispatch_id=$2,notification_job_id=$3 where id=$1",
      [notice, randomUUID(), randomUUID()],
    );
    await pool.query(
      "update site_survey_notice_outbox set state='obsolete',dispatch_id=null,notification_job_id=null,resolved_at=now() where id=$1",
      [notice],
    );
    await expect(
      pool.query("update site_survey_notice_outbox set state='pending',queued_at=null,resolved_at=null where id=$1", [
        notice,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('grants runtime only the narrow predicate lock helper and serializes inserted deny rules', async () => {
    const role = 'survey_notice_lock_' + randomUUID().replaceAll('-', '');
    await pool.query(`create role "${role}" nologin`);
    await applyAppRoleGrants(pool, role);
    const app = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c role=${role}`, max: 1 });
    const client = await app.connect(),
      insert = await pool.connect(),
      ruleId = randomUUID();
    let pending: Promise<pg.QueryResult> | undefined;
    try {
      expect(
        (
          await pool.query(
            `select has_table_privilege($1,'policy_rule','SELECT') as reads,
        has_table_privilege($1,'policy_rule','INSERT') as inserts,has_table_privilege($1,'policy_rule','UPDATE') as updates,
        has_function_privilege($1,'site_survey_lock_notification_policy()','EXECUTE') as locks`,
            [role],
          )
        ).rows[0],
      ).toEqual({ reads: true, inserts: false, updates: false, locks: true });
      await client.query('BEGIN');
      await client.query('select site_survey_lock_notification_policy()');
      const pid = (await insert.query('select pg_backend_pid() as pid')).rows[0]!.pid;
      pending = insert.query(
        `insert into policy_rule(id,role,data_class,action,condition,effect)
        values($1,'operator','a_register','catalog.search','account_events','deny')`,
        [ruleId],
      );
      let blocked = false;
      for (let i = 0; i < 50; i++) {
        const row = (await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0];
        if (row?.wait_event_type === 'Lock') {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await client.query('ROLLBACK');
      await pending;
      pending = undefined;
      expect((await pool.query('select id from policy_rule where id=$1', [ruleId])).rowCount).toBe(1);
    } finally {
      await client.query('ROLLBACK');
      await pending?.catch(() => undefined);
      await pool.query('delete from policy_rule where id=$1', [ruleId]);
      client.release();
      insert.release();
      await app.end();
      await pool.query(`drop owned by "${role}";drop role "${role}"`);
    }
  });
});
