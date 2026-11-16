import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { profileUnlockResultSchema, SECTION_KINDS } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { profileCandidateRevisions } from '../src/modules/profiles/profile-candidate.js';
import { ProfileUnlockController } from '../src/modules/profiles/profile-unlock.controller.js';
import { ProfileUnlockService } from '../src/modules/profiles/profile-unlock.service.js';
import { ProfileSubmissionStateController } from '../src/modules/profiles/profile-submission-state.controller.js';
import { ProfileSubmissionStateService } from '../src/modules/profiles/profile-submission-state.service.js';
import { copyRevisionContent } from '../src/modules/profiles/revision-copy.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp } from './support/http.js';
import { seedProfileGraph } from './support/profile-graph.js';

const ROOT = '/api/v1/profiles/own/unlock';
describe.skipIf(!process.env.TEST_DATABASE_URL)('own Unlock with PostgreSQL, HTTP and transactional pg-boss', () => {
  vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let boss: PgBoss;
  let expertId: string;
  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema });
    const imbc = (await pool.query<{ id: string }>("select id from organizations where type='imbc'")).rows[0]!;
    expertId = randomUUID();
    await pool.query(
      "insert into user_accounts (id,organization_id,role,state,email) values ($1,$2,'expert','active',$3)",
      [expertId, imbc.id, `${randomUUID()}@unlock.local`],
    );
    boss = new PgBoss({
      connectionString: process.env.TEST_DATABASE_URL!,
      schema: 'pgboss_auth_test',
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.createQueue(QUEUES.notify);
  });
  afterAll(async () => {
    await boss?.stop();
    await pool?.end();
  });
  const fixture = async (verified = false) => {
    const g = await seedProfileGraph(pool);
    const accountId = randomUUID();
    await pool.query(
      "insert into user_accounts (id,organization_id,role,state,email) values ($1,$2,'manufacturer','active',$3)",
      [accountId, g.org, `${randomUUID()}@unlock.local`],
    );
    let assignmentId = '';
    let contactRevision = g.revisions.contacts!;
    await db.transaction(async (tx) => {
      for (const kind of SECTION_KINDS)
        await captureRevisionFileVersions(tx, { sectionRevisionId: g.revisions[kind]!, organizationId: g.org });
      await tx.execute(sql`update profile_section set working_revision_id=null where profile_id=${g.profile}`);
      await tx.execute(
        sql`update section_revision set state='submitted',submitted_at=now() where organization_id=${g.org}`,
      );
      if (verified) {
        await tx.execute(sql`update section_revision set state='verified' where organization_id=${g.org}`);
        await tx.execute(
          sql`update profile_section s set verified_revision_id=r.id from section_revision r where r.profile_section_id=s.id and s.profile_id=${g.profile}`,
        );
        const contact = (
          await tx.execute<{ id: string }>(
            sql`select id from profile_section where profile_id=${g.profile} and kind='contacts'`,
          )
        ).rows[0]!;
        const revision = (
          await tx.execute<{
            id: string;
          }>(sql`insert into section_revision (profile_section_id,organization_id,revision_number)
          values (${contact.id},${g.org},2) returning id`)
        ).rows[0]!;
        await copyRevisionContent(tx, 'contacts', contactRevision, revision.id, g.org);
        contactRevision = revision.id;
        await tx.execute(sql`update section_revision set state='submitted',submitted_at=now() where id=${revision.id}`);
      }
      const at = new Date();
      const a = (
        await tx
          .insert(schema.reviewAssignment)
          .values({
            profileId: g.profile,
            organizationId: g.org,
            submittedBy: accountId,
            receivedAt: at,
            accuracyConfirmedAt: at,
            submissionMode: verified ? 'verified_changes' : 'initial',
            operationKey: randomUUID(),
            requestFingerprint: 'a'.repeat(64),
            expertId,
            assignedBy: expertId,
            assignedAt: at,
          })
          .returning()
      )[0]!;
      assignmentId = a.id;
      const sections = await tx
        .select()
        .from(schema.profileSection)
        .where(sql`profile_id=${g.profile}`);
      await tx.insert(schema.reviewAssignmentSection).values(
        sections.map((section) => ({
          reviewAssignmentId: a.id,
          profileId: g.profile,
          organizationId: g.org,
          profileSectionId: section.id,
          sectionRevisionId: section.kind === 'contacts' ? contactRevision : g.revisions[section.kind]!,
          reviewRequired: true,
        })),
      );
      await tx.insert(schema.profileSectionCandidate).values(
        sections.map((section) => ({
          reviewAssignmentId: a.id,
          organizationId: g.org,
          profileSectionId: section.id,
          sectionRevisionId: section.kind === 'contacts' ? contactRevision : g.revisions[section.kind]!,
        })),
      );
      await tx.execute(sql`update profile_section set pending_revision_id=case when kind='contacts' then ${contactRevision}::uuid
        when ${verified} then null else (select r.id from section_revision r where r.profile_section_id=profile_section.id) end
        where profile_id=${g.profile}`);
      await tx.execute(sql`update manufacturer_profile set status=${verified ? 'verified' : 'submitted'}::profile_status,
        has_pending_changes=${verified},accuracy_confirmed_at=${at},assigned_expert_id=${expertId} where id=${g.profile}`);
    });
    const service = new ProfileUnlockService(pool, new AuditService(db), boss);
    const http = await startHttp({
      controllers: [ProfileUnlockController, ProfileSubmissionStateController],
      providers: [
        { provide: ProfileUnlockService, useValue: service },
        {
          provide: ProfileSubmissionStateService,
          useValue: new ProfileSubmissionStateService(pool, new AuditService(db)),
        },
      ],
      organizationId: g.org,
      accountIds: { manufacturer: accountId, expert: expertId },
    });
    return {
      ...g,
      accountId,
      assignmentId,
      contactRevision,
      service,
      http,
      input: { operationKey: randomUUID(), expectedAssignmentId: assignmentId },
    };
  };
  const jobs = async (profile: string) =>
    (await boss.findJobs(QUEUES.notify)).filter((job) => (job.data as { profileId?: string }).profileId === profile);
  const decision = async (g: Awaited<ReturnType<typeof fixture>>, outcome: 'verified' | 'rejected') =>
    pool.query(
      `insert into review_decision
    (review_assignment_id,organization_id,expert_id,profile_section_id,subject_revision_id,section_revision_id,outcome,comment,decided_at)
    select $1,$2,$3,id,$4,$4,$5::record_status,$6,now() from profile_section where profile_id=$7 and kind='contacts' returning id`,
      [
        g.assignmentId,
        g.org,
        expertId,
        g.contactRevision,
        outcome,
        outcome === 'rejected' ? 'Please correct' : null,
        g.profile,
      ],
    );

  it('reads only the own active assignment and clears that lifecycle context after Unlock', async () => {
    const g = await fixture();
    const other = await fixture();
    try {
      expect(
        await (await g.http.get(`/api/v1/profiles/own/submission?profileId=${other.profile}`, 'manufacturer')).json(),
      ).toEqual({
        profileId: g.profile,
        profileStatus: 'submitted',
        activeAssignmentId: g.assignmentId,
        hasUnsubmittedChanges: false,
      });
      expect((await g.http.get('/api/v1/profiles/own/submission', 'expert')).status).toBe(403);
      await g.http.send('POST', ROOT, 'manufacturer', g.input);
      expect(await (await g.http.get('/api/v1/profiles/own/submission', 'manufacturer')).json()).toEqual({
        profileId: g.profile,
        profileStatus: 'draft',
        activeAssignmentId: null,
        hasUnsubmittedChanges: false,
      });
    } finally {
      await g.http.close();
      await other.http.close();
    }
  });

  it('closes the exact sent assignment, preserves seven frozen candidates and queues NOT-10', async () => {
    const g = await fixture();
    try {
      const response = await g.http.send('POST', ROOT, 'manufacturer', g.input);
      expect(response.status).toBe(201);
      expect(profileUnlockResultSchema.parse(await response.json())).toMatchObject({
        profileId: g.profile,
        profileStatus: 'draft',
        assignmentId: g.assignmentId,
      });
      expect(
        (await pool.query('select status,has_pending_changes from manufacturer_profile where id=$1', [g.profile]))
          .rows[0],
      ).toMatchObject({ status: 'draft', has_pending_changes: false });
      expect(
        (
          await pool.query(
            'select count(*)::int as count from profile_section where profile_id=$1 and pending_revision_id is not null',
            [g.profile],
          )
        ).rows[0]!.count,
      ).toBe(0);
      expect(
        (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org }))
          .map((section) => section.revisionId)
          .sort(),
      ).toEqual(Object.values(g.revisions).sort());
      expect(
        (await pool.query('select state from section_revision where organization_id=$1', [g.org])).rows.every(
          (row) => row.state === 'submitted',
        ),
      ).toBe(true);
      expect((await jobs(g.profile)).map((job) => job.data)).toEqual([
        {
          rule: 'NOT-10',
          eventKey: `profile-unlocked:${g.assignmentId}`,
          profileId: g.profile,
          organizationId: g.org,
          related: { type: 'review_assignment', id: g.assignmentId },
          params: {},
        },
      ]);
      expect(
        (
          await pool.query('select closed_by,expert_id,close_reason from review_assignment where id=$1', [
            g.assignmentId,
          ])
        ).rows[0],
      ).toEqual({ closed_by: g.accountId, expert_id: expertId, close_reason: 'manufacturer_unlock' });
    } finally {
      await g.http.close();
    }
  });
  it('replays the same key without a second audit or job and rejects conflicting closure requests', async () => {
    const g = await fixture();
    try {
      const first = await (await g.http.send('POST', ROOT, 'manufacturer', g.input)).json();
      expect(await (await g.http.send('POST', ROOT, 'manufacturer', g.input)).json()).toEqual(first);
      expect(await jobs(g.profile)).toHaveLength(1);
      expect(
        (
          await pool.query(
            "select count(*)::int as count from audit_entries where object_id=$1 and action='profile.unlock'",
            [g.assignmentId],
          )
        ).rows[0]!.count,
      ).toBe(1);
      expect(
        await (await g.http.send('POST', ROOT, 'manufacturer', { ...g.input, operationKey: randomUUID() })).json(),
      ).toMatchObject({ code: 'assignment_changed' });
      expect(
        await (
          await g.http.send('POST', ROOT, 'manufacturer', { ...g.input, expectedAssignmentId: randomUUID() })
        ).json(),
      ).toMatchObject({ code: 'operation_conflict' });
    } finally {
      await g.http.close();
    }
  });
  it('keeps published Verified pointers while retaining the accepted pending candidate', async () => {
    const g = await fixture(true);
    try {
      const accepted = (await decision(g, 'verified')).rows[0]!.id;
      const response = await g.http.send('POST', ROOT, 'manufacturer', g.input);
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ profileStatus: 'verified' });
      expect(
        (
          await pool.query(
            "select verified_revision_id,pending_revision_id from profile_section where profile_id=$1 and kind='contacts'",
            [g.profile],
          )
        ).rows[0],
      ).toEqual({ verified_revision_id: g.revisions.contacts, pending_revision_id: null });
      expect(
        (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org })).find(
          (section) => section.kind === 'contacts',
        ),
      ).toMatchObject({ revisionId: g.contactRevision, acceptedDecisionId: accepted });
      expect(
        (await pool.query('select state from section_revision where id=$1', [g.contactRevision])).rows[0]!.state,
      ).toBe('submitted');
    } finally {
      await g.http.close();
    }
  });
  it('preserves rejected history but never keeps an older acceptance after a later rejection', async () => {
    const g = await fixture();
    try {
      await decision(g, 'verified');
      await decision(g, 'rejected');
      expect((await g.http.send('POST', ROOT, 'manufacturer', g.input)).status).toBe(201);
      expect(
        (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org })).find(
          (section) => section.kind === 'contacts',
        )!.acceptedDecisionId,
      ).toBeNull();
      expect(
        (
          await pool.query(
            'select outcome,comment from review_decision where review_assignment_id=$1 order by decision_order',
            [g.assignmentId],
          )
        ).rows,
      ).toEqual([
        { outcome: 'verified', comment: null },
        { outcome: 'rejected', comment: 'Please correct' },
      ]);
    } finally {
      await g.http.close();
    }
  });
  it('rejects foreign assignments, selectors, SME actions and blocked manufacturers', async () => {
    const g = await fixture();
    const other = await fixture();
    try {
      expect(
        (await g.http.send('POST', ROOT, 'manufacturer', { ...g.input, expectedAssignmentId: other.assignmentId }))
          .status,
      ).toBe(409);
      expect((await g.http.send('POST', ROOT, 'manufacturer', { ...g.input, profileId: other.profile })).status).toBe(
        400,
      );
      expect((await g.http.send('POST', ROOT, 'expert', g.input)).status).toBe(403);
      await pool.query("update user_accounts set state='blocked' where id=$1", [g.accountId]);
      expect((await g.http.send('POST', ROOT, 'manufacturer', g.input)).status).toBe(403);
      expect(
        (await pool.query('select closed_at from review_assignment where id=$1', [g.assignmentId])).rows[0]!.closed_at,
      ).toBeNull();
      expect(await jobs(g.profile)).toHaveLength(0);
    } finally {
      await g.http.close();
      await other.http.close();
    }
  });
  it('serializes two Unlocks into one closure and one queued event', async () => {
    const g = await fixture();
    try {
      const responses = await Promise.all([
        g.http.send('POST', ROOT, 'manufacturer', g.input),
        g.http.send('POST', ROOT, 'manufacturer', { ...g.input, operationKey: randomUUID() }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(await jobs(g.profile)).toHaveLength(1);
    } finally {
      await g.http.close();
    }
  });
  it('rolls back profile, pointers, candidate hints, audit and closure when enqueue fails', async () => {
    const g = await fixture();
    try {
      const account = (
        await pool.query('select id,email,organization_id from user_accounts where id=$1', [g.accountId])
      ).rows[0]!;
      const broken = new ProfileUnlockService(pool, new AuditService(db), {
        send: async () => {
          throw new Error('Controlled queue failure');
        },
      } as unknown as PgBoss);
      await expect(
        broken.unlock(
          {
            id: account.id,
            email: account.email,
            fullName: null,
            organizationId: account.organization_id,
            organizationType: 'manufacturer',
            role: 'manufacturer',
            locale: 'en',
          },
          g.input,
        ),
      ).rejects.toThrow('Controlled queue failure');
      expect(
        (await pool.query('select closed_at from review_assignment where id=$1', [g.assignmentId])).rows[0]!.closed_at,
      ).toBeNull();
      expect(
        (await pool.query('select status from manufacturer_profile where id=$1', [g.profile])).rows[0]!.status,
      ).toBe('submitted');
      expect(
        (
          await pool.query(
            'select count(*)::int as count from profile_section where profile_id=$1 and pending_revision_id is not null',
            [g.profile],
          )
        ).rows[0]!.count,
      ).toBe(7);
      expect(
        (
          await pool.query(
            "select count(*)::int as count from audit_entries where object_id=$1 and action='profile.unlock'",
            [g.assignmentId],
          )
        ).rows[0]!.count,
      ).toBe(0);
    } finally {
      await g.http.close();
    }
  });
});
