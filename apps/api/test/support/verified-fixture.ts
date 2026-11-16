import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { AuditService } from '../../src/common/audit.service.js';
import type { Database } from '../../src/database/database.module.js';
import * as s from '../../src/database/schema/index.js';
import { QUEUES } from '../../src/jobs/queues.js';
import type { AuthUser } from '../../src/modules/auth/auth.types.js';
import { DiligenceService } from '../../src/modules/due-diligence/diligence.service.js';
import { profileCandidateRevisions, profileSubmissionRevisions } from '../../src/modules/profiles/profile-candidate.js';
import { ProfileReviewService, profileReviewEvidence } from '../../src/modules/profiles/profile-review.service.js';
import { ProfileSubmitService } from '../../src/modules/profiles/profile-submit.service.js';
import { SiteSurveyService } from '../../src/modules/site-survey/site-survey.service.js';
import { SiteSurveyPublicationService } from '../../src/modules/site-survey/site-survey-publication.service.js';
import { seedSubmissionProfile, submissionHandlers } from './profile-submit.js';

type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;

/** Query fixtures acquire real canonical revision/decision/DD proof; this helper does not forge verification. */
export async function createVerifiedFixtureWorkflow(pool: pg.Pool) {
  const db = drizzle(pool, { schema: s, casing: 'snake_case' }) as Database;
  const imbc = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
  const [account] = await db
    .insert(s.userAccounts)
    .values({
      organizationId: imbc.id,
      role: 'expert',
      state: 'active',
      email: `${randomUUID()}@verified-fixture.local`,
    })
    .returning();
  const expert: AuthUser = {
    id: account!.id,
    organizationId: imbc.id,
    organizationType: 'imbc',
    role: 'expert',
    email: account!.email,
    fullName: null,
    locale: 'en',
  };
  const boss = new PgBoss({
    connectionString: process.env.TEST_DATABASE_URL,
    schema: 'pgboss_auth_test',
    supervise: false,
    schedule: false,
  });
  await boss.start();
  await boss.createQueue(QUEUES.notify);
  const audit = new AuditService(db);
  const submit = new ProfileSubmitService(pool, audit, boss, submissionHandlers());
  const review = new ProfileReviewService(pool, audit, boss);
  const diligence = new DiligenceService(pool, audit);
  const surveys = new SiteSurveyService(pool, audit, new SiteSurveyPublicationService());
  async function verify(g: Fixture) {
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
    for (const fact of facts.filter((f) => f.subject.kind !== 'file' && f.subject.kind !== 'section'))
      await review.decide(expert, sent.assignmentId, { subject: fact.subject, outcome: 'verified', comment: null });
    for (const fact of facts.filter((f) => f.subject.kind === 'section'))
      await review.decide(expert, sent.assignmentId, { subject: fact.subject, outcome: 'verified', comment: null });
    await review.submitResult(expert, sent.assignmentId);
  }
  async function green(g: Fixture) {
    const current = await diligence.read({ actor: expert }, g.profile);
    await diligence.override({ actor: expert }, g.profile, {
      result: 'green',
      comment: null,
      reportFileId: null,
      expectedUpdatedAt: current.record?.updatedAt ?? null,
    });
  }
  async function addSurvey(g: Fixture) {
    // Scanned fixture metadata proves the query boundary; bytes/scanner behavior has its own real HTTP suites.
    const [file] = await db
      .insert(s.fileObject)
      .values({ organizationId: g.org, purpose: 'site_survey_report', dataClass: 'c_imbc' })
      .returning();
    await db.insert(s.fileVersion).values({
      fileObjectId: file!.id,
      versionNumber: 1,
      originalName: 'signed.pdf',
      byteSize: 1,
      declaredMediaType: 'application/pdf',
      detectedMediaType: 'application/pdf',
      checksum: 'fixture',
      storageKey: randomUUID(),
      scanState: 'passed',
      uploadedBy: expert.id,
    });
    return surveys.create(
      expert,
      g.profile,
      {
        visitStartedOn: '2020-01-01',
        visitEndedOn: null,
        result: 'yes',
        expiresOn: null,
        comment: null,
        reportFileId: file!.id,
      },
      randomUUID(),
    );
  }
  return { db, expert, boss, verify, green, addSurvey, close: () => boss.stop() };
}
