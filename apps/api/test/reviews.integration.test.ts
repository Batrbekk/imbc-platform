import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { reviewOperationalQueueSchema, reviewAssignmentQueueSchema, ROLES } from '@imbc/contracts';
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
import { profileCandidateRevisions } from '../src/modules/profiles/profile-candidate.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { ReviewsController } from '../src/modules/reviews/reviews.controller.js';
import { ReviewsService } from '../src/modules/reviews/reviews.service.js';
import { ReviewAssignmentService } from '../src/modules/reviews/review-assignment.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';
import { startHttp, type HttpStand } from './support/http.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'Stage5 canonical review queue and assignment with actual SQL/policy',
  () => {
    vi.setConfig({ hookTimeout: 60_000, testTimeout: 30_000 });
    let pool: pg.Pool, appPool: pg.Pool, db: Database, boss: PgBoss, http: HttpStand;
    let reviews: ReviewsService, assignments: ReviewAssignmentService, submit: ProfileSubmitService;
    let expert: AuthUser, other: AuthUser, admin: AuthUser, secondAdmin: AuthUser;
    const role = `stage5_queue_${randomUUID().replaceAll('-', '')}`;
    type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
    let current: Fixture, legacy: Fixture, unsent: Fixture, pendingLegacy: Fixture;
    let assignmentId: string;
    const prefix = `Queue-${randomUUID()}`;
    const fixture = async (name: string) => {
      const g = await seedSubmissionProfile(pool);
      await db
        .update(s.organizations)
        .set({ name: `${prefix} ${name}` })
        .where(eq(s.organizations.id, g.org));
      await db
        .update(s.manufacturerProfile)
        .set({ registeredAt: new Date('2000-01-01T00:00:00.000Z') })
        .where(eq(s.manufacturerProfile.id, g.profile));
      return g;
    };
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
    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
      const imbc = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
      const account = async (roleName: 'expert' | 'administrator'): Promise<AuthUser> => {
        const row = (
          await db
            .insert(s.userAccounts)
            .values({
              organizationId: imbc.id,
              role: roleName,
              state: 'active',
              email: `${randomUUID()}@review.local`,
              fullName: `Synthetic ${roleName}`,
            })
            .returning()
        )[0]!;
        return {
          id: row.id,
          organizationId: imbc.id,
          organizationType: 'imbc',
          role: roleName,
          email: row.email,
          fullName: row.fullName,
          locale: 'en',
        };
      };
      expert = await account('expert');
      other = await account('expert');
      admin = await account('administrator');
      secondAdmin = await account('administrator');
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.notify);
      await pool.query(`create role "${role}" nologin`);
      await applyAppRoleGrants(pool, role);
      await pool.query(
        `grant usage on schema pgboss_auth_test to "${role}"; grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`,
      );
      appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c role=${role}`, max: 5 });
      const audit = new AuditService(drizzle(appPool, { schema: s, casing: 'snake_case' }));
      reviews = new ReviewsService(appPool, audit);
      assignments = new ReviewAssignmentService(appPool, audit);
      submit = new ProfileSubmitService(appPool, audit, boss, submissionHandlers());
      current = await fixture('current');
      assignmentId = (await send(current)).assignmentId;
      legacy = await fixture('legacy');
      await db
        .update(s.manufacturerProfile)
        .set({ status: 'under_review', assignedExpertId: other.id })
        .where(eq(s.manufacturerProfile.id, legacy.profile));
      unsent = await fixture('unsent');
      await db
        .update(s.manufacturerProfile)
        .set({ status: 'verified', hasPendingChanges: true })
        .where(eq(s.manufacturerProfile.id, unsent.profile));
      pendingLegacy = await fixture('legacy-pending');
      await db.transaction(async (tx) => {
        await tx
          .update(s.manufacturerProfile)
          .set({ status: 'verified' })
          .where(eq(s.manufacturerProfile.id, pendingLegacy.profile));
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: new Date() })
          .where(eq(s.sectionRevision.id, pendingLegacy.revisions.contacts!));
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null, pendingRevisionId: pendingLegacy.revisions.contacts! })
          .where(eq(s.profileSection.id, pendingLegacy.sections.contacts));
      });
      http = await startHttp({
        controllers: [ReviewsController],
        providers: [{ provide: ReviewsService, useValue: reviews }],
        organizationId: imbc.id,
        accountIds: { expert: expert.id, administrator: admin.id },
      });
    });
    afterAll(async () => {
      await http?.close();
      await boss?.stop();
      await appPool?.end();
      if (pool) await pool.query(`drop owned by "${role}"; drop role "${role}"`);
      await pool?.end();
    });

    it('uses actual canonical receipt time and preserves unresolved legacy rows without making them actionable', async () => {
      const queue = reviewOperationalQueueSchema.parse(await reviews.queue(expert, { q: prefix }));
      expect(queue.total).toBe(3);
      expect(queue.items.map((row) => row.profileId)).not.toContain(unsent.profile);
      const received = (
        await pool.query(
          `select to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value from review_assignment where id=$1`,
          [assignmentId],
        )
      ).rows[0].value;
      expect(queue.items[0]).toMatchObject({
        profileId: current.profile,
        assignmentId,
        receivedAt: received,
        unresolved: false,
        assignedExpertId: null,
      });
      expect(queue.items[0]!.registeredAt).toContain('2000-01-01');
      for (const id of [legacy.profile, pendingLegacy.profile])
        expect(queue.items.find((row) => row.profileId === id)).toMatchObject({
          assignmentId: null,
          receivedAt: null,
          unresolved: true,
        });
      expect(queue.items.find((row) => row.profileId === legacy.profile)?.assignedExpertId).toBe(other.id);
    });
    it('filters all four queue fields and keeps page count consistent at an empty offset', async () => {
      expect(
        (await reviews.queue(expert, { q: `${prefix} current`, status: 'submitted' })).items.map(
          (row) => row.profileId,
        ),
      ).toEqual([current.profile]);
      expect(
        (await reviews.queue(expert, { q: prefix, assignee: other.id })).items.map((row) => row.profileId),
      ).toEqual([legacy.profile]);
      expect(
        (await reviews.queue(expert, { q: prefix, status: 'pending_changes' })).items.map((row) => row.profileId),
      ).toEqual([pendingLegacy.profile]);
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Almaty',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      expect(
        (await reviews.queue(expert, { q: prefix, receivedFrom: date, receivedTo: date })).items.map(
          (row) => row.profileId,
        ),
      ).toEqual([current.profile]);
      const empty = await reviews.queue(expert, { q: prefix, offset: 100, limit: 1 });
      expect(empty.items).toEqual([]);
      expect(empty.total).toBe(3);
    });
    it('treats wildcard punctuation in a manufacturer filter literally', async () => {
      const literal = await fixture('50%_!literal');
      await db
        .update(s.manufacturerProfile)
        .set({ status: 'submitted' })
        .where(eq(s.manufacturerProfile.id, literal.profile));
      const page = await reviews.queue(expert, { q: '50%_!literal' });
      expect(page.items.map((row) => row.profileId)).toEqual([literal.profile]);
    });
    it.each(ROLES)('HTTP allows %s only its explicit SME or administrator queue projection', async (roleName) => {
      const queue = await http.get(`/api/v1/reviews/queue?q=${encodeURIComponent(prefix)}`, roleName);
      expect(queue.status).toBe(roleName === 'expert' ? 200 : 403);
      const administrative = await http.get(
        `/api/v1/reviews/assignment-queue?q=${encodeURIComponent(prefix)}`,
        roleName,
      );
      expect(administrative.status).toBe(roleName === 'administrator' ? 200 : 403);
    });
    it('administrator metadata excludes BIN, source values, referrals, contacts and receipt dates', async () => {
      await db
        .update(s.manufacturerProfile)
        .set({ heardAboutUs: 'PRIVATE-REFERRAL-SENTINEL' })
        .where(eq(s.manufacturerProfile.id, current.profile));
      const page = reviewAssignmentQueueSchema.parse(await reviews.assignmentQueue(admin, { q: `${prefix} current` }));
      expect(page.items[0]).toEqual({
        profileId: current.profile,
        organizationName: `${prefix} current`,
        status: 'submitted',
        hasPendingChanges: false,
        assignmentId,
        assignedExpertId: null,
        assignedExpert: null,
        unresolved: false,
      });
      const serialized = JSON.stringify(page);
      for (const value of [current.actor.email, 'PRIVATE-REFERRAL-SENTINEL', 'focal@submit.local', '+7 777 111 2233'])
        expect(serialized).not.toContain(value);
      for (const key of ['bin', 'registeredAt', 'receivedAt', 'sections', 'files'])
        expect(page.items[0]).not.toHaveProperty(key);
    });
    it.each(['offset=2147483648', 'receivedFrom=0000-01-01'])(
      'rejects a PostgreSQL-invalid queue filter %s at HTTP validation',
      async (query) => {
        const response = await http.get(`/api/v1/reviews/queue?${query}`, 'expert');
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'validation' });
      },
    );
    it('one of two SMEs takes unassigned work without opening it or creating email jobs', async () => {
      const g = await fixture('take-race'),
        sent = await send(g);
      const before = (
        await pool.query('select count(*)::integer as n from pgboss_auth_test.job where name=$1', [QUEUES.notify])
      ).rows[0].n;
      const outcomes = await Promise.allSettled([
        assignments.take(expert, sent.assignmentId),
        assignments.take(other, sent.assignmentId),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const state = (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile)))[0]!;
      expect(state.status).toBe('submitted');
      expect([expert.id, other.id]).toContain(state.assignedExpertId);
      expect(
        (await pool.query('select count(*)::integer as n from pgboss_auth_test.job where name=$1', [QUEUES.notify]))
          .rows[0].n,
      ).toBe(before);
      const mapCount = (
        await pool.query('select count(*)::integer as n from review_assignment_section where review_assignment_id=$1', [
          sent.assignmentId,
        ])
      ).rows[0].n;
      expect(mapCount).toBe(7);
    });
    it('reassigns with exact old expert CAS, complete audit and unchanged receipt/map/notifications', async () => {
      const g = await fixture('admin-reassign'),
        sent = await send(g);
      await assignments.take(expert, sent.assignmentId);
      const before = (
        await pool.query('select to_jsonb(a) as value from review_assignment a where id=$1', [sent.assignmentId])
      ).rows[0].value;
      const jobs = (await pool.query('select count(*)::integer as n from pgboss_auth_test.job')).rows[0].n;
      await assignments.assign(admin, sent.assignmentId, { expertId: other.id, expectedExpertId: expert.id });
      await expect(
        assignments.assign(admin, sent.assignmentId, { expertId: expert.id, expectedExpertId: expert.id }),
      ).rejects.toMatchObject({ status: 409, code: 'assignment_changed' });
      const fresh = await assignments.readMetadata(admin, sent.assignmentId);
      expect(fresh.assignedExpertId).toBe(other.id);
      await expect(assignments.take(expert, sent.assignmentId)).rejects.toMatchObject({ status: 403 });
      const after = (
        await pool.query('select to_jsonb(a) as value from review_assignment a where id=$1', [sent.assignmentId])
      ).rows[0].value;
      expect(after.received_at).toBe(before.received_at);
      expect(after.operation_key).toBe(before.operation_key);
      expect(after.expert_id).toBe(other.id);
      expect(after.assigned_by).toBe(admin.id);
      const audit = (
        await pool.query("select diff from audit_entries where object_id=$1 and action='review.assign'", [
          sent.assignmentId,
        ])
      ).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].diff.before.assignment.expert_id).toBe(expert.id);
      expect(audit[0].diff.after.assignment).toEqual(after);
      expect((await pool.query('select count(*)::integer as n from pgboss_auth_test.job')).rows[0].n).toBe(jobs);
    });
    it('revalidates persisted actor, target expert and policy instead of trusting stale claims', async () => {
      await expect(reviews.queue({ ...expert, organizationId: current.org }, {})).rejects.toMatchObject({
        status: 403,
      });
      await pool.query("update user_accounts set state='blocked' where id=$1", [other.id]);
      try {
        await expect(
          assignments.assign(admin, assignmentId, { expertId: other.id, expectedExpertId: null }),
        ).rejects.toMatchObject({ status: 400, code: 'review_expert_unavailable' });
        expect((await reviews.experts(admin)).map((row) => row.id)).not.toContain(other.id);
        expect((await reviews.queueExperts(expert)).map((row) => row.id)).toContain(other.id);
      } finally {
        await pool.query("update user_accounts set state='active' where id=$1", [other.id]);
      }
      await pool.query("update policy_rule set effect='deny' where role='expert' and action='review.take'");
      try {
        await expect(reviews.queue(expert, {})).rejects.toMatchObject({ status: 403 });
      } finally {
        await pool.query("update policy_rule set effect='allow' where role='expert' and action='review.take'");
      }
    });
    it('orders two administrator/target account locks even for mutually invalid expert targets', async () => {
      const outcomes = await Promise.allSettled([
        assignments.assign(admin, assignmentId, { expertId: secondAdmin.id, expectedExpertId: null }),
        assignments.assign(secondAdmin, assignmentId, { expertId: admin.id, expectedExpertId: null }),
      ]);
      for (const result of outcomes) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected')
          expect(result.reason).toMatchObject({ status: 400, code: 'review_expert_unavailable' });
      }
    });
    it('keeps a real unresolved legacy profile with unknown BIN in the operational queue', async () => {
      const g = await fixture('unknown-BIN');
      await db.update(s.organizations).set({ bin: null }).where(eq(s.organizations.id, g.org));
      await db
        .update(s.manufacturerProfile)
        .set({ status: 'under_review' })
        .where(eq(s.manufacturerProfile.id, g.profile));
      const queue = reviewOperationalQueueSchema.parse(await reviews.queue(expert, { q: `${prefix} unknown-BIN` }));
      expect(queue.items).toHaveLength(1);
      expect(queue.items[0]).toMatchObject({ profileId: g.profile, bin: null, receivedAt: null, unresolved: true });
    });
  },
);
