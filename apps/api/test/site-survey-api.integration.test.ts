import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ROLES, MAX_FILE_BYTES, type Role, type SiteSurveyCreate, type SiteSurveyRecordView } from '@imbc/contracts';
import { sql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { ProfileReviewService, profileReviewEvidence } from '../src/modules/profiles/profile-review.service.js';
import { profileCandidateRevisions, profileSubmissionRevisions } from '../src/modules/profiles/profile-candidate.js';
import { SiteSurveyService } from '../src/modules/site-survey/site-survey.service.js';
import { SiteSurveyRequestsService } from '../src/modules/site-survey/site-survey-requests.service.js';
import {
  SiteSurveyController,
  OwnSiteSurveyRequestsController,
  SiteSurveyRequestsController,
} from '../src/modules/site-survey/site-survey.controller.js';
import { surveySummary } from '../src/modules/site-survey/survey-store.js';
import type { SurveyPublication, SurveyMutationPhase } from '../src/modules/site-survey/survey-operation.js';
import { openTestPool, resetDatabase, migrateThrough } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';
import { ORGANIZATION_TYPE } from './support/organization-type.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';

/** Draft only: do not run before reviewed0029 and Root's real projection/file/NOT11 integration are released.
 * This suite proves record/request transactions and their publication PORT boundary, not NOT11 dispatch. */
describe.skipIf(!process.env.TEST_DATABASE_URL)('Survey records/requests with actual PostgreSQL and HTTP', () => {
  vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
  let pool: pg.Pool,
    appPool: pg.Pool,
    db: Database,
    boss: PgBoss,
    surveys: SiteSurveyService,
    requests: SiteSurveyRequestsService;
  let expert: AuthUser, other: AuthUser, director: AuthUser;
  const actors = {} as Record<Role, AuthUser>;
  const stands: HttpStand[] = [];
  const dbRole = 'survey_api_' + randomUUID().replaceAll('-', '');
  type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
  const body = (fileId: string): SiteSurveyCreate => ({
    visitStartedOn: '2020-05-10',
    visitEndedOn: '2020-05-11',
    result: 'yes',
    expiresOn: null,
    comment: 'Signed visit',
    reportFileId: fileId,
  });
  const edit = (row: SiteSurveyRecordView) => ({
    visitStartedOn: row.visitStartedOn!,
    visitEndedOn: row.visitEndedOn,
    result: row.result,
    expiresOn: row.expiresOn,
    comment: row.comment,
    reportFileId: row.reportFileId,
    expectedUpdatedAt: row.updatedAt,
  });
  const recordPath = (g: Fixture) => `/api/v1/profiles/${g.profile}/site-surveys`;
  const requestPath = (g: Fixture) => `/api/v1/profiles/${g.profile}/site-survey-requests`;
  const stand = async (actor: AuthUser) => {
    const http = await startHttp({
      controllers: [SiteSurveyController, OwnSiteSurveyRequestsController, SiteSurveyRequestsController],
      providers: [
        { provide: SiteSurveyService, useValue: surveys },
        { provide: SiteSurveyRequestsService, useValue: requests },
      ],
      organizationId: actor.organizationId,
      accountIds: { [actor.role]: actor.id },
    });
    stands.push(http);
    return http;
  };
  const post = (http: HttpStand, path: string, role: Role, payload: unknown, key: string | undefined) =>
    fetch(http.base + path, {
      method: 'POST',
      headers: {
        origin: 'https://imbc.example.kz',
        'content-type': 'application/json',
        cookie: `imbc-session=${role}`,
        ...(key ? { 'idempotency-key': key } : {}),
      },
      body: JSON.stringify(payload),
    });
  const report = async (g: Fixture, scan = 'passed', extra: Record<string, unknown> = {}) => {
    const file = (
      await db
        .insert(schema.fileObject)
        .values({
          organizationId: g.org,
          purpose: 'site_survey_report',
          dataClass: 'c_imbc',
        })
        .returning()
    )[0]!;
    const version = (
      await db
        .insert(schema.fileVersion)
        .values({
          fileObjectId: file.id,
          versionNumber: 1,
          originalName: 'signed.pdf',
          byteSize: 1,
          declaredMediaType: 'application/pdf',
          detectedMediaType: 'application/pdf',
          checksum: 'synthetic-local',
          storageKey: randomUUID(),
          scanState: scan as 'passed' | 'pending' | 'rejected',
          ...extra,
        })
        .returning()
    )[0]!;
    return { file: file.id, version: version.id };
  };
  const counts = async () => ({
    records: (await pool.query('select count(*)::int as n from site_survey_record')).rows[0].n,
    operations: (await pool.query('select count(*)::int as n from site_survey_operation')).rows[0].n,
    requests: (await pool.query('select count(*)::int as n from site_survey_request')).rows[0].n,
    audit: (await pool.query("select count(*)::int as n from audit_entries where action like 'site_survey.%'")).rows[0]
      .n,
    jobs: (await pool.query('select count(*)::int as n from pgboss_auth_test.job')).rows[0].n,
  });
  const verified = async (g: Fixture) => {
    const actorAudit = new AuditService(drizzle(appPool, { schema, casing: 'snake_case' }));
    const submit = new ProfileSubmitService(appPool, actorAudit, boss, submissionHandlers());
    const core = new ProfileReviewService(appPool, actorAudit, boss);
    const candidates = await profileCandidateRevisions(db, {
      profileId: g.profile,
      organizationId: g.org,
    });
    const revisions = await db
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.organizationId, g.org));
    const sent = await submit.submit(g.actor, {
      operationKey: randomUUID(),
      accuracyConfirmed: true,
      expectedSections: candidates.map((row) => ({
        kind: row.kind,
        revisionId: row.revisionId!,
        editVersion: revisions.find((r) => r.id === row.revisionId)!.editVersion,
      })),
    });
    await core.take(expert, sent.assignmentId);
    const profile = (
      await db.select().from(schema.manufacturerProfile).where(eq(schema.manufacturerProfile.id, g.profile))
    )[0]!;
    const map = await profileSubmissionRevisions(db, {
      assignmentId: sent.assignmentId,
      profileId: g.profile,
      organizationId: g.org,
    });
    const facts = await profileReviewEvidence(db, { profile, map });
    for (const fact of facts.filter((row) => row.subject.kind !== 'file' && row.subject.kind !== 'section'))
      await core.decide(expert, sent.assignmentId, {
        subject: fact.subject,
        outcome: 'verified',
        comment: null,
      });
    for (const fact of facts.filter((row) => row.subject.kind === 'section'))
      await core.decide(expert, sent.assignmentId, {
        subject: fact.subject,
        outcome: 'verified',
        comment: null,
      });
    await core.submitResult(expert, sent.assignmentId);
  };
  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    expect((await pool.query("select to_regclass('site_survey_record') is not null as ok")).rows[0].ok).toBe(true);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    const imbc = (await db.select().from(schema.organizations).where(eq(schema.organizations.type, 'imbc')))[0]!;
    for (const role of ROLES) {
      const organization =
        ORGANIZATION_TYPE[role] === 'imbc'
          ? imbc
          : (
              await db
                .insert(schema.organizations)
                .values({
                  name: `Survey ${role}`,
                  type: ORGANIZATION_TYPE[role],
                })
                .returning()
            )[0]!;
      const account = (
        await db
          .insert(schema.userAccounts)
          .values({
            organizationId: organization.id,
            role,
            state: 'active',
            email: `${randomUUID()}@survey.local`,
          })
          .returning()
      )[0]!;
      actors[role] = {
        id: account.id,
        organizationId: organization.id,
        organizationType: organization.type,
        role,
        email: account.email,
        fullName: null,
        locale: 'en',
      };
    }
    expert = actors.expert;
    director = actors.director;
    const account = (
      await db
        .insert(schema.userAccounts)
        .values({
          organizationId: imbc.id,
          role: 'expert',
          state: 'active',
          email: `${randomUUID()}@survey.local`,
        })
        .returning()
    )[0]!;
    other = { ...expert, id: account.id, email: account.email };
    boss = new PgBoss({
      connectionString: process.env.TEST_DATABASE_URL,
      schema: 'pgboss_auth_test',
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.createQueue(QUEUES.notify);
    await pool.query(`create role "${dbRole}" nologin`);
    await applyAppRoleGrants(pool, dbRole);
    await pool.query(
      `grant usage on schema pgboss_auth_test to "${dbRole}";grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${dbRole}"`,
    );
    appPool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c role=${dbRole}`,
      max: 5,
    });
    const audit = new AuditService(drizzle(appPool, { schema, casing: 'snake_case' }));
    const boundary: SurveyPublication = {
      // Explicit test seam only. Root must add tests with the real durable generation/outbox implementation.
      observeBeforeMutation: async (tx, scope) => ({
        ...scope,
        asOfAlmatyDate: (
          await tx.execute<{ day: string }>(
            sql`select (clock_timestamp() at time zone 'Asia/Almaty')::date::text as day`,
          )
        ).rows[0]!.day,
        effectiveBefore: {
          summary: await surveySummary(tx, {
            ...scope,
            organizationName: '',
            profileStatus: 'draft',
          }),
          effectiveUntil: null,
        },
        persistedBefore: {
          siteSurveyed: false,
          generation: 0n,
          effectiveUntil: null,
        },
      }),
      refreshAfterMutation: async () => {},
    };
    surveys = new SiteSurveyService(appPool, audit, boundary);
    requests = new SiteSurveyRequestsService(appPool, audit);
  });
  afterAll(async () => {
    for (const http of stands) await http.close();
    await boss?.stop();
    await appPool?.end();
    if (pool) await pool.query(`drop owned by "${dbRole}";drop role "${dbRole}"`);
    await pool?.end();
  });

  it.each(ROLES)('checks full Class C record reads and edits for persisted %s HTTP actor', async (role) => {
    const g = await seedSubmissionProfile(pool),
      file = await report(g),
      created = await surveys.create(expert, g.profile, body(file.file), randomUUID());
    const http = await stand(actors[role]);
    const read = await http.get(recordPath(g) + '/' + created.id, role);
    expect(read.status).toBe(['expert', 'director'].includes(role) ? 200 : 403);
    const updated = await http.send('PUT', recordPath(g) + '/' + created.id, role, {
      ...edit(created),
      comment: 'Edited via HTTP',
    });
    expect(updated.status).toBe(role === 'expert' ? 200 : 403);
  });
  it('audits own foreign profile refusal after rollback without exposing existence', async () => {
    const own = await seedSubmissionProfile(pool),
      foreign = await seedSubmissionProfile(pool),
      http = await stand(own.actor);
    for (const method of ['GET', 'POST']) {
      const response =
        method === 'GET'
          ? await http.get(requestPath(foreign), 'manufacturer')
          : await post(http, requestPath(foreign), 'manufacturer', {}, randomUUID());
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'not_found' });
    }
    expect(
      (
        await pool.query(
          "select count(*)::int as n from audit_entries where user_id=$1 and action='tier.request' and outcome='denied' and object_type='route'",
          [own.actor.id],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it('has several visits; any valid record keeps the mark independent of the requested page and DD visibility', async () => {
    const g = await seedSubmissionProfile(pool),
      file = await report(g);
    const older = await surveys.create(expert, g.profile, body(file.file), randomUUID());
    await surveys.create(
      expert,
      g.profile,
      {
        ...body(file.file),
        visitStartedOn: '2021-01-01',
        visitEndedOn: null,
        result: 'no',
      },
      randomUUID(),
    );
    const page = await surveys.list(director, g.profile, { limit: 1 });
    expect(page).toMatchObject({
      total: 2,
      tier: null,
      summary: {
        siteSurveyed: true,
        siteSurveyedOn: '2020-05-10',
        currentSurveyId: older.id,
      },
    });
    expect(page.items[0]!.result).toBe('no');
  });
  it('replays the original audited receipt and clean version after an edit and a newer pending upload', async () => {
    const g = await seedSubmissionProfile(pool),
      file = await report(g),
      key = randomUUID(),
      input = body(file.file);
    const created = await surveys.create(expert, g.profile, input, key);
    await db.insert(schema.fileVersion).values({
      fileObjectId: file.file,
      versionNumber: 2,
      originalName: 'replacement.pdf',
      byteSize: 1,
      declaredMediaType: 'application/pdf',
      detectedMediaType: 'application/pdf',
      checksum: 'synthetic-v2',
      storageKey: randomUUID(),
      scanState: 'pending',
    });
    await surveys.update(other, g.profile, created.id, {
      ...edit(created),
      comment: 'Later edit',
    });
    const replay = await surveys.create(
      expert,
      g.profile,
      { ...input, reportFileId: input.reportFileId.toUpperCase() },
      key.toUpperCase(),
    );
    expect(replay).toEqual(created);
    expect(replay.reportFileVersionId).toBe(file.version);
    expect((await surveys.read(director, g.profile, created.id)).comment).toBe('Later edit');
    expect((await surveys.history(director, g.profile, created.id, {})).items[0]!.before).toMatchObject({
      comment: created.comment,
      reportFileVersionId: file.version,
    });
  });
  it('requires a UUID operation key and refuses key reuse across another body or profile', async () => {
    const g = await seedSubmissionProfile(pool),
      foreign = await seedSubmissionProfile(pool),
      file = await report(g),
      key = randomUUID();
    const http = await stand(expert),
      input = body(file.file);
    expect((await post(http, recordPath(g), 'expert', input, undefined)).status).toBe(400);
    const created = await surveys.create(expert, g.profile, input, key),
      before = await counts();
    await expect(surveys.create(expert, g.profile, { ...input, result: 'no' }, key)).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(surveys.create(expert, foreign.profile, input, key)).rejects.toMatchObject({ code: 'conflict' });
    expect(await counts()).toEqual(before);
    expect(await surveys.read(director, g.profile, created.id)).toEqual(created);
  });
  it.each(['pending', 'rejected', 'wrong_type'])(
    'refuses unsafe signed evidence %s without record/audit changes',
    async (kind) => {
      const g = await seedSubmissionProfile(pool),
        file = await report(
          g,
          ['pending', 'rejected'].includes(kind) ? kind : 'passed',
          kind === 'wrong_type' ? { detectedMediaType: 'application/octet-stream' } : {},
        );
      const before = await counts();
      await expect(surveys.create(expert, g.profile, body(file.file), randomUUID())).rejects.toMatchObject({
        code: 'site_survey_report_unavailable',
      });
      expect(await counts()).toEqual(before);
    },
  );
  it('preserves the database 25MB limit and accepts the exact safe report boundary', async () => {
    const g = await seedSubmissionProfile(pool);
    const before = await counts();
    await expect(report(g, 'passed', { byteSize: MAX_FILE_BYTES + 1 })).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'file_version_byte_size_ck' },
    });
    expect(await counts()).toEqual(before);
    const file = await report(g, 'passed', { byteSize: MAX_FILE_BYTES });
    const created = await surveys.create(expert, g.profile, body(file.file), randomUUID());
    expect(created.report?.byteSize).toBe(MAX_FILE_BYTES);
  });
  it('keeps source/recorder/recording time and requires exact microsecond CAS for concurrent SMEs', async () => {
    const g = await seedSubmissionProfile(pool),
      file = await report(g),
      created = await surveys.create(expert, g.profile, body(file.file), randomUUID());
    const outcomes = await Promise.allSettled([
      surveys.update(expert, g.profile, created.id, {
        ...edit(created),
        comment: 'One',
      }),
      surveys.update(other, g.profile, created.id, {
        ...edit(created),
        comment: 'Two',
      }),
    ]);
    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect((outcomes.find((row) => row.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({
      code: 'conflict',
    });
    const current = await surveys.read(director, g.profile, created.id);
    expect(current).toMatchObject({
      source: created.source,
      recordedBy: created.recordedBy,
      recordedAt: created.recordedAt,
      reportFileVersionId: created.reportFileVersionId,
    });
    expect(current.updatedAt).not.toBe(created.updatedAt);
    expect(current.updatedAt).toMatch(/\.\d{6}Z$/);
    const stale = current.updatedAt.replace(
      /\.(\d{6})Z$/,
      (_, digits: string) => '.' + ((Number(digits) + 1) % 1000000).toString().padStart(6, '0') + 'Z',
    );
    await expect(
      surveys.update(expert, g.profile, created.id, {
        ...edit(current),
        expectedUpdatedAt: stale,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await surveys.history(director, g.profile, created.id, { limit: 1 })).nextCursor).not.toBeNull();
  });
  it.each(['inactive', 'blocked'])('checks stale persisted actor %s and audits refusal', async (state) => {
    const g = await seedSubmissionProfile(pool);
    await db
      .update(schema.userAccounts)
      .set({ state: state as 'inactive' | 'blocked' })
      .where(eq(schema.userAccounts.id, expert.id));
    try {
      await expect(surveys.list(expert, g.profile, {})).rejects.toMatchObject({ code: 'forbidden' });
    } finally {
      await db.update(schema.userAccounts).set({ state: 'active' }).where(eq(schema.userAccounts.id, expert.id));
    }
    expect(
      (
        await pool.query(
          "select count(*)::int as n from audit_entries where user_id=$1 and action='imbc_records.read' and outcome='denied'",
          [expert.id],
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
  });
  it('retains an inactive original recorder while another currently authorized SME edits', async () => {
    const g = await seedSubmissionProfile(pool),
      file = await report(g),
      created = await surveys.create(expert, g.profile, body(file.file), randomUUID());
    await db.update(schema.userAccounts).set({ state: 'inactive' }).where(eq(schema.userAccounts.id, expert.id));
    try {
      expect(
        await surveys.update(other, g.profile, created.id, {
          ...edit(created),
          result: 'no',
        }),
      ).toMatchObject({
        recordedBy: expert.id,
        source: 'expert',
        result: 'no',
      });
    } finally {
      await db.update(schema.userAccounts).set({ state: 'active' }).where(eq(schema.userAccounts.id, expert.id));
    }
  });
  it('refuses stale role and release-policy claims inside the transaction', async () => {
    const g = await seedSubmissionProfile(pool);
    await db.update(schema.userAccounts).set({ role: 'administrator' }).where(eq(schema.userAccounts.id, expert.id));
    try {
      await expect(surveys.list(expert, g.profile, {})).rejects.toMatchObject({ code: 'forbidden' });
    } finally {
      await db.update(schema.userAccounts).set({ role: 'expert' }).where(eq(schema.userAccounts.id, expert.id));
    }
    await pool.query("update policy_rule set effect='deny' where role='expert' and action='imbc_records.read'");
    try {
      await expect(surveys.list(expert, g.profile, {})).rejects.toMatchObject({ code: 'forbidden' });
    } finally {
      await pool.query("update policy_rule set effect='allow' where role='expert' and action='imbc_records.read'");
    }
    expect(
      (
        await pool.query(
          "select count(*)::int as n from audit_entries where user_id=$1 and action='imbc_records.read' and outcome='denied'",
          [expert.id],
        )
      ).rows[0].n,
    ).toBeGreaterThanOrEqual(2);
  });
  it('refuses a foreign report and a same-organization manufacturer document as survey evidence', async () => {
    const g = await seedSubmissionProfile(pool),
      foreign = await seedSubmissionProfile(pool),
      otherFile = await report(foreign);
    const before = await counts();
    await expect(surveys.create(expert, g.profile, body(otherFile.file), randomUUID())).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      surveys.create(expert, g.profile, body(String(g.rows.document!.file_object_id)), randomUUID()),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await counts()).toEqual(before);
  });
  it.each(['audit', 'sealed', 'record_written', 'projection'] as SurveyMutationPhase[])(
    'rolls back the whole change at failed %s phase',
    async (phase) => {
      const g = await seedSubmissionProfile(pool),
        file = await report(g),
        before = await counts();
      await expect(
        surveys.create(expert, g.profile, body(file.file), randomUUID(), null, async (at) => {
          if (at === phase) throw new Error('Synthetic rollback');
        }),
      ).rejects.toThrow('Synthetic rollback');
      expect(await counts()).toEqual(before);
    },
  );
  it('refuses direct unaudited writes, stale operation reuse and app-role deletion', async () => {
    const g = await seedSubmissionProfile(pool),
      file = await report(g),
      created = await surveys.create(expert, g.profile, body(file.file), randomUUID());
    await expect(
      appPool.query('update site_survey_record set comment=$1 where id=$2', ['Unaudited', created.id]),
    ).rejects.toMatchObject({ code: '23514' });
    const op = (await pool.query('select id from site_survey_operation where survey_record_id=$1', [created.id]))
      .rows[0].id;
    await expect(
      drizzle(appPool, { schema, casing: 'snake_case' }).transaction(async (tx) => {
        await tx.execute(sql`select set_config('imbc.site_survey_operation_id',${op},true)`);
        await tx.execute(sql`update site_survey_record set comment='Old seal' where id=${created.id}`);
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23514' }),
    });
    await expect(appPool.query('delete from site_survey_record where id=$1', [created.id])).rejects.toMatchObject({
      code: '42501',
    });
  });
  it('creates idempotent product-free own Verified requests, allows a deliberate new one, and sends no email/survey', async () => {
    const g = await seedSubmissionProfile(pool);
    await expect(requests.request(g.actor, g.profile, {}, randomUUID())).rejects.toMatchObject({
      code: 'site_survey_request_requires_verified',
    });
    await verified(g);
    const before = await counts(),
      key = randomUUID();
    const first = await requests.request(g.actor, g.profile, {}, key);
    expect(await requests.request(g.actor, g.profile, {}, key)).toEqual(first);
    const next = await requests.request(g.actor, g.profile, {}, randomUUID());
    expect(next.id).not.toBe(first.id);
    const after = await counts();
    expect(after.records).toBe(before.records);
    expect(after.jobs).toBe(before.jobs);
    expect(after.requests).toBe(before.requests + 2);
    expect(after.audit).toBe(before.audit + 2);
    expect((await requests.ownList(g.actor, g.profile, {})).items).toHaveLength(2);
    expect((await requests.queue(expert, { profileId: g.profile })).items).toHaveLength(2);
    await expect(requests.queue(director, {})).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(() => requests.request(g.actor, g.profile, { productId: randomUUID() }, randomUUID())).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });
});
