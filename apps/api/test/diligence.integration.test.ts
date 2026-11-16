import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ROLES, diligenceHistorySchema, type Role } from '@imbc/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { DiligenceController } from '../src/modules/due-diligence/diligence.controller.js';
import { DiligenceService } from '../src/modules/due-diligence/diligence.service.js';
import { DiligenceWorker } from '../src/modules/due-diligence/diligence-worker.js';
import { diligenceReportReadRule } from '../src/modules/due-diligence/report-files.js';
import { recordDiligenceSourceReceipt } from '../src/modules/due-diligence/source-snapshot-store.js';
import type { DiligenceSourceReceipt } from '../src/modules/due-diligence/source-receipt.js';
import { ADATA_DILIGENCE_SCHEMA_SHA256 } from '../src/modules/due-diligence/adata-normalizer.js';
import { DILIGENCE_CATALOG, DILIGENCE_CATALOG_VERSION } from '../src/modules/due-diligence/catalog.js';
import { evaluateReceivedDiligence, type DiligenceEvidence } from '../src/modules/due-diligence/scoring.js';
import {
  storedDiligenceState,
  type DiligenceOperationPhase,
} from '../src/modules/due-diligence/diligence-operation.js';
import { profileCandidateRevisions, profileSubmissionRevisions } from '../src/modules/profiles/profile-candidate.js';
import { ProfileReviewService, profileReviewEvidence } from '../src/modules/profiles/profile-review.service.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';
import { startHttp, type HttpStand } from './support/http.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('canonical DD complete transactions and role isolation', () => {
  vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
  let pool: pg.Pool,
    appPool: pg.Pool,
    db: Database,
    appDb: Database,
    service: DiligenceService,
    boss: PgBoss,
    http: HttpStand;
  let expert: AuthUser, director: AuthUser;
  const role = `diligence_${randomUUID().replaceAll('-', '')}`;
  type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
  const definition = (name: string) => DILIGENCE_CATALOG.find((c) => c.title === name)!;
  const evidence = (result: 'green' | 'amber' | 'red'): DiligenceEvidence[] => {
    const d = definition(result === 'amber' ? 'Mass registration address' : 'Bankrupt');
    return [
      {
        group: d.group,
        subjectIndex: 0,
        subjectName: 'Synthetic company',
        sourceOrder: 0,
        catalogId: d.id,
        checkName: d.title,
        kind: 'boolean',
        value: result !== 'green',
      },
    ];
  };
  const receipt = (result: 'green' | 'amber' | 'red'): DiligenceSourceReceipt => ({
    state: 'received',
    evidence: evidence(result),
    automaticResult: evaluateReceivedDiligence(evidence(result)).automaticResult,
    schemaVersion: DILIGENCE_CATALOG_VERSION,
    schemaSha256: ADATA_DILIGENCE_SCHEMA_SHA256,
    isTestData: true,
  });
  const receive = async (
    g: Fixture,
    value: DiligenceSourceReceipt,
    opts: { attemptId?: string; completedAt?: string; checkId?: string } = {},
  ) => {
    let snapshotId: string | null = null,
      attemptId = opts.attemptId;
    await appDb.transaction(async (raw) => {
      const tx = raw as unknown as Database;
      let checkId = opts.checkId;
      if (!checkId) {
        const [existing] = await tx.select().from(s.externalCheck).where(eq(s.externalCheck.profileId, g.profile));
        checkId = existing?.id;
        if (!checkId)
          checkId = (
            await tx
              .insert(s.externalCheck)
              .values({ profileId: g.profile, organizationId: g.org, connector: 'adata' })
              .returning()
          )[0]!.id;
      }
      const terminalState = ['received', 'no_answer', 'modules_not_connected', 'malformed'].includes(value.state)
        ? 'received'
        : value.state;
      if (attemptId) {
        await tx.execute(sql`update external_check_attempt set state=${terminalState}::external_check_state,
          completed_at=${opts.completedAt ?? '2026-11-16T00:00:00.123457Z'}::timestamptz,is_test_data=${value.isTestData} where id=${attemptId}`);
      } else {
        attemptId = (
          await tx
            .insert(s.externalCheckAttempt)
            .values({
              externalCheckId: checkId,
              trigger: 'sme_rerun',
              bin: '000000000000',
              state: terminalState as 'received',
              isTestData: value.isTestData,
              completedAt: sql`${opts.completedAt ?? '2026-11-16T00:00:00.123456Z'}::timestamptz`,
            })
            .returning()
        )[0]!.id;
      }
      await tx.update(s.externalCheck).set({ latestAttemptId: attemptId }).where(eq(s.externalCheck.id, checkId));
      snapshotId = await recordDiligenceSourceReceipt(tx, {
        profileId: g.profile,
        organizationId: g.org,
        attemptId: attemptId!,
        ...value,
      });
    });
    return { snapshotId: snapshotId!, attemptId: attemptId! };
  };
  beforeAll(async () => {
    pool = openTestPool();
    const target = new URL(process.env.TEST_DATABASE_URL!);
    if (target.hostname !== '127.0.0.1' || target.port !== '55433')
      throw new Error('DD runner requires exclusive isolated port 55433');
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
    const imbc = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
    const actor = async (kind: 'expert' | 'director'): Promise<AuthUser> => {
      const row = (
        await db
          .insert(s.userAccounts)
          .values({
            organizationId: imbc.id,
            role: kind,
            state: 'active',
            email: `${randomUUID()}@diligence.local`,
            fullName: `${kind} DD reviewer`,
          })
          .returning()
      )[0]!;
      return {
        id: row.id,
        organizationId: imbc.id,
        organizationType: 'imbc',
        role: kind,
        email: row.email,
        fullName: row.fullName,
        locale: 'en',
      };
    };
    expert = await actor('expert');
    director = await actor('director');
    await pool.query(`create role "${role}" nologin`);
    await applyAppRoleGrants(pool, role);
    appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c role=${role}`, max: 5 });
    appDb = drizzle(appPool, { schema: s, casing: 'snake_case' });
    service = new DiligenceService(appPool, new AuditService(appDb));
    boss = new PgBoss({
      connectionString: process.env.TEST_DATABASE_URL,
      schema: 'pgboss_auth_test',
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.createQueue(QUEUES.notify);
    await pool.query(
      `grant usage on schema pgboss_auth_test to "${role}"; grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`,
    );
    http = await startHttp({
      controllers: [DiligenceController],
      providers: [{ provide: DiligenceService, useValue: service }],
      organizationId: imbc.id,
      accountIds: { expert: expert.id, director: director.id },
    });
  });
  afterAll(async () => {
    await http?.close();
    await boss?.stop();
    await appPool?.end();
    if (pool) await pool.query(`drop owned by "${role}"; drop role "${role}"`);
    await pool?.end();
  });

  it('receives once, preserves exact compound values/order/subjects, and fully replays before/after history', async () => {
    const g = await seedSubmissionProfile(pool);
    const unknown: DiligenceEvidence = {
      group: 'director',
      subjectIndex: 0,
      subjectName: 'Same person',
      sourceOrder: 0,
      catalogId: null,
      checkName: 'New provider flag',
      kind: 'boolean',
      value: true,
    };
    const packet = receipt('green');
    packet.evidence = [
      ...packet.evidence,
      unknown,
      { ...unknown, group: 'founder', sourceOrder: 1 },
      {
        group: 'company_enterprise',
        subjectIndex: 0,
        subjectName: 'Synthetic company',
        sourceOrder: 9,
        catalogId: definition('Participation in court cases').id,
        checkName: 'Participation in court cases',
        kind: 'court_counts',
        civil: '9007199254740993',
        criminal: '0',
        administrative: null,
        appk: '0012',
      },
    ];
    packet.automaticResult = evaluateReceivedDiligence(packet.evidence).automaticResult;
    const source = await receive(g, packet);
    expect(source.snapshotId).toBeTruthy();
    expect(await service.refresh(g.profile, g.org)).toBe(true);
    expect(await service.refresh(g.profile, g.org)).toBe(false);
    const first = await service.read({ actor: expert }, g.profile);
    expect(first.record?.sourceSnapshotId).toBe(source.snapshotId);
    expect(first.record).toMatchObject({ checkedAt: '2026-11-16T00:00:00.123456Z', sourceIsTestData: true });
    expect(first.record?.result).toBe('red');
    expect(first.checks).toHaveLength(4);
    expect(first.checks.some((c) => c.adataValue?.includes('9007199254740993'))).toBe(true);
    expect(first.checks.filter((c) => c.subjectName === 'Same person').map((c) => c.groupName)).toEqual([
      'director',
      'founder',
    ]);
    expect(first.record?.updatedAt).toMatch(/\.\d{6}Z$/);
    expect(first.lastRun?.completedAt).toBe('2026-11-16T00:00:00.123456Z');
    const second = await service.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: first.record!.updatedAt,
      result: 'amber',
      comment: 'Reviewed',
      reportFileId: null,
    });
    const history = await service.history({ actor: director }, g.profile);
    expect(history).toHaveLength(2);
    expect(history[1]!.diff.before).toEqual({ record: null, checks: [] });
    expect(history[0]!.diff.before).toEqual(history[1]!.diff.after);
    expect(history[0]!.diff.after).toEqual(await storedDiligenceState(db, g.profile, g.org));
    expect(history[1]!.diff.actor).toEqual({ type: 'system' });
    expect(history[1]!.actorName).toBeNull();
    expect(history[0]!.actorName).toBe('expert DD reviewer');
    expect(second.record!.checkedOn).toBe(first.record!.checkedOn);
  });

  it('returns exact mock/live provenance for both historical pins without inheriting a newer failed attempt', async () => {
    const g = await seedSubmissionProfile(pool);
    const mockTime = '2026-11-16T00:00:00.123456Z';
    const realTime = '2026-11-17T00:00:00.000001Z';
    const mock = await receive(g, receipt('green'), { completedAt: mockTime });
    expect(await service.refresh(g.profile, g.org)).toBe(true);
    const real = await receive(g, { ...receipt('amber'), isTestData: false }, { completedAt: realTime });
    expect(await service.refresh(g.profile, g.org)).toBe(true);
    const other = await seedSubmissionProfile(pool);
    const unrelated = await receive(other, receipt('red'));
    expect(await service.refresh(other.profile, other.org)).toBe(true);
    await receive(
      g,
      { ...receipt('green'), state: 'no_answer', evidence: [], automaticResult: null },
      {
        completedAt: '2026-11-18T00:00:00.000002Z',
      },
    );
    // The receipt is acknowledged in the technical outbox without replacing the business record.
    expect(await service.refresh(g.profile, g.org)).toBe(true);
    expect(await service.refresh(g.profile, g.org)).toBe(false);
    const current = await service.read({ actor: director }, g.profile);
    expect(current.record).toMatchObject({
      sourceSnapshotId: real.snapshotId,
      checkedAt: realTime,
      sourceIsTestData: false,
    });
    expect(current.lastRun).toMatchObject({ state: 'no_answer', isTestData: true });
    const response = await http.get(`/api/v1/profiles/${g.profile}/due-diligence/history`, 'director');
    expect(response.status).toBe(200);
    const history = diligenceHistorySchema.parse(await response.json());
    expect(history).toHaveLength(2);
    expect(history[0]!.sourceSnapshots).toEqual([
      { snapshotId: mock.snapshotId, checkedAt: mockTime, isTestData: true },
      { snapshotId: real.snapshotId, checkedAt: realTime, isTestData: false },
    ]);
    expect(history[1]!.sourceSnapshots).toEqual([
      { snapshotId: mock.snapshotId, checkedAt: mockTime, isTestData: true },
    ]);
    expect(history[0]!.diff.before.record!.source_snapshot_id).toBe(mock.snapshotId);
    expect(history[0]!.diff.after.record!.source_snapshot_id).toBe(real.snapshotId);
    expect(JSON.stringify(history)).not.toContain(unrelated.snapshotId);
  });

  it('persists attention separately from partial tax/contracts, preserving it in complete manual history', async () => {
    const g = await seedSubmissionProfile(pool);
    const base = { subjectIndex: 0, subjectName: 'Synthetic company', sourceOrder: 0, catalogId: null };
    const lines: DiligenceEvidence[] = [
      ...evidence('amber'),
      { ...base, group: 'company_tax', checkName: 'Tax regime', kind: 'tax_regime', value: 'Special regime' },
      {
        ...base,
        group: 'company_tax',
        checkName: 'Tax payments',
        kind: 'tax_payment',
        year: 2026,
        tax: '00100.00',
        payroll: null,
        total: null,
      },
      {
        ...base,
        group: 'company_procurement',
        checkName: 'Concluded contracts',
        catalogId: definition('Concluded contracts').id,
        kind: 'contracts',
        count: null,
        sum: '9007199254740993.00',
      },
      { ...base, group: 'director', checkName: 'New provider flag', kind: 'no_answer' },
      ...evidence('green'),
    ];
    const evaluated = evaluateReceivedDiligence(lines);
    expect(evaluated.automaticResult).toBe('amber');
    await receive(g, { ...receipt('amber'), evidence: lines, automaticResult: evaluated.automaticResult });
    await service.refresh(g.profile, g.org);
    const current = await service.read({ actor: expert }, g.profile);
    const summary = current.checks.map((c) => ({ name: c.checkName, mark: c.mark, attention: c.attention }));
    expect(summary).toEqual(evaluated.checks.map((c) => ({ name: c.checkName, mark: c.mark, attention: c.attention })));
    expect(summary.filter((c) => c.attention)).toEqual([
      { name: 'Mass registration address', mark: 'shown_only', attention: true },
    ]);
    for (const name of ['Tax regime', 'Tax payments', 'Concluded contracts'])
      expect(summary.find((c) => c.name.startsWith(name))).toMatchObject({ mark: 'shown_only', attention: false });
    const overridden = await service.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: current.record!.updatedAt,
      result: 'green',
      comment: 'Reviewed attention',
      reportFileId: null,
    });
    expect(overridden.checks).toEqual(current.checks);
    const history = await service.history({ actor: director }, g.profile);
    expect(history[0]!.diff.before.checks).toEqual(history[1]!.diff.after.checks);
    expect(history[0]!.diff.after.checks).toEqual(history[0]!.diff.before.checks);
    expect(history[0]!.diff.after.checks.filter((c) => c.attention)).toHaveLength(1);
  });

  it.each([
    'audit',
    'sealed',
    'checks_deleted',
    'record_written',
    'checks_written',
    'projection',
  ] as DiligenceOperationPhase[])(
    'rolls back current result, complete checks, audit, sealed operation, outbox and catalog after %s failure',
    async (phase) => {
      const g = await seedSubmissionProfile(pool);
      await receive(g, receipt('red'));
      await service.refresh(g.profile, g.org);
      const before = await storedDiligenceState(db, g.profile, g.org);
      const current = await service.read({ actor: expert }, g.profile);
      const snapshot = async () =>
        (
          await pool.query(
            `select
        (select count(*)::integer from audit_entries where object_type='due_diligence' and object_id=$1) as audits,
        (select count(*)::integer from diligence_operation where profile_id=$1::uuid) as operations,
        (select to_jsonb(o) from diligence_refresh_outbox o where profile_id=$1::uuid) as outbox,
        (select to_jsonb(c) from catalog_visible c where profile_id=$1::uuid) as catalog`,
            [g.profile],
          )
        ).rows[0];
      const meta = await snapshot();
      await expect(
        service.override(
          { actor: expert },
          g.profile,
          { expectedUpdatedAt: current.record!.updatedAt, result: 'green', comment: 'Reviewed', reportFileId: null },
          async (at) => {
            if (at === phase) throw new Error('Injected atomic failure');
          },
        ),
      ).rejects.toThrow('Injected');
      expect(await storedDiligenceState(db, g.profile, g.org)).toEqual(before);
      expect(await snapshot()).toEqual(meta);
    },
  );

  it('fails closed on direct check/record mutation, a reused seal, truncated after and append-only evidence', async () => {
    const g = await seedSubmissionProfile(pool);
    const source = await receive(g, receipt('green'));
    await service.refresh(g.profile, g.org);
    await expect(
      appPool.query('delete from due_diligence_check where profile_id=$1', [g.profile]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      appPool.query("update due_diligence_record set result='red' where profile_id=$1", [g.profile]),
    ).rejects.toMatchObject({ code: '23514' });
    const op = (await pool.query('select id from diligence_operation where profile_id=$1', [g.profile])).rows[0].id;
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("select set_config('imbc.diligence_operation_id',$1,true)", [op]);
      await expect(
        client.query('delete from due_diligence_check where profile_id=$1', [g.profile]),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    await expect(
      appPool.query('update diligence_source_snapshot set schema_version=$1 where id=$2', [
        'forged',
        source.snapshotId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(appPool.query('truncate due_diligence_check')).rejects.toMatchObject({ code: '42501' });
    await expect(appPool.query('delete from diligence_operation where id=$1', [op])).rejects.toMatchObject({
      code: '42501',
    });
  });

  it.each([
    'no_answer',
    'unavailable',
    'modules_not_connected',
    'not_configured',
    'quota_exhausted',
    'malformed',
  ] as const)('retains the prior business result/check date/checks for a terminal %s receipt', async (state) => {
    const g = await seedSubmissionProfile(pool);
    await receive(g, receipt('red'));
    await service.refresh(g.profile, g.org);
    const before = await storedDiligenceState(db, g.profile, g.org);
    const source = await receive(
      g,
      { ...receipt('green'), state, evidence: [], automaticResult: null, isTestData: false },
      { completedAt: '2026-11-17T00:00:00.654321Z' },
    );
    expect(await service.refresh(g.profile, g.org)).toBe(true);
    expect(await storedDiligenceState(db, g.profile, g.org)).toEqual(before);
    const current = await service.read({ actor: expert }, g.profile);
    expect(current.record).toMatchObject({
      checkedAt: '2026-11-16T00:00:00.123456Z',
      sourceIsTestData: true,
      sourceSnapshotId: before.record!.source_snapshot_id,
    });
    expect(current.lastRun).toMatchObject({
      state,
      snapshotId: source.snapshotId,
      completedAt: '2026-11-17T00:00:00.654321Z',
      isTestData: false,
    });
  });

  it('does not invent green for initial unavailable/no-answer and enhanced cannot create a result', async () => {
    const g = await seedSubmissionProfile(pool);
    await receive(g, { ...receipt('green'), state: 'no_answer', evidence: [], automaticResult: null });
    await service.refresh(g.profile, g.org);
    expect((await service.read({ actor: expert }, g.profile)).record).toBeNull();
    await expect(
      service.enhanced({ actor: expert }, g.profile, {
        expectedUpdatedAt: null,
        enhanced: 'done',
        comment: null,
        reportFileId: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('keeps independent enhanced evidence across a new successful automatic run and resets only the old override', async () => {
    const g = await seedSubmissionProfile(pool);
    await receive(g, receipt('red'));
    await service.refresh(g.profile, g.org);
    let current = await service.read({ actor: expert }, g.profile);
    current = await service.enhanced({ actor: expert }, g.profile, {
      expectedUpdatedAt: current.record!.updatedAt,
      enhanced: 'done',
      comment: 'Enhanced evidence',
      reportFileId: null,
    });
    current = await service.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: current.record!.updatedAt,
      result: 'amber',
      comment: 'Override',
      reportFileId: null,
    });
    await receive(g, receipt('green'), { completedAt: '2026-11-17T00:00:00.000001Z' });
    await service.refresh(g.profile, g.org);
    expect((await service.read({ actor: expert }, g.profile)).record).toMatchObject({
      enhanced: 'done',
      enhancedComment: 'Enhanced evidence',
      checkedOn: '2026-11-17',
      result: 'green',
      adataResult: 'green',
      comment: null,
      overriddenBy: null,
      overriddenAt: null,
    });
  });

  it('distinguishes same-ID config/quota completions by all microseconds and cannot apply an old receipt', async () => {
    const g = await seedSubmissionProfile(pool);
    const old = await receive(g, { ...receipt('green'), state: 'not_configured', evidence: [], automaticResult: null });
    await service.refresh(g.profile, g.org);
    const current = await receive(g, receipt('red'), {
      attemptId: old.attemptId,
      completedAt: '2026-11-16T00:00:00.123457Z',
    });
    expect(current.snapshotId).not.toBe(old.snapshotId);
    await service.refresh(g.profile, g.org);
    expect((await service.read({ actor: expert }, g.profile)).lastRun?.completedAt).toBe('2026-11-16T00:00:00.123457Z');
    await pool.query(
      "update diligence_refresh_outbox set requested_snapshot_id=$2,state='pending' where profile_id=$1",
      [g.profile, old.snapshotId],
    );
    expect(await service.refresh(g.profile, g.org)).toBe(false);
    expect((await service.read({ actor: expert }, g.profile)).record?.sourceSnapshotId).toBe(current.snapshotId);
  });

  it('serializes parallel overrides and rejects a stale exact six-digit token with 409', async () => {
    const g = await seedSubmissionProfile(pool);
    await receive(g, receipt('green'));
    await service.refresh(g.profile, g.org);
    const before = await service.read({ actor: expert }, g.profile);
    const body = { expectedUpdatedAt: before.record!.updatedAt, result: 'amber', comment: null, reportFileId: null };
    const results = await Promise.allSettled([
      service.override({ actor: expert }, g.profile, body),
      service.override({ actor: expert }, g.profile, body),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({ status: 409 });
    expect(await service.history({ actor: expert }, g.profile)).toHaveLength(2);
  });

  it.each(ROLES)('enforces %s read/write rights at the actual HTTP boundary', async (roleName) => {
    const g = await seedSubmissionProfile(pool);
    await receive(g, receipt('green'));
    await service.refresh(g.profile, g.org);
    const path = `/api/v1/profiles/${g.profile}/due-diligence`;
    expect((await http.get(path, roleName)).status).toBe(['expert', 'director'].includes(roleName) ? 200 : 403);
    const write = await http.send('PUT', `${path}/override`, roleName, {
      expectedUpdatedAt: null,
      result: 'red',
      comment: null,
      reportFileId: null,
    });
    expect(write.status).toBe(roleName === 'expert' ? 409 : 403);
  });

  it('uses current persisted policy and role rather than a stale HTTP/session grant', async () => {
    const g = await seedSubmissionProfile(pool);
    await receive(g, receipt('green'));
    await service.refresh(g.profile, g.org);
    await pool.query("update policy_rule set effect='deny' where role='expert' and action='imbc_records.edit'");
    try {
      await expect(
        service.override({ actor: expert }, g.profile, {
          expectedUpdatedAt: null,
          result: 'red',
          comment: null,
          reportFileId: null,
        }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await pool.query("update policy_rule set effect='allow' where role='expert' and action='imbc_records.edit'");
    }
    await pool.query("update user_accounts set role='administrator' where id=$1", [expert.id]);
    try {
      await expect(service.read({ actor: expert }, g.profile)).rejects.toMatchObject({ status: 403 });
    } finally {
      await pool.query("update user_accounts set role='expert' where id=$1", [expert.id]);
    }
  });

  const report = async (
    g: Fixture,
    purpose: 'due_diligence_report' | 'enhanced_due_diligence_report',
    state: 'passed' | 'pending' | 'rejected' = 'passed',
    org = g.org,
  ) => {
    const object = (
      await db.insert(s.fileObject).values({ organizationId: org, purpose, dataClass: 'c_imbc' }).returning()
    )[0]!;
    const version = (
      await db
        .insert(s.fileVersion)
        .values({
          fileObjectId: object.id,
          versionNumber: 1,
          originalName: 'synthetic.pdf',
          byteSize: 1,
          declaredMediaType: 'application/pdf',
          checksum: 'fixture',
          storageKey: randomUUID(),
          scanState: state,
        })
        .returning()
    )[0]!;
    return { object, version };
  };
  it('captures only a clean tenant/purpose/Class-C latest report and historical download pins never drift', async () => {
    const g = await seedSubmissionProfile(pool),
      other = await seedSubmissionProfile(pool);
    await receive(g, receipt('green'));
    await service.refresh(g.profile, g.org);
    let current = await service.read({ actor: expert }, g.profile);
    const valid = await report(g, 'due_diligence_report');
    current = await service.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: current.record!.updatedAt,
      result: 'amber',
      comment: null,
      reportFileId: valid.object.id,
    });
    await db.insert(s.fileVersion).values({
      fileObjectId: valid.object.id,
      versionNumber: 2,
      originalName: 'replacement.pdf',
      byteSize: 1,
      declaredMediaType: 'application/pdf',
      checksum: 'fixture2',
      storageKey: randomUUID(),
      scanState: 'passed',
    });
    const decision = await diligenceReportReadRule({
      tx: appDb,
      auth: { user: director } as never,
      file: valid.object,
    });
    expect(decision).toEqual({ allowed: true, versions: [valid.version.id] });
    current = await service.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: current.record!.updatedAt,
      result: 'green',
      comment: null,
      reportFileId: null,
    });
    expect(await diligenceReportReadRule({ tx: appDb, auth: { user: director } as never, file: valid.object })).toEqual(
      { allowed: true, versions: [valid.version.id] },
    );
    for (const file of [
      await report(g, 'due_diligence_report', 'pending'),
      await report(g, 'due_diligence_report', 'rejected'),
      await report(g, 'enhanced_due_diligence_report'),
      await report(g, 'due_diligence_report', 'passed', other.org),
    ]) {
      await expect(
        service.override({ actor: expert }, g.profile, {
          expectedUpdatedAt: current.record!.updatedAt,
          result: 'red',
          comment: null,
          reportFileId: file.object.id,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    const unattached = await report(g, 'due_diligence_report');
    expect(
      await diligenceReportReadRule({ tx: appDb, auth: { user: director } as never, file: unattached.object }),
    ).toEqual({ allowed: false });
    for (const roleName of ROLES.filter((r) => r !== 'expert' && r !== 'director'))
      expect(
        await diligenceReportReadRule({
          tx: appDb,
          auth: { user: { ...expert, role: roleName as Role } } as never,
          file: valid.object,
        }),
      ).toEqual({ allowed: false });
  });

  it('publishes only exact verified seven-section content, hides red atomically, restores green/amber without working leakage', async () => {
    const g = await seedSubmissionProfile(pool);
    await receive(g, receipt('green'));
    await service.refresh(g.profile, g.org);
    expect((await pool.query('select 1 from catalog_visible where profile_id=$1', [g.profile])).rowCount).toBe(0);
    const submit = new ProfileSubmitService(appPool, new AuditService(appDb), boss, submissionHandlers());
    const review = new ProfileReviewService(appPool, new AuditService(appDb), boss);
    const candidates = await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org });
    const revisions = await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, g.org));
    const sent = await submit.submit(g.actor, {
      operationKey: randomUUID(),
      accuracyConfirmed: true,
      expectedSections: candidates.map((c) => ({
        kind: c.kind,
        revisionId: c.revisionId!,
        editVersion: revisions.find((r) => r.id === c.revisionId)!.editVersion,
      })),
    });
    await review.take(expert, sent.assignmentId);
    const profile = (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile)))[0]!;
    const map = await profileSubmissionRevisions(db, {
      assignmentId: sent.assignmentId,
      profileId: g.profile,
      organizationId: g.org,
    });
    const facts = await profileReviewEvidence(db, { profile, map });
    for (const fact of facts.filter((f) => f.subject.kind === 'document' || f.subject.kind === 'certificate'))
      await review.decide(expert, sent.assignmentId, { subject: fact.subject, outcome: 'verified', comment: null });
    for (const section of sent.sections)
      await review.decide(expert, sent.assignmentId, {
        subject: { kind: 'section', sectionRevisionId: section.revisionId },
        outcome: 'verified',
        comment: null,
      });
    await review.submitResult(expert, sent.assignmentId);
    const original = (await pool.query('select card from catalog_visible where profile_id=$1', [g.profile])).rows[0]
      .card;
    expect(original.verifiedSections.products.lines[0].capacityQuantity).toBe('9007199254740993');
    expect(Object.keys(original.verifiedRevisionIds)).toHaveLength(7);
    expect(original.verifiedSections.main_information.loginEmail).toBeUndefined();
    expect(original.verifiedSections.main_information.source).toBeUndefined();
    expect(JSON.stringify(original)).not.toContain('Bankrupt');
    const editor = new ProfileSectionsService(appPool, new AuditService(appDb), submissionHandlers());
    const read = await editor.read(g.actor, 'products');
    const data = await new (await import('../src/modules/profiles/products.handler.js')).ProductsHandler().editable(
      db,
      {
        profileId: g.profile,
        organizationId: g.org,
        sectionId: g.sections.products,
        revisionId: g.revisions.products!,
      },
    );
    const manual = data.products.find((p) => p.kind === 'manual')!;
    if (manual.kind === 'manual') manual.nameEn = 'UNVERIFIED LEAK';
    await editor.save(g.actor, 'products', { editVersion: read.editVersion, data });
    let current = await service.read({ actor: expert }, g.profile);
    current = await service.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: current.record!.updatedAt,
      result: 'red',
      comment: 'Class C secret',
      reportFileId: null,
    });
    expect((await pool.query('select 1 from catalog_visible where profile_id=$1', [g.profile])).rowCount).toBe(0);
    await service.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: current.record!.updatedAt,
      result: 'amber',
      comment: 'Class C secret',
      reportFileId: null,
    });
    const restored = (await pool.query('select card from catalog_visible where profile_id=$1', [g.profile])).rows[0]
      .card;
    expect(restored.verifiedRevisionIds).toEqual(original.verifiedRevisionIds);
    expect(JSON.stringify(restored)).not.toContain('UNVERIFIED LEAK');
    expect(JSON.stringify(restored)).not.toContain('Class C secret');
    expect(restored.diligence).toEqual({ checkedOn: '2026-11-16', enhancedDone: false });
  });

  it('fairly retries failures with compare-and-set so a newer request is not delayed', async () => {
    const g = await seedSubmissionProfile(pool);
    const first = await receive(g, receipt('green'));
    const throwing = {
      refresh: async () => {
        await receive(g, receipt('red'));
        throw new Error('Synthetic failure');
      },
    };
    const worker = new DiligenceWorker(appPool, throwing as never);
    expect((await worker.refreshPending(1)).failed).toBe(1);
    const outbox = (
      await pool.query(
        'select requested_snapshot_id,last_attempt_at,attempt_count from diligence_refresh_outbox where profile_id=$1',
        [g.profile],
      )
    ).rows[0];
    expect(outbox.requested_snapshot_id).not.toBe(first.snapshotId);
    expect(outbox.last_attempt_at).toBeNull();
    expect(outbox.attempt_count).toBe(0);
  });
});
