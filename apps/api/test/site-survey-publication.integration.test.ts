import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type SiteSurveyRecordView } from '@imbc/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { ProfilesService } from '../src/modules/profiles/profiles.service.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { ProfileReviewService, profileReviewEvidence } from '../src/modules/profiles/profile-review.service.js';
import { profileCandidateRevisions, profileSubmissionRevisions } from '../src/modules/profiles/profile-candidate.js';
import { SiteSurveyService } from '../src/modules/site-survey/site-survey.service.js';
import { SiteSurveyPublicationService } from '../src/modules/site-survey/site-survey-publication.service.js';
import { observeSiteSurveyPublication, reconcileSiteSurveyPublication } from '../src/modules/site-survey/survey-publication-state.js';
import { loadSiteSurveyState } from '../src/modules/site-survey/survey-state.js';
import { openTestPool, resetDatabase, migrateThrough } from './support/database.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';

/** Actual production publication port; SMTP/provider and public company/file access have separate gates. */
describe.skipIf(!process.env.TEST_DATABASE_URL)('Survey real durable generations and exact catalogue publication', () => {
  vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
  let pool: pg.Pool, appPool: pg.Pool, db: Database, boss: PgBoss, survey: SiteSurveyService, expert: AuthUser;
  const role = 'survey_publication_' + randomUUID().replaceAll('-', '');
  type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
  const scope = (g: Fixture) => ({ profileId: g.profile, organizationId: g.org });
  const body = (fileId: string, extra = {}) => ({ visitStartedOn: '2020-01-01', visitEndedOn: null,
    result: 'yes', expiresOn: null, comment: null, reportFileId: fileId, ...extra });
  const edit = (row: SiteSurveyRecordView, extra = {}) => ({ visitStartedOn: row.visitStartedOn,
    visitEndedOn: row.visitEndedOn, result: row.result, expiresOn: row.expiresOn, comment: row.comment,
    reportFileId: row.reportFileId, expectedUpdatedAt: row.updatedAt, ...extra });
  const date = async (days: number) => (await pool.query<{ day: string }>(
    "select ((clock_timestamp() at time zone 'Asia/Almaty')::date+$1::integer)::text as day", [days],
  )).rows[0]!.day;
  async function report(g: Fixture) {
    const [f] = await db.insert(s.fileObject).values({ organizationId: g.org, purpose: 'site_survey_report', dataClass: 'c_imbc' }).returning();
    const [v] = await db.insert(s.fileVersion).values({ fileObjectId: f!.id, versionNumber: 1, originalName: 'signed.pdf',
      byteSize: 100, declaredMediaType: 'application/pdf', detectedMediaType: 'application/pdf', checksum: 'synthetic',
      scanState: 'passed', uploadedBy: expert.id, storageKey: randomUUID() }).returning();
    return { file: f!.id, version: v!.id };
  }
  const state = async (g: Fixture) => (await pool.query(
    'select site_surveyed,generation::text as generation,effective_until::text,next_refresh_on::text from site_survey_publication_state where profile_id=$1', [g.profile],
  )).rows[0];
  const notices = async (g: Fixture) => (await pool.query(
    'select generation::text as generation,survey_record_id,state from site_survey_notice_outbox where profile_id=$1 order by generation', [g.profile],
  )).rows;
  async function verified(g: Fixture) {
    const audit = new AuditService(db);
    const submit = new ProfileSubmitService(appPool, audit, boss, submissionHandlers());
    const review = new ProfileReviewService(appPool, audit, boss);
    const candidates = await profileCandidateRevisions(db, scope(g));
    const revisions = await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, g.org));
    const sent = await submit.submit(g.actor, { operationKey: randomUUID(), accuracyConfirmed: true,
      expectedSections: candidates.map(row => ({ kind: row.kind, revisionId: row.revisionId!,
        editVersion: revisions.find(r => r.id === row.revisionId)!.editVersion })) });
    await review.take(expert, sent.assignmentId);
    const profile = (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile)))[0]!;
    const map = await profileSubmissionRevisions(db, { ...scope(g), assignmentId: sent.assignmentId });
    const facts = await profileReviewEvidence(db, { profile, map });
    for (const fact of facts.filter(row => !['file', 'section'].includes(row.subject.kind)))
      await review.decide(expert, sent.assignmentId, { subject: fact.subject, outcome: 'verified', comment: null });
    for (const fact of facts.filter(row => row.subject.kind === 'section'))
      await review.decide(expert, sent.assignmentId, { subject: fact.subject, outcome: 'verified', comment: null });
    await review.submitResult(expert, sent.assignmentId);
  }
  beforeAll(async () => {
    pool = openTestPool(); await resetDatabase(pool); await migrateThrough(pool);
    const rootDb = drizzle(pool, { schema: s, casing: 'snake_case' });
    const imbc = (await rootDb.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
    const [a] = await rootDb.insert(s.userAccounts).values({ organizationId: imbc.id, role: 'expert', state: 'active',
      email: randomUUID() + '@publication.local' }).returning();
    expert = { id: a!.id, organizationId: imbc.id, organizationType: 'imbc', role: 'expert', email: a!.email, locale: 'en', fullName: null };
    boss = new PgBoss({ connectionString: process.env.TEST_DATABASE_URL, schema: 'pgboss_auth_test', supervise: false, schedule: false });
    await boss.start(); await boss.createQueue(QUEUES.notify);
    await pool.query(`create role "${role}" nologin`); await applyAppRoleGrants(pool, role);
    await pool.query(`grant usage on schema pgboss_auth_test to "${role}";grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`);
    appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c role=${role}`, max: 5 });
    db = drizzle(appPool, { schema: s, casing: 'snake_case' });
    survey = new SiteSurveyService(appPool, new AuditService(db), new SiteSurveyPublicationService());
  });
  afterAll(async () => {
    await boss?.stop(); await appPool?.end();
    if (pool) { await pool.query(`drop owned by "${role}";drop role "${role}"`); await pool.end(); }
  });
  it('observes existing evidence without writes before the final mutation', async () => {
    const g = await seedSubmissionProfile(pool);
    await db.transaction(async raw => {
      const tx = raw as unknown as Database;
      await tx.execute(sql`select id from manufacturer_profile where id=${g.profile} for no key update`);
      expect((await observeSiteSurveyPublication(tx, scope(g))).effectiveBefore.summary.siteSurveyed).toBe(false);
    });
    expect(await state(g)).toBeUndefined(); expect(await notices(g)).toEqual([]);
  });
  it('creates one hidden-profile event and preserves the original generation across newer visits and replay', async () => {
    const g = await seedSubmissionProfile(pool), f = await report(g), key = randomUUID();
    const first = await survey.create(expert, g.profile, body(f.file), key);
    expect(await state(g)).toMatchObject({ site_surveyed: true, generation: '1', effective_until: null, next_refresh_on: null });
    expect(await notices(g)).toEqual([{ generation: '1', survey_record_id: first.id, state: 'pending' }]);
    await survey.create(expert, g.profile, body(f.file, { visitStartedOn: '2021-01-01' }), randomUUID());
    expect(await survey.create(expert, g.profile, body(f.file), key)).toEqual(first);
    expect((await notices(g))).toHaveLength(1);
    expect((await pool.query('select 1 from catalog_visible where profile_id=$1', [g.profile])).rowCount).toBe(0);
  });
  it('does not create an event for no/expired records and creates a new generation only after surveyed ends', async () => {
    const g = await seedSubmissionProfile(pool), f = await report(g);
    let row = await survey.create(expert, g.profile, body(f.file, { result: 'no' }), randomUUID());
    expect(await notices(g)).toEqual([]);
    row = await survey.update(expert, g.profile, row.id, edit(row, { result: 'yes', expiresOn: await date(0) }));
    expect(await notices(g)).toEqual([]);
    row = await survey.update(expert, g.profile, row.id, edit(row, { expiresOn: await date(1) }));
    row = await survey.update(expert, g.profile, row.id, edit(row, { result: 'no' }));
    expect(await state(g)).toMatchObject({ site_surveyed: false, generation: '1' });
    expect((await notices(g))).toHaveLength(1);
    await survey.update(expert, g.profile, row.id, edit(row, { result: 'yes' }));
    expect((await notices(g)).map(r => r.generation)).toEqual(['1', '2']);
  });
  it('keeps the mark while the selected recent report expires before an older signed report', async () => {
    const g = await seedSubmissionProfile(pool), f = await report(g), later = await date(3), sooner = await date(1);
    const older = await survey.create(expert, g.profile, body(f.file, { expiresOn: later }), randomUUID());
    await survey.create(expert, g.profile, body(f.file, { visitStartedOn: '2021-01-01', expiresOn: sooner }), randomUUID());
    expect(await state(g)).toMatchObject({ generation: '1', effective_until: later, next_refresh_on: sooner });
    await db.transaction(async raw => {
      const tx = raw as unknown as Database;
      await tx.execute(sql`select id from manufacturer_profile where id=${g.profile} for no key update`);
      const observation = await observeSiteSurveyPublication(tx, scope(g));
      const refreshed = await reconcileSiteSurveyPublication(tx, scope(g), { ...observation, asOfAlmatyDate: sooner });
      expect(refreshed.summary).toMatchObject({ siteSurveyed: true, currentSurveyId: older.id });
    });
    expect(await state(g)).toMatchObject({ generation: '1', effective_until: later, next_refresh_on: later });
    expect((await notices(g))).toHaveLength(1);
  });
  it('recognizes an expiry missed by the background refresh before reactivating the same record', async () => {
    const g = await seedSubmissionProfile(pool), f = await report(g), past = await date(-1);
    const row = await survey.create(expert, g.profile, body(f.file, { expiresOn: past }), randomUUID());
    // Construct the exact persisted late-worker boundary; canonical record/audit is left untouched.
    await pool.query('update site_survey_publication_state set site_surveyed=true,generation=1,effective_until=$2,next_refresh_on=$2 where profile_id=$1', [g.profile, past]);
    await survey.update(expert, g.profile, row.id, edit(row, { expiresOn: await date(1) }));
    expect(await state(g)).toMatchObject({ generation: '2', site_surveyed: true });
    expect((await notices(g)).map(r => r.generation)).toEqual(['2']);
  });
  it('uses the exact old passed pin despite a newer pending upload and exposes own tier2 outside the DD catalogue', async () => {
    const g = await seedSubmissionProfile(pool); await verified(g);
    const f = await report(g), row = await survey.create(expert, g.profile, body(f.file), randomUUID());
    await db.insert(s.fileVersion).values({ fileObjectId: f.file, versionNumber: 2, originalName: 'pending.pdf', byteSize: 100,
      declaredMediaType: 'application/pdf', detectedMediaType: 'application/pdf', checksum: 'synthetic2',
      scanState: 'pending', uploadedBy: expert.id, storageKey: randomUUID() });
    expect((await loadSiteSurveyState(db, scope(g))).summary.currentSurveyId).toBe(row.id);
    expect((await new ProfilesService(db).own(g.org)).tier).toBe('tier_2');
    expect((await pool.query('select 1 from catalog_visible where profile_id=$1', [g.profile])).rowCount).toBe(0);
  });
  it('rolls back real state, durable outbox and record if the final projection phase fails', async () => {
    const g = await seedSubmissionProfile(pool), f = await report(g);
    await expect(survey.create(expert, g.profile, body(f.file), randomUUID(), null,
      async phase => { if (phase === 'projection') throw new Error('Synthetic final publication failure'); }))
      .rejects.toThrow('Synthetic final publication failure');
    expect(await state(g)).toBeUndefined(); expect(await notices(g)).toEqual([]);
    expect((await pool.query('select 1 from site_survey_record where profile_id=$1', [g.profile])).rowCount).toBe(0);
  });
});
