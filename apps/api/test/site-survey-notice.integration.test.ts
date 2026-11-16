import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { type AccountState, type Locale, type Role, type SiteSurveyRecordView } from '@imbc/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import nodemailer, { type Transporter } from 'nodemailer';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import { MailService } from '../src/mail/mail.service.js';
import { DiligenceService } from '../src/modules/due-diligence/diligence.service.js';
import { SiteSurveyNoticeWorker } from '../src/modules/site-survey/site-survey-notice.worker.js';
import { SiteSurveyPublicationService } from '../src/modules/site-survey/site-survey-publication.service.js';
import { SiteSurveyRequestsService } from '../src/modules/site-survey/site-survey-requests.service.js';
import { SiteSurveyService } from '../src/modules/site-survey/site-survey.service.js';
import type { NotifyJob } from '../src/notifications/enqueue.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedSubmissionProfile } from './support/profile-submit.js';
import { createVerifiedFixtureWorkflow } from './support/verified-fixture.js';
import { startSurveySmtpRelay } from './support/survey-smtp-relay.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const smtpUrl = process.env.SURVEY_NOTICE_TEST_SMTP_URL;
const mailpitUrl = process.env.SURVEY_NOTICE_TEST_MAILPIT_URL;
type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
type Notice = {
  id: string;
  generation: string;
  state: string;
  dispatch_id: string | null;
  notification_job_id: string | null;
  survey_record_id: string;
  resolved_at: Date | null;
  last_outcome: string | null;
};
type Message = {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
  Attachments: unknown[];
  Headers?: Record<string, string[]>;
};

/** Real restricted PG + pg-boss + loopback SMTP/Mailpit. Signed-file metadata is a fixture, not scanner/upload proof. */
describe.skipIf(!databaseUrl || !smtpUrl || !mailpitUrl)('Survey NOT-11 actual durable delivery and recovery', () => {
  vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });
  const role = `survey_notice_${randomUUID().replaceAll('-', '')}`;
  const applicationName = `survey-notice-${randomUUID()}`;
  let pool: pg.Pool, appPool: pg.Pool, db: Database, boss: PgBoss;
  let workflow: Awaited<ReturnType<typeof createVerifiedFixtureWorkflow>>;
  let relay: Awaited<ReturnType<typeof startSurveySmtpRelay>>;
  let mailer: Transporter, mail: MailService, worker: SiteSurveyNoticeWorker, survey: SiteSurveyService;
  let imbcId: string;
  const env = { PUBLIC_URL: 'https://imbc.local', MAIL_FROM: 'IMBC <notice@imbc.local>' } as Env;

  async function mailpit(path: string, method = 'GET') {
    const response = await fetch(`${mailpitUrl}${path}`, { method, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Dedicated Mailpit returned ${response.status}`);
    return method === 'DELETE' ? null : response.json();
  }
  async function messages(): Promise<Message[]> {
    const list = (await mailpit('/api/v1/messages')) as { messages: { ID: string }[] };
    return Promise.all(list.messages.map((message) => mailpit(`/api/v1/message/${message.ID}`) as Promise<Message>));
  }
  const recipientsOf = (items: Message[]) =>
    items.flatMap((message) => message.To.map((to) => to.Address.trim().toLowerCase())).sort();
  const scope = (g: Fixture) => ({ profileId: g.profile, organizationId: g.org });
  const notice = async (g: Fixture, generation?: string): Promise<Notice> =>
    (
      await pool.query<Notice>(
        `select id,generation::text,state,dispatch_id,notification_job_id,survey_record_id,resolved_at,last_outcome
     from site_survey_notice_outbox where profile_id=$1 and ($2::text is null or generation::text=$2) order by generation desc`,
        [g.profile, generation ?? null],
      )
    ).rows[0]!;
  const notices = async (g: Fixture) =>
    (
      await pool.query(
        'select generation::text,state from site_survey_notice_outbox where profile_id=$1 order by generation',
        [g.profile],
      )
    ).rows;
  const journal = async (g: Fixture) =>
    (
      await pool.query<{ recipient_email: string; language: Locale; dedup_key: string }>(
        "select recipient_email,language,dedup_key from notification where rule_code='NOT-11' and related_object_id in (select id from site_survey_notice_outbox where profile_id=$1) order by recipient_email",
        [g.profile],
      )
    ).rows;
  // Transport/recovery timing fixture only; never mutate canonical record/audit/file pins or verification pointers.
  const age = async (g: Fixture) => {
    await pool.query(
      "update site_survey_notice_outbox set last_attempt_at=clock_timestamp()-interval '31 seconds' where profile_id=$1 and state in ('pending','queued')",
      [g.profile],
    );
  };
  const day = async (offset = 0) =>
    (
      await pool.query<{ day: string }>(
        "select ((clock_timestamp() at time zone 'Asia/Almaty')::date+$1::integer)::text as day",
        [offset],
      )
    ).rows[0]!.day;
  async function queue(g: Fixture) {
    await age(g);
    await worker.refreshPending(1000);
    const event = await notice(g);
    expect(event.state).toBe('queued');
    const job = await boss.getJobById<NotifyJob>(QUEUES.notify, event.notification_job_id!);
    expect(job).not.toBeNull();
    return { event, job: job!, data: job!.data };
  }
  async function fixture(visible = true) {
    const g = await seedSubmissionProfile(pool);
    await workflow.verify(g);
    if (visible) await workflow.green(g);
    return g;
  }
  async function account(role: Role, state: AccountState = 'active', locale?: Locale, organizationId?: string) {
    const orgId =
      organizationId ??
      (['operator', 'observer', 'manufacturer'].includes(role)
        ? (
            await db
              .insert(s.organizations)
              .values({
                type: role as 'operator' | 'observer' | 'manufacturer',
                name: `Notice ${role} ${randomUUID()}`,
              })
              .returning()
          )[0]!.id
        : imbcId);
    return (
      await db
        .insert(s.userAccounts)
        .values({
          organizationId: orgId,
          role,
          state,
          email: `${randomUUID()}@notice.local`,
          ...(locale ? { locale } : {}),
        })
        .returning()
    )[0]!;
  }
  async function diligence(g: Fixture, result: 'green' | 'amber' | 'red') {
    const service = new DiligenceService(appPool, new AuditService(db));
    const current = await service.read({ actor: workflow.expert }, g.profile);
    await service.override({ actor: workflow.expert }, g.profile, {
      result,
      comment: null,
      reportFileId: null,
      expectedUpdatedAt: current.record?.updatedAt ?? null,
    });
  }
  const body = (fileId: string, extra: Record<string, unknown> = {}) => ({
    visitStartedOn: '2020-01-01',
    visitEndedOn: null,
    result: 'yes',
    reportFileId: fileId,
    expiresOn: null,
    comment: 'Private Class C comment must never enter email',
    ...extra,
  });
  const edit = (row: SiteSurveyRecordView, extra: Record<string, unknown> = {}) => ({
    visitStartedOn: row.visitStartedOn,
    visitEndedOn: row.visitEndedOn,
    result: row.result,
    reportFileId: row.reportFileId,
    expiresOn: row.expiresOn,
    comment: row.comment,
    expectedUpdatedAt: row.updatedAt,
    ...extra,
  });
  async function report(g: Fixture, scanState: 'passed' | 'pending' = 'passed') {
    const [file] = await db
      .insert(s.fileObject)
      .values({ organizationId: g.org, purpose: 'site_survey_report', dataClass: 'c_imbc' })
      .returning();
    const [version] = await db
      .insert(s.fileVersion)
      .values({
        fileObjectId: file!.id,
        versionNumber: 1,
        originalName: 'signed.pdf',
        declaredMediaType: 'application/pdf',
        detectedMediaType: 'application/pdf',
        byteSize: 1,
        checksum: 'metadata-fixture',
        storageKey: randomUUID(),
        uploadedBy: workflow.expert.id,
        scanState,
      })
      .returning();
    return { id: file!.id, versionId: version!.id };
  }
  async function until(check: () => Promise<boolean>, label: string, timeout = 1500) {
    const started = Date.now();
    while (!(await check())) {
      if (Date.now() - started >= timeout) throw new Error(`Timed out: ${label}`);
      await delay(10);
    }
  }

  beforeAll(async () => {
    const dbUrl = new URL(databaseUrl!);
    if (dbUrl.hostname !== '127.0.0.1' || dbUrl.port !== '55434' || dbUrl.pathname !== '/imbc_auth_test')
      throw new Error('Survey notice tests require reserved loopback55434/imbc_auth_test');
    if (mailpitUrl !== 'http://127.0.0.1:18035') throw new Error('Use the dedicated Mailpit inbox on loopback18035');
    pool = openTestPool();
    await pool.query(`create role "${role}" nologin`);
    appPool = new pg.Pool({
      connectionString: databaseUrl,
      options: `-c role=${role}`,
      max: 12,
      application_name: applicationName,
    });
    db = drizzle(appPool, { schema: s, casing: 'snake_case' });
    relay = await startSurveySmtpRelay(smtpUrl!);
    mailer = nodemailer.createTransport({
      host: '127.0.0.1',
      port: Number(new URL(relay.url).port),
      secure: false,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    await migrateThrough(pool);
    await applyAppRoleGrants(pool, role);
    workflow = await createVerifiedFixtureWorkflow(appPool);
    boss = workflow.boss;
    imbcId = workflow.expert.organizationId;
    await boss.updateQueue(QUEUES.notify, { retryLimit: 0, retryDelay: 0, retryBackoff: false });
    await pool.query(
      `grant usage on schema pgboss_auth_test to "${role}";grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`,
    );
    mail = new MailService(mailer, env, db);
    worker = new SiteSurveyNoticeWorker(appPool, db, boss, mail, env);
    survey = new SiteSurveyService(appPool, new AuditService(db), new SiteSurveyPublicationService());
    relay.faults.reject.clear();
    relay.faults.rejected = 0;
    relay.faults.beforeRecipient = null;
    await mailpit('/api/v1/messages', 'DELETE');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    relay.faults.beforeRecipient = null;
    await workflow?.close();
  });
  afterAll(async () => {
    mailer?.close();
    await relay?.close();
    await appPool?.end();
    if (pool) {
      await pool.query(`drop owned by "${role}";drop role "${role}"`);
      await pool.end();
    }
  });

  it('sends real localized Mailpit messages to active/inactive/invited operators, excludes blocked/all other roles and completes once', async () => {
    const allowed = [
      await account('operator', 'active', 'en'),
      await account('operator', 'inactive', 'ru'),
      await account('operator', 'invited'),
    ];
    await account('operator', 'blocked');
    for (const role of ['observer', 'manufacturer', 'expert', 'director', 'administrator'] as const)
      await account(role);
    // Persisted role/org mismatch also cannot broaden the recipient boundary.
    await account('director', 'active', 'kk', allowed[0]!.organizationId);
    const g = await fixture();
    await workflow.addSurvey(g);
    const queued = await queue(g);
    // Execute and acknowledge an actual pg-boss fetched job, not a fabricated job DTO.
    const fetched = await boss.fetch<NotifyJob>(QUEUES.notify, { batchSize: 50 });
    const job = fetched.find((item) => item.id === queued.job.id)!;
    expect(job).toBeDefined();
    expect(await worker.runJob(job.data)).toMatchObject({ sent: 3, duplicates: 0, state: 'completed' });
    await boss.complete(QUEUES.notify, job.id);
    expect((await boss.getJobById(QUEUES.notify, job.id))?.state).toBe('completed');
    const delivered = await messages();
    expect(recipientsOf(delivered)).toEqual(allowed.map((item) => item.email.toLowerCase()).sort());
    expect(delivered).toHaveLength(3);
    for (const item of delivered) {
      expect(item.Text).toContain(`https://imbc.local/companies/${g.profile}`);
      expect(item.Attachments ?? []).toEqual([]);
      expect(`${item.Text}${item.HTML}`).not.toMatch(/Private Class C|recordedBy|reportFileVersion|due_diligence/);
    }
    expect(new Set(delivered.map((item) => item.Subject)).size).toBe(3);
    expect((await journal(g)).map((row) => row.language).sort()).toEqual(['en', 'kk', 'ru']);
    expect((await notice(g)).resolved_at).not.toBeNull();
    expect(await worker.runJob(job.data)).toMatchObject({ sent: 0, state: 'stale' });
    await worker.refreshPending();
    expect(await messages()).toHaveLength(3);
  });

  it('retains a hidden Draft generation and sends it once only after actual verification/DD visibility', async () => {
    await account('operator');
    const g = await seedSubmissionProfile(pool);
    const row = await workflow.addSurvey(g);
    expect(await worker.refreshPending()).toMatchObject({ queued: 0, deferred: 1 });
    expect(await notice(g)).toMatchObject({ generation: '1', state: 'pending', survey_record_id: row.id });
    expect(await messages()).toEqual([]);
    await workflow.verify(g);
    await workflow.green(g);
    const { data } = await queue(g);
    expect(await worker.runJob(data)).toMatchObject({ sent: 1, state: 'completed' });
    expect(await notices(g)).toEqual([{ generation: '1', state: 'completed' }]);
  });

  it.each([
    { result: 'no', offset: null },
    { result: 'yes', offset: 0 },
    { result: 'yes', offset: -1 },
  ])('does not email for result$result with expiry offset$offset', async ({ result, offset }) => {
    await account('operator');
    const g = await fixture();
    const file = await report(g);
    await survey.create(
      workflow.expert,
      g.profile,
      body(file.id, { result, expiresOn: offset === null ? null : await day(offset) }),
      randomUUID(),
    );
    expect(await worker.refreshPending()).toMatchObject({ queued: 0 });
    expect(await notices(g)).toEqual([]);
    expect(await journal(g)).toEqual([]);
    expect(await messages()).toEqual([]);
  });

  it('pending signed-file candidate cannot create a notice; a newer pending upload cannot invalidate an older captured PASSED pin', async () => {
    await account('operator');
    const g = await fixture();
    const pending = await report(g, 'pending');
    await expect(survey.create(workflow.expert, g.profile, body(pending.id), randomUUID())).rejects.toMatchObject({
      code: 'site_survey_report_unavailable',
    });
    expect(await notices(g)).toEqual([]);
    const passed = await report(g);
    const row = await survey.create(workflow.expert, g.profile, body(passed.id), randomUUID());
    await db.insert(s.fileVersion).values({
      fileObjectId: passed.id,
      versionNumber: 2,
      originalName: 'new-pending.pdf',
      declaredMediaType: 'application/pdf',
      detectedMediaType: 'application/pdf',
      byteSize: 1,
      checksum: 'new-fixture',
      storageKey: randomUUID(),
      uploadedBy: workflow.expert.id,
      scanState: 'pending',
    });
    expect((await survey.read(workflow.expert, g.profile, row.id)).reportFileVersionId).toBe(passed.versionId);
    const { data } = await queue(g);
    expect(await worker.runJob(data)).toMatchObject({ sent: 1 });
  });

  it('another survey and DD hide/show do not remail an already completed continuous generation', async () => {
    await account('operator');
    const g = await fixture();
    const first = await workflow.addSurvey(g);
    const { data } = await queue(g);
    await worker.runJob(data);
    await survey.create(
      workflow.expert,
      g.profile,
      body(first.reportFileId!, { visitStartedOn: '2021-01-01' }),
      randomUUID(),
    );
    await diligence(g, 'red');
    await diligence(g, 'amber');
    await worker.refreshPending();
    expect(await notices(g)).toEqual([{ generation: '1', state: 'completed' }]);
    expect(await messages()).toHaveLength(1);
  });

  it('ends silently and sends a new generation when the same record becomes surveyed again', async () => {
    await account('operator');
    const g = await fixture();
    let row = await workflow.addSurvey(g);
    const first = await queue(g);
    await worker.runJob(first.data);
    row = await survey.update(workflow.expert, g.profile, row.id, edit(row, { result: 'no' }));
    await worker.refreshPending();
    expect(await messages()).toHaveLength(1);
    await survey.update(workflow.expert, g.profile, row.id, edit(row, { result: 'yes' }));
    const second = await queue(g);
    expect(second.event.generation).toBe('2');
    expect(await worker.runJob(first.data)).toMatchObject({ state: 'stale', sent: 0 });
    await worker.runJob(second.data);
    expect(await messages()).toHaveLength(2);
    expect(await journal(g)).toHaveLength(2);
  });

  it('suppresses an undelivered queued old generation before its first SMTP, then mails only the new Survey cycle', async () => {
    await account('operator');
    const g = await fixture();
    let row = await workflow.addSurvey(g);
    const old = await queue(g);
    row = await survey.update(workflow.expert, g.profile, row.id, edit(row, { result: 'no' }));
    await survey.update(workflow.expert, g.profile, row.id, edit(row, { result: 'yes' }));
    expect(await worker.runJob(old.data)).toMatchObject({ sent: 0, state: 'obsolete' });
    expect(await notices(g)).toEqual([
      { generation: '1', state: 'obsolete' },
      { generation: '2', state: 'pending' },
    ]);
    expect(await messages()).toEqual([]);
    expect(await journal(g)).toEqual([]);
    const current = await queue(g);
    expect(current.event.generation).toBe('2');
    expect(await worker.runJob(current.data)).toMatchObject({ sent: 1, state: 'completed' });
    expect(await messages()).toHaveLength(1);
    expect(await journal(g)).toHaveLength(1);
  });

  it('a hidden generation that ends before first visibility is never backfilled after verification and green DD', async () => {
    await account('operator');
    const g = await seedSubmissionProfile(pool);
    const row = await workflow.addSurvey(g);
    expect(await worker.refreshPending()).toMatchObject({ queued: 0, deferred: 1 });
    await survey.update(workflow.expert, g.profile, row.id, edit(row, { result: 'no' }));
    await workflow.verify(g);
    await workflow.green(g);
    await age(g);
    expect(await worker.refreshPending()).toMatchObject({ queued: 0, obsolete: 1 });
    expect(await notices(g)).toEqual([{ generation: '1', state: 'obsolete' }]);
    expect((await db.select().from(s.catalogVisible).where(eq(s.catalogVisible.profileId, g.profile)))[0]!.tier).toBe(
      'tier_1',
    );
    expect(await messages()).toEqual([]);
    expect(await journal(g)).toEqual([]);
  });

  it('hidden DD generation is queued after green, not while red', async () => {
    await account('operator');
    const g = await fixture(false);
    await diligence(g, 'red');
    await workflow.addSurvey(g);
    expect(await worker.refreshPending()).toMatchObject({ deferred: 1, queued: 0 });
    expect(await messages()).toEqual([]);
    await diligence(g, 'green');
    const { data } = await queue(g);
    await worker.runJob(data);
    expect(await notices(g)).toEqual([{ generation: '1', state: 'completed' }]);
    expect(await messages()).toHaveLength(1);
  });

  it('visibility lost after enqueue defers without consuming G; later show issues a new dispatch token and refuses stale transport', async () => {
    await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const before = await queue(g);
    await diligence(g, 'red');
    expect(await worker.runJob(before.data)).toMatchObject({ state: 'pending', sent: 0 });
    expect(await notice(g)).toMatchObject({ generation: '1', state: 'pending', dispatch_id: null });
    await diligence(g, 'green');
    const after = await queue(g);
    expect(after.event.dispatch_id).not.toBe(before.event.dispatch_id);
    expect(await worker.runJob(before.data)).toMatchObject({ state: 'stale', sent: 0 });
    await worker.runJob(after.data);
    expect(await messages()).toHaveLength(1);
  });

  it('ANY older perpetual report qualifies a hidden generation even after the original trigger expires', async () => {
    await account('operator');
    const g = await fixture(false);
    const file = await report(g);
    const trigger = await survey.create(
      workflow.expert,
      g.profile,
      body(file.id, { visitStartedOn: '2022-01-01', expiresOn: await day(1) }),
      randomUUID(),
    );
    const older = await survey.create(
      workflow.expert,
      g.profile,
      body(file.id, { visitStartedOn: '2020-01-01' }),
      randomUUID(),
    );
    await survey.update(workflow.expert, g.profile, trigger.id, edit(trigger, { expiresOn: await day() }));
    await workflow.green(g);
    const { event, data } = await queue(g);
    expect(event).toMatchObject({ generation: '1', survey_record_id: trigger.id });
    expect((await survey.list(workflow.expert, g.profile, {})).summary.currentSurveyId).toBe(older.id);
    expect(await worker.runJob(data)).toMatchObject({ state: 'completed', sent: 1 });
  });

  it('expiry catch-up repairs a stale persisted/projection boundary without sending an expiry email or inventing a generation', async () => {
    await account('operator');
    const g = await fixture();
    const file = await report(g);
    const expired = await day();
    await survey.create(workflow.expert, g.profile, body(file.id, { expiresOn: expired }), randomUUID());
    // Exact late-worker snapshot: canonical expired record/audit/pins stay unchanged, only derived stale state is seeded.
    await pool.query(
      'update site_survey_publication_state set site_surveyed=true,generation=1,effective_until=$2,next_refresh_on=$2 where profile_id=$1',
      [g.profile, expired],
    );
    await pool.query('update catalog_visible set site_surveyed=true where profile_id=$1', [g.profile]);
    expect(await worker.refreshPending()).toMatchObject({ checked: 1, queued: 0 });
    const state = (
      await pool.query(
        'select site_surveyed,generation::text,next_refresh_on from site_survey_publication_state where profile_id=$1',
        [g.profile],
      )
    ).rows[0];
    expect(state).toMatchObject({ site_surveyed: false, generation: '1', next_refresh_on: null });
    expect((await db.select().from(s.catalogVisible).where(eq(s.catalogVisible.profileId, g.profile)))[0]!.tier).toBe(
      'tier_1',
    );
    expect(await messages()).toEqual([]);
    expect(await notices(g)).toEqual([]);
  });

  it('earliest selected-report expiry catch-up falls back to older perpetual evidence without ending G or remailing it', async () => {
    await account('operator');
    const g = await fixture();
    const file = await report(g);
    const older = await survey.create(workflow.expert, g.profile, body(file.id), randomUUID());
    const recent = await survey.create(
      workflow.expert,
      g.profile,
      body(file.id, { visitStartedOn: '2022-01-01', expiresOn: await day() }),
      randomUUID(),
    );
    const { data } = await queue(g);
    await worker.runJob(data);
    const [before] = await db.select().from(s.catalogVisible).where(eq(s.catalogVisible.profileId, g.profile));
    // Prior-day derived snapshot only: the audited expired recent record and perpetual old PASSED pin remain untouched.
    await pool.query(
      'update site_survey_publication_state set effective_until=null,next_refresh_on=$2 where profile_id=$1',
      [g.profile, await day()],
    );
    await db
      .update(s.catalogVisible)
      .set({
        card: {
          ...(before!.card as Record<string, unknown>),
          siteSurveySummary: { siteSurveyed: true, siteSurveyedOn: recent.visitStartedOn, currentSurveyId: recent.id },
        },
      })
      .where(eq(s.catalogVisible.profileId, g.profile));
    expect(await worker.refreshPending()).toMatchObject({ checked: 1, queued: 0 });
    const state = (
      await pool.query(
        'select site_surveyed,generation::text,effective_until,next_refresh_on from site_survey_publication_state where profile_id=$1',
        [g.profile],
      )
    ).rows[0];
    expect(state).toEqual({ site_surveyed: true, generation: '1', effective_until: null, next_refresh_on: null });
    const [after] = await db.select().from(s.catalogVisible).where(eq(s.catalogVisible.profileId, g.profile));
    expect((after!.card as { siteSurveySummary: { currentSurveyId: string } }).siteSurveySummary.currentSurveyId).toBe(
      older.id,
    );
    expect(await notices(g)).toEqual([{ generation: '1', state: 'completed' }]);
    expect(await messages()).toHaveLength(1);
    expect(await journal(g)).toHaveLength(1);
  });

  it('preserves committed A/C journals after real SMTP451 for B and retries only B', async () => {
    const operators = [await account('operator'), await account('operator'), await account('operator')];
    const second = operators[1]!;
    relay.faults.reject.add(second.email.toLowerCase());
    const g = await fixture();
    await workflow.addSurvey(g);
    const { data } = await queue(g);
    await expect(worker.runJob(data)).rejects.toThrow(/failed for 1 recipients/);
    expect(relay.faults.rejected).toBe(1);
    expect(recipientsOf(await messages())).toEqual([operators[0]!.email, operators[2]!.email].sort());
    expect(await journal(g)).toHaveLength(2);
    expect((await notice(g)).state).toBe('queued');
    relay.faults.reject.clear();
    expect(await worker.runJob(data)).toMatchObject({ sent: 1, duplicates: 2, state: 'completed' });
    expect(recipientsOf(await messages())).toEqual(operators.map((item) => item.email).sort());
    expect(await journal(g)).toHaveLength(3);
  });

  it('DD hide between individually committed recipients pauses remaining delivery and resumes it without remailing A', async () => {
    const operators = [await account('operator'), await account('operator'), await account('operator')];
    const g = await fixture();
    await workflow.addSurvey(g);
    const first = await queue(g);
    const original = mail.sendOnceGuarded.bind(mail);
    let hidden = false;
    vi.spyOn(mail, 'sendOnceGuarded').mockImplementation(async (...args) => {
      const outcome = await original(...args);
      if (!hidden && outcome === 'sent') {
        hidden = true;
        await diligence(g, 'red');
      }
      return outcome;
    });
    expect(await worker.runJob(first.data)).toMatchObject({ sent: 1, state: 'pending' });
    expect(await journal(g)).toHaveLength(1);
    expect(await messages()).toHaveLength(1);
    vi.restoreAllMocks();
    await diligence(g, 'green');
    const resumed = await queue(g);
    expect(await worker.runJob(resumed.data)).toMatchObject({ sent: 2, duplicates: 1, state: 'completed' });
    expect(recipientsOf(await messages())).toEqual(operators.map((item) => item.email).sort());
  });

  it.each(['missing', 'failed', 'completed'] as const)(
    'recovers a %s pg-boss job with the same G and refuses the old dispatch token',
    async (reason) => {
      await account('operator');
      const g = await fixture();
      await workflow.addSurvey(g);
      const old = await queue(g);
      if (reason === 'missing') await boss.deleteJob(QUEUES.notify, old.job.id);
      else {
        await boss.fetch(QUEUES.notify, { batchSize: 50 });
        if (reason === 'failed') await boss.fail(QUEUES.notify, old.job.id, { failure: 'test_transport' });
        else await boss.complete(QUEUES.notify, old.job.id);
        expect((await boss.getJobById(QUEUES.notify, old.job.id))?.state).toBe(reason);
      }
      await age(g);
      expect(await worker.refreshPending()).toMatchObject({ recovered: 1, queued: 1 });
      const current = await notice(g);
      expect(current.generation).toBe('1');
      expect(current.dispatch_id).not.toBe(old.event.dispatch_id);
      expect(await worker.runJob(old.data)).toMatchObject({ state: 'stale', sent: 0 });
      const replacement = await boss.getJobById<NotifyJob>(QUEUES.notify, current.notification_job_id!);
      expect(await worker.runJob(replacement!.data)).toMatchObject({ state: 'completed', sent: 1 });
      expect(await messages()).toHaveLength(1);
    },
  );

  it('does not steal a live queue job when its source is due for recovery', async () => {
    await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const old = await queue(g);
    await age(g);
    expect(await worker.refreshPending()).toMatchObject({ recovered: 0, queued: 0 });
    expect((await notice(g)).dispatch_id).toBe(old.event.dispatch_id);
    expect(await messages()).toEqual([]);
  });

  it('accepted recipient journals survive failure of final outbox completion, and replay sends zero additional SMTP', async () => {
    await account('operator');
    await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const { data } = await queue(g);
    const resolvable = worker as unknown as { resolve: (...args: unknown[]) => Promise<void> };
    const original = resolvable.resolve.bind(worker);
    let fail = true;
    vi.spyOn(resolvable, 'resolve').mockImplementation(async (...args) => {
      if (fail && args[1] === 'completed') {
        fail = false;
        throw new Error('Synthetic aggregate completion failure');
      }
      await original(...args);
    });
    await expect(worker.runJob(data)).rejects.toThrow('Synthetic aggregate completion failure');
    expect(await journal(g)).toHaveLength(2);
    expect(await messages()).toHaveLength(2);
    expect((await notice(g)).state).toBe('queued');
    vi.restoreAllMocks();
    expect(await worker.runJob(data)).toMatchObject({ sent: 0, duplicates: 2, state: 'completed' });
    expect(await messages()).toHaveLength(2);
  });

  it('two overlapping workers serialize against an actual SMTP-held recipient transaction and never duplicate accepted mail', async () => {
    const operator = await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const { data } = await queue(g);
    let entered = false,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    relay.faults.beforeRecipient = async (email) => {
      if (email === operator.email && !entered) {
        entered = true;
        await gate;
      }
    };
    let firstError: unknown;
    const first = worker.runJob(data).catch((error) => {
      firstError = error;
      return null;
    });
    await until(async () => entered || firstError !== undefined, 'first worker SMTP RCPT');
    if (firstError) throw firstError;
    const secondWorker = new SiteSurveyNoticeWorker(appPool, db, boss, new MailService(mailer, env, db), env);
    const second = secondWorker.runJob(data).catch((error) => ({ error }));
    try {
      await until(
        async () =>
          (
            await pool.query<{ waiting: boolean }>(
              "select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock') as waiting",
              [applicationName],
            )
          ).rows[0]!.waiting,
        'second worker waiting on recipient transaction',
      );
    } finally {
      release();
    }
    const results = await Promise.all([first, second]);
    expect(results.every((result) => result !== null && !('error' in result) && !('refused' in result))).toBe(true);
    expect(await journal(g)).toHaveLength(1);
    expect(await messages()).toHaveLength(1);
    expect((await notice(g)).state).toBe('completed');
  });

  it('blocks recipient changed after enqueue and does not convert inactive/invited to an active-only audience', async () => {
    const blocked = await account('operator');
    const inactive = await account('operator', 'inactive');
    const g = await fixture();
    await workflow.addSurvey(g);
    const { data } = await queue(g);
    await db.update(s.userAccounts).set({ state: 'blocked' }).where(eq(s.userAccounts.id, blocked.id));
    expect(await worker.runJob(data)).toMatchObject({ sent: 1, state: 'completed' });
    expect(recipientsOf(await messages())).toEqual([inactive.email]);
  });

  it('an operator moved between two operator organizations after audience lookup remains an eligible recipient', async () => {
    const operator = await account('operator');
    const destination = (
      await db
        .insert(s.organizations)
        .values({ type: 'operator', name: `Destination ${randomUUID()}` })
        .returning()
    )[0]!;
    const g = await fixture();
    await workflow.addSurvey(g);
    const { data } = await queue(g);
    const original = mail.sendOnceGuarded.bind(mail);
    let moved = false;
    vi.spyOn(mail, 'sendOnceGuarded').mockImplementation(async (...args) => {
      if (!moved) {
        moved = true;
        await db
          .update(s.userAccounts)
          .set({ organizationId: destination.id })
          .where(eq(s.userAccounts.id, operator.id));
      }
      return original(...args);
    });
    expect(await worker.runJob(data)).toMatchObject({ sent: 1, state: 'completed' });
    expect(recipientsOf(await messages())).toEqual([operator.email]);
    expect(await journal(g)).toHaveLength(1);
  });

  it('a newly inserted different-condition policy deny before the final recipient guard prevents SMTP and preserves pending G', async () => {
    await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const { data } = await queue(g);
    const original = mail.sendOnceGuarded.bind(mail);
    let inserted = false;
    vi.spyOn(mail, 'sendOnceGuarded').mockImplementation(async (...args) => {
      if (!inserted) {
        inserted = true;
        await pool.query(
          "insert into policy_rule(role,data_class,action,condition,effect) values('operator','a_register','catalog.search','none','deny')",
        );
      }
      return original(...args);
    });
    expect(await worker.runJob(data)).toMatchObject({ state: 'pending', sent: 0 });
    expect(await notice(g)).toMatchObject({ generation: '1', last_outcome: 'policy_denied' });
    expect(await messages()).toEqual([]);
    expect(await journal(g)).toEqual([]);
    vi.restoreAllMocks();
    await pool.query(
      "delete from policy_rule where role='operator' and data_class='a_register' and action='catalog.search' and condition='none' and effect='deny'",
    );
    const current = await queue(g);
    expect(await worker.runJob(current.data)).toMatchObject({ sent: 1, state: 'completed' });
  });

  it('release INSERT of a new deny condition waits for SMTP-authorized policy table lock without granting runtime writes', async () => {
    const operator = await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const { data } = await queue(g);
    let entered = false,
      release!: () => void,
      firstError: unknown;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    relay.faults.beforeRecipient = async (email) => {
      if (email === operator.email && !entered) {
        entered = true;
        await gate;
      }
    };
    const first = worker.runJob(data).catch((error) => {
      firstError = error;
      return null;
    });
    await until(async () => entered || firstError !== undefined, 'SMTP-held policy authorization');
    if (firstError) throw firstError;
    const insert = pool.query(
      "insert into policy_rule(role,data_class,action,condition,effect) values('operator','a_register','catalog.search','none','deny') returning id",
    );
    const inserted = insert.then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
    try {
      await until(
        async () =>
          (
            await pool.query<{ waiting: boolean }>(
              "select exists(select 1 from pg_stat_activity where datname=current_database() and query like 'insert into policy_rule%' and wait_event_type='Lock') as waiting",
            )
          ).rows[0]!.waiting,
        'release INSERT waiting for complete policy predicate',
      );
      expect(await journal(g)).toEqual([]); // uncommitted sender journal is not a fabricated sent fact.
    } finally {
      release();
    }
    expect(await first).toMatchObject({ sent: 1, state: 'completed' });
    expect(await inserted).toHaveProperty('result');
    expect(await messages()).toHaveLength(1);
    expect(await journal(g)).toHaveLength(1);
    await expect(appPool.query("update policy_rule set effect='allow' where role='operator'")).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      appPool.query(
        "insert into policy_rule(role,data_class,action,condition,effect) values('operator','a_register','catalog.search','owner','deny')",
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('a stale verified projection with missing exact revision proof defers SMTP despite its stored surveyed flag', async () => {
    await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const { data } = await queue(g);
    await pool.query("update catalog_visible set card='{}'::jsonb where profile_id=$1", [g.profile]);
    expect(await worker.runJob(data)).toMatchObject({ state: 'pending', sent: 0 });
    expect(await messages()).toEqual([]);
    const fresh = await queue(g);
    await worker.runJob(fresh.data);
    expect(await messages()).toHaveLength(1);
  });

  it('disabled rule preserves an unfinished generation and re-enable recovers it once', async () => {
    await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const old = await queue(g);
    await pool.query("update notification_rule set enabled=false where code='NOT-11'");
    expect(await worker.runJob(old.data)).toMatchObject({ state: 'pending', sent: 0 });
    expect(await notice(g)).toMatchObject({ state: 'pending', last_outcome: 'rule_disabled' });
    expect(await journal(g)).toEqual([]);
    await pool.query("update notification_rule set enabled=true where code='NOT-11'");
    const current = await queue(g);
    await worker.runJob(current.data);
    expect(await messages()).toHaveLength(1);
  });

  it('queue/status rollback preserves the pending event and a later real enqueue recovers it', async () => {
    await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const send = vi.spyOn(boss, 'send').mockRejectedValueOnce(new Error('Synthetic pg-boss insert failure'));
    expect(await worker.refreshPending()).toMatchObject({ failed: 1, queued: 0 });
    expect(await notice(g)).toMatchObject({
      state: 'pending',
      dispatch_id: null,
      notification_job_id: null,
      generation: '1',
    });
    expect(
      (await boss.findJobs<NotifyJob>(QUEUES.notify, { limit: 100 })).filter((job) => job.data.rule === 'NOT-11'),
    ).toEqual([]);
    send.mockRestore();
    const { data } = await queue(g);
    await worker.runJob(data);
    expect(await messages()).toHaveLength(1);
  });

  it('rejects forged context before mailing any operators and leaves the real event unchanged', async () => {
    await account('operator');
    const g = await fixture();
    await workflow.addSurvey(g);
    const { data, event } = await queue(g);
    for (const forged of [
      { ...data, eventKey: 'unbound' },
      { ...data, profileId: randomUUID() },
      { ...data, organizationId: randomUUID() },
      { ...data, related: { type: 'site_survey_notice', id: randomUUID() } },
      { ...data, params: { ...data.params, dispatchId: randomUUID() } },
      { ...data, params: { ...data.params, generation: '9223372036854775808' } },
      { ...data, params: { ...data.params, address: 'outside@example.com' } },
    ]) {
      const result = await worker.runJob(forged);
      expect('refused' in result || result.state === 'stale').toBe(true);
    }
    expect((await notice(g)).dispatch_id).toBe(event.dispatch_id);
    expect(await journal(g)).toEqual([]);
    expect(await messages()).toEqual([]);
  });

  it('own verified survey request and verification alone create no Survey notification job or email', async () => {
    await account('operator');
    const g = await fixture();
    const requests = new SiteSurveyRequestsService(appPool, new AuditService(db));
    await requests.request(g.actor, g.profile, {}, randomUUID());
    expect(await worker.refreshPending()).toMatchObject({ queued: 0 });
    expect(
      (await pool.query('select count(*)::int as count from site_survey_request where profile_id=$1', [g.profile]))
        .rows[0].count,
    ).toBe(1);
    expect(await notices(g)).toEqual([]);
    expect(await messages()).toEqual([]);
    expect(await journal(g)).toEqual([]);
  });
});
