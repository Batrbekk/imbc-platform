import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  SECTION_KINDS,
  type MainInformationWrite,
  type ProductsWrite,
  type ProfileSubmitResult,
  type SectionKind,
  type DocumentsWrite,
  type CertificatesWrite,
} from '@imbc/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { ProblemException } from '../src/common/problem.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import { assertDemoReviewTarget, parseDemoReviewCommand, runDemoReview } from '../src/database/profile-review-demo.js';
import * as s from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { profileCandidateRevisions, profileSubmissionRevisions } from '../src/modules/profiles/profile-candidate.js';
import { ProfileReviewDetailsController } from '../src/modules/profiles/profile-review-details.controller.js';
import { ProfileReviewDetailsService } from '../src/modules/profiles/profile-review-details.service.js';
import { ProfileReviewService, profileReviewEvidence } from '../src/modules/profiles/profile-review.service.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { ProfileUnlockService } from '../src/modules/profiles/profile-unlock.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp } from './support/http.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';

describe('closed demo command', () => {
  it('requires exact true and explicit action/assignment, with no bulk approval or forged actor fields', () => {
    const expert = randomUUID(),
      assignment = randomUUID(),
      subject = randomUUID();
    expect(() => parseDemoReviewCommand(['take', expert, assignment], undefined)).toThrow();
    expect(() => parseDemoReviewCommand(['approve-all', expert, assignment], 'true')).toThrow();
    expect(() => parseDemoReviewCommand(['take', expert], 'true')).toThrow();
    expect(() =>
      parseDemoReviewCommand(['decide', expert, assignment, 'section', subject, 'rejected'], 'true'),
    ).toThrow();
    expect(
      parseDemoReviewCommand(['decide', expert, assignment, 'section', subject, 'rejected', 'Correction'], 'true'),
    ).toMatchObject({ action: 'decide', input: { outcome: 'rejected' } });
  });
  it('rejects disabled CLI before constructing a database connection', async () => {
    await expect(
      runDemoReview(['take', randomUUID(), randomUUID()], { DATABASE_URL: 'invalid', SEED_DEMO: 'false' }),
    ).rejects.toMatchObject({ code: 'demo_review_forbidden' });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'internal exact review lifecycle with PostgreSQL and atomic pg-boss',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool, appPool: pg.Pool, db: Database, boss: PgBoss;
    let review: ProfileReviewService,
      submit: ProfileSubmitService,
      unlock: ProfileUnlockService,
      editor: ProfileSectionsService,
      details: ProfileReviewDetailsService;
    let expert: AuthUser, other: AuthUser;
    const role = `review_core_${randomUUID().replaceAll('-', '')}`;
    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
      const imbc = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
      const makeExpert = async (): Promise<AuthUser> => {
        const [account] = await db
          .insert(s.userAccounts)
          .values({ organizationId: imbc.id, role: 'expert', state: 'active', email: `${randomUUID()}@review.local` })
          .returning();
        return {
          id: account!.id,
          organizationId: imbc.id,
          organizationType: 'imbc',
          role: 'expert',
          email: account!.email,
          fullName: null,
          locale: 'en',
        };
      };
      expert = await makeExpert();
      other = await makeExpert();
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.notify);
      await pool.query(`create role "${role}" nologin; grant usage on schema public,pgboss_auth_test to "${role}"`);
      await applyAppRoleGrants(pool, role);
      await pool.query(`grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`);
      appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c role=${role}`, max: 5 });
      const audit = new AuditService(drizzle(appPool, { schema: s, casing: 'snake_case' }));
      review = new ProfileReviewService(appPool, audit, boss);
      submit = new ProfileSubmitService(appPool, audit, boss, submissionHandlers());
      unlock = new ProfileUnlockService(appPool, audit, boss);
      editor = new ProfileSectionsService(appPool, audit, submissionHandlers());
      details = new ProfileReviewDetailsService(appPool, audit);
    });
    afterAll(async () => {
      await boss?.stop();
      await appPool?.end();
      if (pool) await pool.query(`drop owned by "${role}"; drop role "${role}"`);
      await pool?.end();
    });
    type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
    const send = async (g: Fixture) => {
      const candidates = await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org });
      const revisions = await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, g.org));
      return submit.submit(g.actor, {
        operationKey: randomUUID(),
        accuracyConfirmed: true,
        expectedSections: candidates.map((c) => ({
          kind: c.kind,
          revisionId: c.revisionId!,
          editVersion: revisions.find((r) => r.id === c.revisionId)!.editVersion,
        })),
      });
    };
    const evidence = async (g: Fixture, sent: ProfileSubmitResult) => {
      const profile = (
        await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile))
      )[0]!;
      const map = await profileSubmissionRevisions(db, {
        assignmentId: sent.assignmentId,
        profileId: g.profile,
        organizationId: g.org,
      });
      return profileReviewEvidence(db, { profile, map });
    };
    const decideAll = async (g: Fixture, sent: ProfileSubmitResult, rejected: SectionKind[] = []) => {
      const facts = await evidence(g, sent);
      for (const item of facts.filter((f) => f.subject.kind === 'document' || f.subject.kind === 'certificate'))
        if (sent.sections.find((section) => section.revisionId === item.revisionId)!.reviewRequired)
          await review.decide(expert, sent.assignmentId, { subject: item.subject, outcome: 'verified', comment: null });
      for (const section of sent.sections.filter((section) => section.reviewRequired))
        await review.decide(expert, sent.assignmentId, {
          subject: { kind: 'section', sectionRevisionId: section.revisionId },
          outcome: rejected.includes(section.kind) ? 'rejected' : 'verified',
          comment: rejected.includes(section.kind) ? 'Please correct this section' : null,
        });
    };
    const state = async (g: Fixture) => ({
      profile: (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile)))[0]!,
      sections: await db.select().from(s.profileSection).where(eq(s.profileSection.profileId, g.profile)),
    });
    const edit = async <T>(g: Fixture, kind: SectionKind, mutate: (data: T) => void) => {
      const read = await editor.read(g.actor, kind);
      const handler = submissionHandlers().find((h) => h.kind === kind)!;
      const current = (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org })).find(
        (c) => c.kind === kind,
      )!;
      const data = (await handler.editable(db, {
        profileId: g.profile,
        organizationId: g.org,
        sectionId: current.sectionId,
        revisionId: current.revisionId!,
      })) as T;
      mutate(data);
      return editor.save(g.actor, kind, { editVersion: read.editVersion, data });
    };
    const verifiedFixture = async () => {
      const g = await seedSubmissionProfile(pool);
      const first = await send(g);
      await review.take(expert, first.assignmentId);
      await decideAll(g, first);
      await review.submitResult(expert, first.assignmentId);
      return g;
    };

    it('requires actual active IMBC expert and exact assigned SME, independent of claimed role/tenant', async () => {
      const g = await seedSubmissionProfile(pool),
        sent = await send(g);
      await expect(review.take({ ...g.actor, role: 'expert' }, sent.assignmentId)).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(review.take({ ...expert, organizationId: g.org }, sent.assignmentId)).rejects.toMatchObject({
        code: 'forbidden',
      });
      await review.take(expert, sent.assignmentId);
      await expect(review.take(other, sent.assignmentId)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        review.decide(other, sent.assignmentId, {
          subject: { kind: 'section', sectionRevisionId: sent.sections[0]!.revisionId },
          outcome: 'verified',
          comment: null,
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await db.update(s.userAccounts).set({ state: 'inactive' }).where(eq(s.userAccounts.id, expert.id));
      await expect(review.submitResult(expert, sent.assignmentId)).rejects.toMatchObject({ code: 'forbidden' });
      await db.update(s.userAccounts).set({ state: 'active' }).where(eq(s.userAccounts.id, expert.id));
    });
    it('rejects foreign exact subjects and ISO absence item decisions', async () => {
      const g = await seedSubmissionProfile(pool),
        foreign = await seedSubmissionProfile(pool),
        sent = await send(g);
      await review.take(expert, sent.assignmentId);
      await expect(
        review.decide(expert, sent.assignmentId, {
          subject: { kind: 'section', sectionRevisionId: foreign.revisions.contacts! },
          outcome: 'verified',
          comment: null,
        }),
      ).rejects.toMatchObject({ code: 'review_subject_not_found' });
      const iso = (
        await db
          .select()
          .from(s.certificate)
          .where(sql`organization_id=${g.org} and not_held`)
      )[0]!;
      await expect(
        review.decide(expert, sent.assignmentId, {
          subject: { kind: 'certificate', certificateId: iso.id },
          outcome: 'verified',
          comment: null,
        }),
      ).rejects.toMatchObject({ code: 'review_subject_not_found' });
    });
    it('requires per-document/held-certificate outcomes, while optional equipment/photo clicks remain optional', async () => {
      const g = await seedSubmissionProfile(pool),
        sent = await send(g);
      await review.take(expert, sent.assignmentId);
      const documents = sent.sections.find((section) => section.kind === 'documents')!;
      await expect(
        review.decide(expert, sent.assignmentId, {
          subject: { kind: 'section', sectionRevisionId: documents.revisionId },
          outcome: 'verified',
          comment: null,
        }),
      ).rejects.toMatchObject({ code: 'review_incomplete' });
      await review.decide(expert, sent.assignmentId, {
        subject: { kind: 'section', sectionRevisionId: documents.revisionId },
        outcome: 'rejected',
        comment: 'Incomplete evidence',
      });
      await expect(review.submitResult(expert, sent.assignmentId)).rejects.toMatchObject({ code: 'review_incomplete' });
      await decideAll(g, sent);
      const before = await pool.query(
        'select to_jsonb(r) as value from section_revision r where organization_id=$1 order by id',
        [g.org],
      );
      const result = await review.submitResult(expert, sent.assignmentId);
      expect(result.profileStatus).toBe('verified');
      expect(result.publishKinds).toHaveLength(7);
      const after = await pool.query(
        'select to_jsonb(r) as value from section_revision r where organization_id=$1 order by id',
        [g.org],
      );
      expect(after.rows.map(({ value }) => ({ ...value, state: null }))).toEqual(
        before.rows.map(({ value }) => ({ ...value, state: null })),
      );
      expect(
        await db
          .select()
          .from(s.reviewDecision)
          .where(sql`review_assignment_id=${sent.assignmentId} and file_version_id is not null`),
      ).toHaveLength(0);
      expect(
        (await state(g)).sections.every(
          (section) => section.pendingRevisionId === null && section.verifiedRevisionId !== null,
        ),
      ).toBe(true);
      await expect(review.submitResult(expert, sent.assignmentId)).rejects.toMatchObject({
        code: 'assignment_changed',
      });
      const jobs = (await boss.findJobs(QUEUES.notify)).filter(
        (job) => (job.data as { eventKey?: string }).eventKey === `profile-review-result:${sent.assignmentId}`,
      );
      expect(jobs).toHaveLength(1);
      expect(JSON.stringify(jobs[0]!.data)).not.toContain('Please');
      expect(JSON.stringify(jobs[0]!.data)).not.toContain('@');
    });
    it('uses effective latest item rejection and exact captured scan state before section/result acceptance', async () => {
      const g = await seedSubmissionProfile(pool),
        sent = await send(g);
      await review.take(expert, sent.assignmentId);
      await decideAll(g, sent);
      const doc = (await evidence(g, sent)).find((item) => item.subject.kind === 'document')!;
      await review.decide(expert, sent.assignmentId, {
        subject: doc.subject,
        outcome: 'rejected',
        comment: 'Unreadable',
      });
      await expect(review.submitResult(expert, sent.assignmentId)).rejects.toMatchObject({ code: 'review_incomplete' });
      await review.decide(expert, sent.assignmentId, { subject: doc.subject, outcome: 'verified', comment: null });
      const fileFacts = await evidence(g, sent);
      const fileItem = fileFacts.find(
        (item) => ['certificate', 'document'].includes(item.subject.kind) && item.fileObjectId !== null,
      )!;
      const file = fileFacts.find(
        (item) => item.subject.kind === 'file' && item.fileObjectId === fileItem.fileObjectId,
      )!;
      await review.decide(expert, sent.assignmentId, {
        subject: file.subject,
        outcome: 'rejected',
        comment: 'Unrelated file',
      });
      await expect(review.submitResult(expert, sent.assignmentId)).rejects.toMatchObject({ code: 'review_incomplete' });
      const linked = (await evidence(g, sent)).find(
        (item) => ['certificate', 'document'].includes(item.subject.kind) && item.fileObjectId === file.fileObjectId,
      )!;
      await expect(
        review.decide(expert, sent.assignmentId, { subject: linked.subject, outcome: 'verified', comment: null }),
      ).rejects.toMatchObject({ code: 'review_incomplete' });
      await review.decide(expert, sent.assignmentId, { subject: file.subject, outcome: 'verified', comment: null });
      if (file.subject.kind !== 'file') throw new Error('fixture');
      const captured = (
        await db.select().from(s.fileVersion).where(eq(s.fileVersion.id, file.subject.fileVersionId))
      )[0]!;
      await db.insert(s.fileVersion).values({
        ...captured,
        id: randomUUID(),
        versionNumber: captured.versionNumber + 1,
        storageKey: randomUUID(),
        scanState: 'passed',
      });
      await db
        .update(s.fileVersion)
        .set({ scanState: 'rejected', rejectionReason: 'malware' })
        .where(eq(s.fileVersion.id, file.subject.fileVersionId));
      // A newer passed version cannot mask a rejected exact capture in the reviewed graph.
      await expect(review.submitResult(expert, sent.assignmentId)).rejects.toMatchObject({
        code: 'submission_file_unavailable',
      });
    });
    it('initial Returned retains accepted exact candidates; COW corrected rejection and repeat reuse publish all seven', async () => {
      const g = await seedSubmissionProfile(pool),
        first = await send(g);
      await review.take(expert, first.assignmentId);
      await decideAll(g, first, ['contacts']);
      const returned = await review.submitResult(expert, first.assignmentId);
      expect(returned.profileStatus).toBe('returned');
      expect(returned.publishKinds).toHaveLength(0);
      expect(returned.retainKinds).toHaveLength(6);
      expect(
        (await state(g)).sections.every(
          (section) => section.verifiedRevisionId === null && section.pendingRevisionId === null,
        ),
      ).toBe(true);
      const oldContacts = first.sections.find((section) => section.kind === 'contacts')!.revisionId;
      await edit<{ contacts: { email: string | null }[] }>(g, 'contacts', (data) => {
        data.contacts[0]!.email = 'corrected@review.local';
      });
      const own = await details.read(g.actor),
        contact = own.sections.find((section) => section.kind === 'contacts')!;
      expect(contact.reviewedRevisionId).toBe(oldContacts);
      expect(contact.appliesToCurrentRevision).toBe(false);
      expect(contact.decision?.outcome).toBe('rejected');
      const repeat = await send(g);
      expect(repeat.mode).toBe('resubmit');
      expect(repeat.sections.filter((section) => section.reviewRequired).map((section) => section.kind)).toEqual([
        'contacts',
      ]);
      expect(repeat.sections.find((section) => section.kind === 'contacts')!.revisionId).not.toBe(oldContacts);
      await decideAll(g, repeat);
      const result = await review.submitResult(expert, repeat.assignmentId);
      expect(result.profileStatus).toBe('verified');
      expect(result.publishKinds).toHaveLength(7);
    });
    it('manufacturer Unlock closes the old queue, retains exact open acceptance and permits a fresh result cycle', async () => {
      const g = await seedSubmissionProfile(pool),
        first = await send(g);
      await review.take(expert, first.assignmentId);
      const contacts = first.sections.find((section) => section.kind === 'contacts')!;
      await review.decide(expert, first.assignmentId, {
        subject: { kind: 'section', sectionRevisionId: contacts.revisionId },
        outcome: 'verified',
        comment: null,
      });
      await unlock.unlock(g.actor, { operationKey: randomUUID(), expectedAssignmentId: first.assignmentId });
      await expect(
        review.decide(expert, first.assignmentId, {
          subject: { kind: 'section', sectionRevisionId: contacts.revisionId },
          outcome: 'rejected',
          comment: 'Too late',
        }),
      ).rejects.toMatchObject({ code: 'assignment_changed' });
      const repeat = await send(g);
      expect(repeat.sections.find((section) => section.kind === 'contacts')!.reviewRequired).toBe(false);
      await decideAll(g, repeat);
      expect((await review.submitResult(expert, repeat.assignmentId)).profileStatus).toBe('verified');
    });
    it('rejected verified changes keep baseline pointers while accepted changes publish independently', async () => {
      const g = await verifiedFixture(),
        baseline = await state(g);
      await edit<{ contacts: { email: string | null }[] }>(g, 'contacts', (data) => {
        data.contacts[0]!.email = 'new@review.local';
      });
      await edit<{ managersCount: number | null }>(g, 'personnel', (data) => {
        data.managersCount = 1;
      });
      const sent = await send(g);
      await decideAll(g, sent, ['contacts']);
      const result = await review.submitResult(expert, sent.assignmentId);
      const current = await state(g);
      expect(result.profileStatus).toBe('verified');
      expect(current.profile.hasPendingChanges).toBe(false);
      expect(current.sections.find((section) => section.kind === 'contacts')!.verifiedRevisionId).toBe(
        baseline.sections.find((section) => section.kind === 'contacts')!.verifiedRevisionId,
      );
      expect(current.sections.find((section) => section.kind === 'personnel')!.verifiedRevisionId).toBe(
        sent.sections.find((section) => section.kind === 'personnel')!.revisionId,
      );
    });
    it('defers accepted Main removal behind rejected Products, then unchanged acceptance publishes jointly after correction', async () => {
      const g = await seedSubmissionProfile(pool);
      await edit<MainInformationWrite>(g, 'main_information', (data) => {
        data.sites.push({ ...data.sites[0]!, identityId: null, address: 'Second site' });
      });
      const first = await send(g);
      await review.take(expert, first.assignmentId);
      await decideAll(g, first);
      await review.submitResult(expert, first.assignmentId);
      await db
        .update(s.manufacturerProfile)
        .set({ quarterAnchorAt: '2025-02-01' })
        .where(eq(s.manufacturerProfile.id, g.profile));
      const main = await editor.read(g.actor, 'main_information');
      const sites = (main.data as { editable: MainInformationWrite }).editable.sites;
      const secondSite = sites[1]!.identityId!;
      await edit<ProductsWrite>(g, 'products', (data) => {
        data.products[0]!.productionSiteIdentityId = secondSite;
      });
      await edit<MainInformationWrite>(g, 'main_information', (data) => {
        data.sites = data.sites.slice(1);
      });
      const sent = await send(g);
      await decideAll(g, sent, ['products']);
      const result = await review.submitResult(expert, sent.assignmentId);
      expect(result.retainKinds).toContain('main_information');
      expect(result.publishKinds).not.toContain('main_information');
      expect((await state(g)).profile.quarterAnchorAt).not.toBe('2025-02-01'); // This result accepted a new Main change even though it cannot publish yet.
      const retainedMain = sent.sections.find((section) => section.kind === 'main_information')!.revisionId;
      expect(
        (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org })).find(
          (section) => section.kind === 'main_information',
        )!.acceptedDecisionId,
      ).not.toBeNull();
      await edit<ProductsWrite>(g, 'products', (data) => {
        data.products[0]!.note = 'Corrected details';
      });
      const repeat = await send(g);
      const acceptedMain = repeat.sections.find((section) => section.kind === 'main_information')!;
      expect(acceptedMain.revisionId).toBe(retainedMain);
      expect(acceptedMain.reviewRequired).toBe(false);
      await decideAll(g, repeat);
      const coherent = await review.submitResult(expert, repeat.assignmentId);
      expect(coherent.publishKinds).toContain('main_information');
      expect(coherent.publishKinds).toContain('products');
      expect((await state(g)).sections.find((section) => section.kind === 'main_information')!.verifiedRevisionId).toBe(
        retainedMain,
      );
    });
    it('rolls back status, pointers, assignment closure and audit when transactional notification enqueue fails', async () => {
      const g = await seedSubmissionProfile(pool),
        sent = await send(g);
      await review.take(expert, sent.assignmentId);
      await decideAll(g, sent);
      const before = await state(g);
      const failing = new ProfileReviewService(appPool, new AuditService(drizzle(appPool, { schema: s })), {
        send: async () => {
          throw new Error('queue failure');
        },
      } as unknown as PgBoss);
      await expect(failing.submitResult(expert, sent.assignmentId)).rejects.toThrow('queue failure');
      expect(await state(g)).toEqual(before);
      expect(
        (await db.select().from(s.reviewAssignment).where(eq(s.reviewAssignment.id, sent.assignmentId)))[0]!.closedAt,
      ).toBeNull();
      expect(
        await db
          .select()
          .from(s.auditEntries)
          .where(sql`object_id=${sent.assignmentId} and action='review.submit_result'`),
      ).toHaveLength(0);
    });
    it('own review HTTP is scoped/read-only and separates reviewed comments from new working data', async () => {
      const g = await verifiedFixture();
      await edit<{ contacts: { email: string | null }[] }>(g, 'contacts', (data) => {
        data.contacts[0]!.email = 'working@review.local';
      });
      const http = await startHttp({
        controllers: [ProfileReviewDetailsController],
        providers: [{ provide: ProfileReviewDetailsService, useValue: details }],
        organizationId: g.org,
        accountIds: { manufacturer: g.actor.id, expert: expert.id },
      });
      try {
        const before = await state(g);
        const response = await http.get('/api/v1/profiles/own/review', 'manufacturer');
        expect(response.status).toBe(200);
        const value = (await response.json()) as {
          profileId: string;
          sections: { kind: string; appliesToCurrentRevision: boolean; decision: { outcome: string } | null }[];
        };
        expect(value.profileId).toBe(g.profile);
        expect(value.sections.find((section) => section.kind === 'contacts')).toMatchObject({
          appliesToCurrentRevision: false,
          decision: { outcome: 'verified' },
        });
        expect(await state(g)).toEqual(before);
        expect((await http.get('/api/v1/profiles/own/review')).status).toBe(401);
        expect((await http.get('/api/v1/profiles/own/review', 'expert')).status).toBe(403);
        await expect(details.read({ ...g.actor, organizationId: randomUUID() })).rejects.toMatchObject({
          code: 'forbidden',
        });
      } finally {
        await http.close();
      }
    });
    it('demo gates persisted local SME and producer before mutations; normal service permits real accounts', async () => {
      const g = await seedSubmissionProfile(pool),
        sent = await send(g);
      const guarded = {
        beforeMutation: (tx: Database, actor: AuthUser, graph: Parameters<typeof assertDemoReviewTarget>[2]) =>
          assertDemoReviewTarget(tx, actor, graph, 'true'),
      };
      await db.update(s.userAccounts).set({ email: 'producer@example.com' }).where(eq(s.userAccounts.id, g.actor.id));
      await expect(review.take(expert, sent.assignmentId, guarded)).rejects.toMatchObject({
        code: 'demo_review_forbidden',
      });
      expect(
        (await db.select().from(s.reviewAssignment).where(eq(s.reviewAssignment.id, sent.assignmentId)))[0]!.expertId,
      ).toBeNull();
      await review.take(expert, sent.assignmentId); // .local is a CLI gate, never a fake production policy restriction.
      await expect(
        runDemoReview(['take', expert.id, sent.assignmentId], {
          SEED_DEMO: 'true',
          DATABASE_URL: process.env.TEST_DATABASE_URL,
          PGBOSS_SCHEMA: 'pgboss_auth_test',
        }),
      ).rejects.toMatchObject({ code: 'demo_review_forbidden' });
    });
    it('closed demo rejects real focal point and real expert despite enabled environment, without queue or audit writes', async () => {
      const g = await seedSubmissionProfile(pool);
      await db
        .update(s.contact)
        .set({ email: 'focal@example.com' })
        .where(sql`organization_id=${g.org} and is_focal_point`);
      const sent = await send(g);
      await expect(
        runDemoReview(['take', expert.id, sent.assignmentId], {
          SEED_DEMO: 'true',
          DATABASE_URL: process.env.TEST_DATABASE_URL,
          PGBOSS_SCHEMA: 'pgboss_auth_test',
        }),
      ).rejects.toMatchObject({ code: 'demo_review_forbidden' });
      expect(
        (await db.select().from(s.reviewAssignment).where(eq(s.reviewAssignment.id, sent.assignmentId)))[0]!.expertId,
      ).toBeNull();
      const safe = await seedSubmissionProfile(pool),
        safeSent = await send(safe);
      await db.update(s.userAccounts).set({ email: 'expert@example.com' }).where(eq(s.userAccounts.id, expert.id));
      try {
        await expect(
          runDemoReview(['take', expert.id, safeSent.assignmentId], {
            SEED_DEMO: 'true',
            DATABASE_URL: process.env.TEST_DATABASE_URL,
            PGBOSS_SCHEMA: 'pgboss_auth_test',
          }),
        ).rejects.toMatchObject({ code: 'demo_review_forbidden' });
      } finally {
        await db.update(s.userAccounts).set({ email: expert.email }).where(eq(s.userAccounts.id, expert.id));
      }
      expect(
        await db
          .select()
          .from(s.auditEntries)
          .where(sql`object_id=${safeSent.assignmentId} and action='review.take'`),
      ).toHaveLength(0);
    });
    it('closed demo takes only an explicitly identified local assignment and never generates approval decisions', async () => {
      const g = await seedSubmissionProfile(pool),
        sent = await send(g);
      const result = await runDemoReview(['take', expert.id, sent.assignmentId], {
        SEED_DEMO: 'true',
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        PGBOSS_SCHEMA: 'pgboss_auth_test',
      });
      expect(result).toEqual({ assignmentId: sent.assignmentId, count: 1 });
      expect(
        await db.select().from(s.reviewDecision).where(eq(s.reviewDecision.reviewAssignmentId, sent.assignmentId)),
      ).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain('@');
    });
    it('serializes concurrent result and manufacturer Unlock so only one closure and notification can commit', async () => {
      const g = await seedSubmissionProfile(pool),
        sent = await send(g);
      await review.take(expert, sent.assignmentId);
      await decideAll(g, sent);
      const outcomes = await Promise.allSettled([
        review.submitResult(expert, sent.assignmentId),
        unlock.unlock(g.actor, { operationKey: randomUUID(), expectedAssignmentId: sent.assignmentId }),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failure = outcomes.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason).toBeInstanceOf(ProblemException);
      expect(failure.reason.code).toBe('assignment_changed');
      const assignment = (
        await db.select().from(s.reviewAssignment).where(eq(s.reviewAssignment.id, sent.assignmentId))
      )[0]!;
      const current = await state(g);
      expect(current.sections.every((section) => section.pendingRevisionId === null)).toBe(true);
      expect(current.profile.status).toBe(assignment.closeReason === 'review_result' ? 'verified' : 'draft');
      const jobs = (await boss.findJobs(QUEUES.notify)).filter((job) => {
        const data = job.data as { rule: string; related?: { id: string } };
        return data.related?.id === sent.assignmentId && ['NOT-05', 'NOT-10'].includes(data.rule);
      });
      expect(jobs).toHaveLength(1);
    });
    it('preserves exact historical item labels after deleting/reordering a working COW and adding a newer file version', async () => {
      const g = await seedSubmissionProfile(pool);
      const dictionary = (await db.select().from(s.dictionary).where(eq(s.dictionary.code, 'document_type')))[0]!;
      const [type] = await db
        .insert(s.dictionaryEntry)
        .values({ dictionaryId: dictionary.id, code: `optional_${randomUUID()}`, customNameAllowed: true })
        .returning();
      await db.insert(s.dictionaryEntryTranslation).values(
        (['en', 'ru', 'kk'] as const).map((language) => ({
          dictionaryEntryId: type!.id,
          language,
          name: `Historical ${language}`,
        })),
      );
      const existing = (await db.select().from(s.document).where(eq(s.document.organizationId, g.org)))[0]!;
      const [identity] = await db
        .insert(s.documentIdentity)
        .values({ profileId: g.profile, organizationId: g.org })
        .returning();
      const [appendix] = await db
        .insert(s.document)
        .values({
          identityId: identity!.id,
          organizationId: g.org,
          sectionRevisionId: g.revisions.documents!,
          documentTypeId: type!.id,
          customName: 'Historical appendix',
          fileObjectId: existing.fileObjectId,
          positionInList: 2,
        })
        .returning();
      const sent = await send(g);
      await review.take(expert, sent.assignmentId);
      await decideAll(g, sent, ['documents']);
      const historicCertificate = (await evidence(g, sent)).find((item) => item.subject.kind === 'certificate')!;
      await review.decide(expert, sent.assignmentId, {
        subject: { kind: 'document', documentId: appendix!.id },
        outcome: 'rejected',
        comment: 'Correct appendix',
      });
      const capturedFile = (await evidence(g, sent)).find(
        (item) => item.subject.kind === 'file' && item.fileObjectId === appendix!.fileObjectId,
      )!;
      await review.decide(expert, sent.assignmentId, {
        subject: capturedFile.subject,
        outcome: 'verified',
        comment: null,
      });
      const captured = (
        await db
          .select()
          .from(s.fileVersion)
          .where(eq(s.fileVersion.id, capturedFile.subject.kind === 'file' ? capturedFile.subject.fileVersionId : ''))
      )[0]!;
      await review.submitResult(expert, sent.assignmentId);
      await db.insert(s.fileVersion).values({
        ...captured,
        id: randomUUID(),
        versionNumber: captured.versionNumber + 1,
        originalName: 'New working filename.pdf',
        storageKey: randomUUID(),
      });
      await edit<DocumentsWrite>(g, 'documents', (data) => {
        data.documents = data.documents.filter((item) => item.identityId !== identity!.id).reverse();
      });
      await edit<CertificatesWrite>(g, 'certificates', (data) => {
        const held = data.certificates.find((item) => !item.notHeld)!;
        held.number = 'New working certificate';
        held.customTypeName = null;
      });
      const read = await details.read(g.actor),
        section = read.sections.find((item) => item.kind === 'documents')!;
      expect(section.appliesToCurrentRevision).toBe(false);
      const historic = section.items.find(
        (item) => item.subject.kind === 'document' && item.subject.documentId === appendix!.id,
      )!;
      expect(historic.label).toEqual({
        kind: 'document',
        positionInList: 2,
        type: { code: type!.code, names: { en: 'Historical en', ru: 'Historical ru', kk: 'Historical kk' } },
        customName: 'Historical appendix',
      });
      expect(historic.decision?.comment).toBe('Correct appendix');
      const file = section.items.find(
        (item) => item.subject.kind === 'file' && item.subject.fileVersionId === captured.id,
      )!;
      expect(file.label).toEqual({ kind: 'file', originalName: captured.originalName });
      const certificate = read.sections
        .find((item) => item.kind === 'certificates')!
        .items.find(
          (item) =>
            item.subject.kind === 'certificate' &&
            historicCertificate.subject.kind === 'certificate' &&
            item.subject.certificateId === historicCertificate.subject.certificateId,
        )!;
      expect(certificate.label).toEqual(historicCertificate.label);
      expect(certificate.label.kind === 'certificate' && certificate.label.number).not.toBe('New working certificate');
      const current = await editor.read(g.actor, 'documents');
      expect((current.data as { editable: DocumentsWrite }).editable.documents).toHaveLength(2);
    });
    it('sets initial active/created local date and moves only newly accepted changes without resetting update status', async () => {
      const g = await seedSubmissionProfile(pool);
      await db
        .update(s.manufacturerProfile)
        .set({ createdAt: new Date('2025-01-31T23:30:00Z') })
        .where(eq(s.manufacturerProfile.id, g.profile));
      const first = await send(g);
      await review.take(expert, first.assignmentId);
      await decideAll(g, first);
      await review.submitResult(expert, first.assignmentId);
      expect((await state(g)).profile).toMatchObject({ updateStatus: 'active', quarterAnchorAt: '2025-02-01' });
      await db
        .update(s.manufacturerProfile)
        .set({ updateStatus: 'unresponsive' })
        .where(eq(s.manufacturerProfile.id, g.profile));
      await edit<{ contacts: { email: string | null }[] }>(g, 'contacts', (data) => {
        data.contacts[0]!.email = 'quarter@review.local';
      });
      const changed = await send(g);
      expect((await state(g)).profile.quarterAnchorAt).toBe('2025-02-01');
      await decideAll(g, changed, ['contacts']);
      await review.submitResult(expert, changed.assignmentId);
      expect((await state(g)).profile).toMatchObject({ updateStatus: 'unresponsive', quarterAnchorAt: '2025-02-01' });
      await edit<{ contacts: { email: string | null }[] }>(g, 'contacts', (data) => {
        data.contacts[0]!.email = 'accepted-quarter@review.local';
      });
      const accepted = await send(g);
      await decideAll(g, accepted);
      const result = await review.submitResult(expert, accepted.assignmentId);
      const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Almaty',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(result.closedAt));
      const p = (kind: string) => parts.find((part) => part.type === kind)!.value;
      expect((await state(g)).profile).toMatchObject({
        updateStatus: 'unresponsive',
        quarterAnchorAt: `${p('year')}-${p('month')}-${p('day')}`,
      });
    });
    it('keeps the quarter anchor through Unlock and moves it when a retained changed candidate publishes', async () => {
      const g = await verifiedFixture();
      await db
        .update(s.manufacturerProfile)
        .set({ quarterAnchorAt: '2025-02-01' })
        .where(eq(s.manufacturerProfile.id, g.profile));
      await edit<{ contacts: { email: string | null }[] }>(g, 'contacts', (data) => {
        data.contacts[0]!.email = 'retained-quarter@review.local';
      });
      const sent = await send(g);
      await decideAll(g, sent);
      await unlock.unlock(g.actor, { operationKey: randomUUID(), expectedAssignmentId: sent.assignmentId });
      expect((await state(g)).profile.quarterAnchorAt).toBe('2025-02-01');
      const repeat = await send(g);
      expect(repeat.sections.every((section) => !section.reviewRequired)).toBe(true);
      await review.submitResult(expert, repeat.assignmentId);
      const expected = (
        await pool.query(
          "select to_char(closed_at at time zone 'Asia/Almaty','YYYY-MM-DD') as day from review_assignment where id=$1",
          [repeat.assignmentId],
        )
      ).rows[0].day;
      expect((await state(g)).profile.quarterAnchorAt).toBe(expected);
      expect(
        (
          await pool.query("select diff from audit_entries where action='review.submit_result' and object_id=$1", [
            repeat.assignmentId,
          ])
        ).rows[0].diff,
      ).toMatchObject({
        quarterAnchorBefore: '2025-02-01',
        quarterAnchorAfter: expected,
      });
    });
  },
);
