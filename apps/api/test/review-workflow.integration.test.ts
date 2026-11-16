import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  ROLES,
  SECTION_KINDS,
  reviewWorkbenchSchema,
  reviewSectionReadSchema,
  type SectionKind,
  type ReviewWorkbench,
  type ContactsWrite,
  type PersonnelWrite,
  type Role,
} from '@imbc/contracts';
import { NestFactory } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { profileCandidateRevisions } from '../src/modules/profiles/profile-candidate.js';
import { ProfileReviewService } from '../src/modules/profiles/profile-review.service.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { ProfileUnlockService } from '../src/modules/profiles/profile-unlock.service.js';
import {
  ReviewActionsController,
  ReviewAssignmentMetadataController,
} from '../src/modules/reviews/review-actions.controller.js';
import { ReviewAssignmentService } from '../src/modules/reviews/review-assignment.service.js';
import { ReviewWorkbenchService } from '../src/modules/reviews/review-workbench.service.js';
import { ReviewsService } from '../src/modules/reviews/reviews.service.js';
import {
  loadReviewResultNotification,
  REVIEW_RESULT_NOTIFICATION_SCHEMA,
} from '../src/modules/reviews/review-result-notification.js';
import { notifyJobSchema, type NotifyJob } from '../src/notifications/enqueue.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';
import { ORGANIZATION_TYPE } from './support/organization-type.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Stage5 actual HTTP workbench and atomic review lifecycle', () => {
  vi.setConfig({ hookTimeout: 60_000, testTimeout: 30_000 });
  let pool: pg.Pool, appPool: pg.Pool, db: Database, boss: PgBoss, http: HttpStand;
  let assignments: ReviewAssignmentService,
    workbench: ReviewWorkbenchService,
    submit: ProfileSubmitService,
    editor: ProfileSectionsService,
    unlock: ProfileUnlockService,
    core: ProfileReviewService;
  let expert: AuthUser, other: AuthUser, admin: AuthUser;
  const actors = {} as Record<Role, AuthUser>;
  const role = `stage5_workflow_${randomUUID().replaceAll('-', '')}`;
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
  const ready = async (open = true) => {
    const g = await seedSubmissionProfile(pool),
      sent = await send(g);
    await assignments.take(expert, sent.assignmentId);
    if (open) await workbench.open(expert, sent.assignmentId);
    return { g, sent };
  };
  const batch = (
    section: ReviewWorkbench['sections'][number],
    outcome: 'verified' | 'rejected' = 'verified',
    comment: string | null = null,
  ) => ({
    sectionRevisionId: section.revisionId,
    expectedDecisionId: section.decision?.id ?? null,
    outcome,
    comment,
    items: section.items
      .filter((item) => item.subject.kind !== 'file')
      .map((item) => ({ subject: item.subject, outcome })),
  });
  const decideAll = async (assignmentId: string, rejected: SectionKind[] = []) => {
    const view = await workbench.read(expert, assignmentId);
    for (const section of view.sections.filter((section) => section.reviewRequired))
      await workbench.decideSection(
        expert,
        assignmentId,
        batch(
          section,
          rejected.includes(section.kind) ? 'rejected' : 'verified',
          rejected.includes(section.kind) ? 'Correct this section together' : null,
        ),
      );
  };
  const snapshot = async (assignmentId: string) => ({
    decisions: (
      await pool.query('select to_jsonb(d) as value from review_decision d where review_assignment_id=$1 order by id', [
        assignmentId,
      ])
    ).rows,
    audits: (
      await pool.query("select to_jsonb(a) as value from audit_entries a where diff->>'assignmentId'=$1 order by id", [
        assignmentId,
      ])
    ).rows,
  });
  const editContact = async (g: Fixture, name: string) => {
    const read = await editor.read(g.actor, 'contacts');
    const candidate = (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org })).find(
      (c) => c.kind === 'contacts',
    )!;
    const handler = submissionHandlers().find((h) => h.kind === 'contacts')!;
    const data = (await handler.editable(db, {
      profileId: g.profile,
      organizationId: g.org,
      sectionId: candidate.sectionId,
      revisionId: candidate.revisionId!,
    })) as ContactsWrite;
    data.contacts[0]!.fullName = name;
    await editor.save(g.actor, 'contacts', { editVersion: read.editVersion, data });
  };
  const editPersonnel = async (g: Fixture) => {
    const read = await editor.read(g.actor, 'personnel');
    const candidate = (await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org })).find(
      (c) => c.kind === 'personnel',
    )!;
    const data = (await submissionHandlers()
      .find((h) => h.kind === 'personnel')!
      .editable(db, {
        profileId: g.profile,
        organizationId: g.org,
        sectionId: candidate.sectionId,
        revisionId: candidate.revisionId!,
      })) as PersonnelWrite;
    data.managersCount = (data.managersCount ?? 0) + 1;
    await editor.save(g.actor, 'personnel', { editVersion: read.editVersion, data });
  };
  const unlockSend = async (g: Fixture, assignmentId: string) => {
    await unlock.unlock(g.actor, { operationKey: randomUUID(), expectedAssignmentId: assignmentId });
    return send(g);
  };
  const resultJob = async (assignmentId: string): Promise<NotifyJob> => {
    const jobs = (
      await pool.query(
        "select data from pgboss_auth_test.job where name=$1 and data->'related'->>'id'=$2 and data->>'rule'='NOT-05'",
        [QUEUES.notify, assignmentId],
      )
    ).rows;
    expect(jobs).toHaveLength(1);
    return notifyJobSchema.parse(jobs[0].data);
  };
  const resultContext = (job: NotifyJob) =>
    loadReviewResultNotification(drizzle(appPool, { schema: s, casing: 'snake_case' }), job);
  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
    const imbc = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
    const account = async (roleName: Role): Promise<AuthUser> => {
      const organization =
        ORGANIZATION_TYPE[roleName] === 'imbc'
          ? imbc
          : (
              await db
                .insert(s.organizations)
                .values({ type: ORGANIZATION_TYPE[roleName], name: `Synthetic ${roleName} ${randomUUID()}` })
                .returning()
            )[0]!;
      const row = (
        await db
          .insert(s.userAccounts)
          .values({
            organizationId: organization.id,
            role: roleName,
            state: 'active',
            email: `${randomUUID()}@workflow.local`,
          })
          .returning()
      )[0]!;
      return {
        id: row.id,
        organizationId: organization.id,
        organizationType: organization.type,
        role: roleName,
        email: row.email,
        fullName: null,
        locale: 'en',
      };
    };
    for (const roleName of ROLES) actors[roleName] = await account(roleName);
    expert = actors.expert;
    other = await account('expert');
    admin = actors.administrator;
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
    assignments = new ReviewAssignmentService(appPool, audit);
    core = new ProfileReviewService(appPool, audit, boss);
    workbench = new ReviewWorkbenchService(core, audit, submissionHandlers());
    submit = new ProfileSubmitService(appPool, audit, boss, submissionHandlers());
    editor = new ProfileSectionsService(appPool, audit, submissionHandlers());
    unlock = new ProfileUnlockService(appPool, audit, boss);
    http = await startHttp({
      controllers: [ReviewActionsController, ReviewAssignmentMetadataController],
      providers: [
        { provide: ReviewAssignmentService, useValue: assignments },
        { provide: ReviewWorkbenchService, useValue: workbench },
      ],
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

  it('constructs every real AppModule review provider and controller without substituting review services', async () => {
    const values: Record<string, string> = {
      NODE_ENV: 'test',
      DEPLOYMENT_ENV: 'development',
      LOG_LEVEL: 'fatal',
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      PGBOSS_SCHEMA: 'pgboss_auth_test',
      PUBLIC_URL: 'http://127.0.0.1:3000',
      VALKEY_URL: 'redis://127.0.0.1:1',
      S3_ENDPOINT: 'http://127.0.0.1:1',
      S3_ACCESS_KEY: 'synthetic-local',
      S3_SECRET_KEY: 'synthetic-local',
      OIDC_ISSUER: 'http://127.0.0.1:1/realms/local',
      OIDC_CLIENT_SECRET: 'synthetic-local',
      KEYCLOAK_ADMIN_CLIENT_SECRET: 'synthetic-local',
      SESSION_SECRET: 'synthetic-only-local-secret-32-characters',
      SMTP_URL: 'smtp://127.0.0.1:1',
      COOKIE_SECURE: 'false',
      DEV_FIXED_OTP_ENABLED: 'false',
      DEV_FIXED_OTP_USER_ID: '',
      DEV_FIXED_OTP_ACCOUNTS: '[]',
    };
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    Object.assign(process.env, values);
    try {
      // NestFactory.create instantiates the complete real provider graph. No app.init/listen: client
      // lifecycle calls to SMTP/Valkey/OIDC are outside this DI proof; HTTP is proved below separately.
      const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
      try {
        for (const provider of [
          ReviewsService,
          ReviewAssignmentService,
          ReviewWorkbenchService,
          ProfileReviewService,
          ReviewActionsController,
          ReviewAssignmentMetadataController,
        ])
          expect(app.get(provider)).toBeInstanceOf(provider);
      } finally {
        await app.close();
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  it('separates take, initial metadata read and explicit open, with no notification on take/open', async () => {
    const g = await seedSubmissionProfile(pool),
      sent = await send(g),
      path = `/api/v1/reviews/assignments/${sent.assignmentId}`;
    const jobs = (await pool.query('select count(*)::integer as n from pgboss_auth_test.job')).rows[0].n;
    expect((await http.send('POST', `${path}/take`, 'expert', {})).status).toBe(201);
    const first = reviewWorkbenchSchema.parse(await (await http.get(path, 'expert')).json());
    expect(first.profileStatus).toBe('submitted');
    expect(first.sections).toHaveLength(7);
    const closed = await http.get(`${path}/sections/contacts`, 'expert');
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ code: 'review_not_opened' });
    const unopened = await http.send('POST', `${path}/section-decision`, 'expert', batch(first.sections[0]!));
    expect(unopened.status).toBe(409);
    const opened = reviewWorkbenchSchema.parse(await (await http.send('POST', `${path}/open`, 'expert', {})).json());
    expect(opened.profileStatus).toBe('under_review');
    expect((await pool.query('select count(*)::integer as n from pgboss_auth_test.job')).rows[0].n).toBe(jobs);
    expect(
      (
        await pool.query("select diff from audit_entries where action='review.open' and object_id=$1", [
          sent.assignmentId,
        ])
      ).rows[0].diff,
    ).toMatchObject({ before: { status: 'submitted' }, after: { status: 'under_review' } });
  });
  it.each(ROLES)('HTTP gives %s only the exact role and assigned-SME workflow', async (roleName) => {
    const { sent } = await ready(),
      path = `/api/v1/reviews/assignments/${sent.assignmentId}`;
    const roleHttp = await startHttp({
      controllers: [ReviewActionsController, ReviewAssignmentMetadataController],
      providers: [
        { provide: ReviewAssignmentService, useValue: assignments },
        { provide: ReviewWorkbenchService, useValue: workbench },
      ],
      organizationId: actors[roleName].organizationId,
      accountIds: { [roleName]: actors[roleName].id },
    });
    try {
      const read = await roleHttp.get(`${path}/sections/contacts`, roleName);
      expect(read.status).toBe(roleName === 'expert' ? 200 : 403);
      const meta = await roleHttp.get(`/api/v1/reviews/assignment-queue/${sent.assignmentId}`, roleName);
      expect(meta.status).toBe(roleName === 'administrator' ? 200 : 403);
      const result = await roleHttp.send('POST', `${path}/submit-result`, roleName, {});
      expect(result.status).toBe(roleName === 'expert' ? 409 : 403);
    } finally {
      await roleHttp.close();
    }
  });
  it('reads all seven exact frozen handlers, retained role labels, numeric precision and captured file versions', async () => {
    const { g, sent } = await ready();
    const contactRole = (
      await pool.query('select role_id from contact where section_revision_id=$1 limit 1', [g.revisions.contacts])
    ).rows[0].role_id;
    await pool.query('update dictionary_entry set retired_at=clock_timestamp() where id=$1', [contactRole]);
    try {
      const reads = await Promise.all(
        SECTION_KINDS.map(async (kind) =>
          reviewSectionReadSchema.parse(
            await (
              await http.get(`/api/v1/reviews/assignments/${sent.assignmentId}/sections/${kind}`, 'expert')
            ).json(),
          ),
        ),
      );
      expect(reads.map((read) => read.revisionId)).toEqual(SECTION_KINDS.map((kind) => g.revisions[kind]));
      const contacts = reads.find((read) => read.kind === 'contacts')!;
      if (contacts.kind !== 'contacts') throw new Error('Wrong section');
      expect(contacts.selectedContactRoles).toContainEqual(expect.objectContaining({ id: contactRole, retired: true }));
      expect(JSON.stringify(reads.find((read) => read.kind === 'products')!.data)).toContain('9007199254740993');
      const personnel = reads.find((read) => read.kind === 'personnel')!;
      const fileId = personnel.items.find((item) => item.subject.kind === 'file')!.fileObjectId!;
      const prior = (
        await pool.query('select * from file_version where file_object_id=$1 order by version_number desc limit 1', [
          fileId,
        ])
      ).rows[0];
      await pool.query(
        'insert into file_version(file_object_id,version_number,original_name,byte_size,declared_media_type,checksum,storage_key,scan_state) values($1,2,$2,1,$3,$4,$5,$6)',
        [fileId, 'CURRENT-NOT-FROZEN.pdf', prior.declared_media_type, 'local', randomUUID(), 'passed'],
      );
      const frozen = await workbench.section(expert, sent.assignmentId, 'personnel');
      expect(JSON.stringify(frozen)).not.toContain('CURRENT-NOT-FROZEN.pdf');
      expect(JSON.stringify(frozen.data)).toContain('"versionNumber":1');
    } finally {
      await pool.query('update dictionary_entry set retired_at=null where id=$1', [contactRole]);
    }
  });
  it('writes one section intent with all held documents and one server-derived rejection comment', async () => {
    const { sent } = await ready();
    const section = (await workbench.read(expert, sent.assignmentId)).sections.find((s) => s.kind === 'documents')!;
    const result = await workbench.decideSection(
      expert,
      sent.assignmentId,
      batch(section, 'rejected', 'Correct both document attachments'),
    );
    expect(result.decisions).toHaveLength(3);
    expect(result.decisions.every((decision) => decision.comment === 'Correct both document attachments')).toBe(true);
    const next = await workbench.section(expert, sent.assignmentId, 'documents');
    expect(next.decision?.id).toBe(result.decisions.at(-1)!.id);
    expect(
      next.items
        .filter((item) => item.subject.kind === 'document')
        .every((item) => item.decision?.outcome === 'rejected'),
    ).toBe(true);
    const before = await snapshot(sent.assignmentId);
    await expect(workbench.decideSection(expert, sent.assignmentId, batch(section))).rejects.toMatchObject({
      code: 'review_section_changed',
    });
    expect(await snapshot(sent.assignmentId)).toEqual(before);
    await workbench.decideSection(expert, sent.assignmentId, batch(next));
    const history = (
      await pool.query(
        "select diff from audit_entries where action='review.decide' and diff->>'assignmentId'=$1 and diff->'subject'->>'kind'='section' order by at desc",
        [sent.assignmentId],
      )
    ).rows;
    expect(history[0].diff.before.id).toBe(next.decision!.id);
    expect(history[0].diff.after.outcome).toBe('verified');
  });
  it('refuses omitted, foreign, duplicate and ISO-absence decisions without writing any partial result', async () => {
    const { g, sent } = await ready(),
      foreign = await seedSubmissionProfile(pool);
    const view = await workbench.read(expert, sent.assignmentId),
      docs = view.sections.find((s) => s.kind === 'documents')!,
      certs = view.sections.find((s) => s.kind === 'certificates')!;
    const before = await snapshot(sent.assignmentId);
    await expect(
      workbench.decideSection(expert, sent.assignmentId, { ...batch(docs), items: [] }),
    ).rejects.toMatchObject({ code: 'review_items_incomplete' });
    await expect(
      workbench.decideSection(expert, sent.assignmentId, {
        ...batch(docs),
        items: [
          ...batch(docs).items,
          { subject: { kind: 'document', documentId: String(foreign.rows.document!.id) }, outcome: 'verified' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'review_subject_not_found' });
    const duplicate = await http.send(
      'POST',
      `/api/v1/reviews/assignments/${sent.assignmentId}/section-decision`,
      'expert',
      { ...batch(docs), items: [batch(docs).items[0], batch(docs).items[0]] },
    );
    expect(duplicate.status).toBe(400);
    const absence = (
      await pool.query('select id from certificate where organization_id=$1 and not_held limit 1', [g.org])
    ).rows[0].id;
    expect(certs.items.filter((item) => item.subject.kind === 'certificate')).toHaveLength(1);
    await expect(
      workbench.decideSection(expert, sent.assignmentId, {
        ...batch(certs),
        items: [
          ...batch(certs).items,
          { subject: { kind: 'certificate', certificateId: absence }, outcome: 'verified' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'review_subject_not_found' });
    expect(await snapshot(sent.assignmentId)).toEqual(before);
  });
  it('rolls back a rejected file and all item writes if later verification conflicts with it', async () => {
    const { sent } = await ready(),
      docs = (await workbench.read(expert, sent.assignmentId)).sections.find((s) => s.kind === 'documents')!;
    const before = await snapshot(sent.assignmentId),
      file = docs.items.find((item) => item.subject.kind === 'file')!;
    await expect(
      workbench.decideSection(expert, sent.assignmentId, {
        ...batch(docs),
        comment: 'File cannot be accepted',
        items: [...batch(docs).items, { subject: file.subject, outcome: 'rejected' }],
      }),
    ).rejects.toMatchObject({ code: 'review_incomplete' });
    expect(await snapshot(sent.assignmentId)).toEqual(before);
  });
  it('exposes a failed captured scan safely and refuses verification without appending partial decisions', async () => {
    const { sent } = await ready();
    const docs = (await workbench.read(expert, sent.assignmentId)).sections.find(
      (section) => section.kind === 'documents',
    )!;
    const file = docs.items.find((item) => item.subject.kind === 'file')!;
    if (file.subject.kind !== 'file') throw new Error('Missing captured file');
    await pool.query("update file_version set scan_state='rejected',rejection_reason='malware' where id=$1", [
      file.subject.fileVersionId,
    ]);
    const before = await snapshot(sent.assignmentId);
    const read = await workbench.section(expert, sent.assignmentId, 'documents');
    expect(JSON.stringify(read.data)).toContain('"canDownload":false');
    await expect(workbench.decideSection(expert, sent.assignmentId, batch(docs))).rejects.toMatchObject({
      code: 'submission_file_unavailable',
    });
    expect(await snapshot(sent.assignmentId)).toEqual(before);
  });
  it('rolls back every decision and audit if the final section audit fails in PostgreSQL', async () => {
    const { sent } = await ready(),
      docs = (await workbench.read(expert, sent.assignmentId)).sections.find((s) => s.kind === 'documents')!,
      before = await snapshot(sent.assignmentId);
    await pool.query(
      "create function stage5_fail_section_audit() returns trigger language plpgsql as $$ begin if new.action='review.decide' and new.diff->'subject'->>'kind'='section' then raise exception 'synthetic audit failure'; end if; return new; end $$",
    );
    await pool.query(
      'create trigger stage5_fail_section_audit before insert on audit_entries for each row execute function stage5_fail_section_audit()',
    );
    try {
      await expect(workbench.decideSection(expert, sent.assignmentId, batch(docs))).rejects.toBeDefined();
    } finally {
      await pool.query('drop trigger stage5_fail_section_audit on audit_entries');
      await pool.query('drop function stage5_fail_section_audit()');
    }
    expect(await snapshot(sent.assignmentId)).toEqual(before);
  });
  it('revalidates exact persisted read/verify policies and actor state, recording safe route denials', async () => {
    const { sent } = await ready(),
      contact = (await workbench.read(expert, sent.assignmentId)).sections.find((s) => s.kind === 'contacts')!;
    await pool.query("update policy_rule set effect='deny' where role='expert' and action='profile.verify'");
    try {
      expect((await workbench.read(expert, sent.assignmentId)).assignment.id).toBe(sent.assignmentId);
      await expect(workbench.decideSection(expert, sent.assignmentId, batch(contact))).rejects.toMatchObject({
        code: 'forbidden',
      });
    } finally {
      await pool.query("update policy_rule set effect='allow' where role='expert' and action='profile.verify'");
    }
    await pool.query("update user_accounts set state='blocked' where id=$1", [expert.id]);
    try {
      await expect(workbench.section(expert, sent.assignmentId, 'contacts')).rejects.toMatchObject({
        code: 'forbidden',
      });
    } finally {
      await pool.query("update user_accounts set state='active' where id=$1", [expert.id]);
    }
    const denial = (
      await pool.query(
        "select action,object_id from audit_entries where user_id=$1 and outcome='denied' and object_type='route'",
        [expert.id],
      )
    ).rows;
    expect(denial).toContainEqual({
      action: 'profile.verify',
      object_id: 'v1/reviews/assignments/:id/section-decision',
    });
    expect(denial).toContainEqual({ action: 'profile.read', object_id: 'v1/reviews/assignments/:id/sections/:kind' });
  });
  it('serializes concurrent section CAS decisions and revokes the old SME immediately on reassign', async () => {
    const { sent } = await ready(),
      contact = (await workbench.read(expert, sent.assignmentId)).sections.find((s) => s.kind === 'contacts')!;
    const outcomes = await Promise.allSettled([
      workbench.decideSection(expert, sent.assignmentId, batch(contact)),
      workbench.decideSection(expert, sent.assignmentId, batch(contact, 'rejected', 'Change the contact details')),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find((outcome) => outcome.status === 'rejected')!;
    if (failed.status === 'rejected') expect(failed.reason).toMatchObject({ code: 'review_section_changed' });
    const before = await snapshot(sent.assignmentId);
    await assignments.assign(admin, sent.assignmentId, { expertId: other.id, expectedExpertId: expert.id });
    await expect(workbench.open(expert, sent.assignmentId)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(workbench.decideSection(expert, sent.assignmentId, batch(contact))).rejects.toMatchObject({
      code: 'forbidden',
    });
    const fresh = await workbench.open(other, sent.assignmentId);
    expect(fresh.sections.find((s) => s.kind === 'contacts')!.decision).not.toBeNull();
    expect((await snapshot(sent.assignmentId)).decisions).toEqual(before.decisions);
  });
  it('serializes administrator assignment against an unassigned SME take without fabricating two winners', async () => {
    const g = await seedSubmissionProfile(pool),
      sent = await send(g);
    const outcomes = await Promise.allSettled([
      assignments.take(expert, sent.assignmentId),
      assignments.assign(admin, sent.assignmentId, { expertId: other.id, expectedExpertId: null }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const fresh = await assignments.readMetadata(admin, sent.assignmentId);
    expect(fresh.assignedExpertId).toBe(outcomes[0]!.status === 'fulfilled' ? expert.id : other.id);
    expect(fresh.status).toBe('submitted');
    const profile = (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile)))[0]!;
    expect(profile.assignedExpertId).toBe(fresh.assignedExpertId);
  });
  it.each(['open', 'decide'] as const)(
    'serializes an administrator reassign against the previous SME %s',
    async (action) => {
      const { sent } = await ready(action === 'decide');
      const view = await workbench.read(expert, sent.assignmentId),
        contact = view.sections.find((s) => s.kind === 'contacts')!;
      const outcomes = await Promise.allSettled([
        action === 'open'
          ? workbench.open(expert, sent.assignmentId)
          : workbench.decideSection(expert, sent.assignmentId, batch(contact)),
        assignments.assign(admin, sent.assignmentId, { expertId: other.id, expectedExpertId: expert.id }),
      ]);
      expect(outcomes[1]!.status).toBe('fulfilled');
      if (outcomes[0]!.status === 'rejected') expect(outcomes[0].reason).toMatchObject({ code: 'forbidden' });
      const fresh = await workbench.open(other, sent.assignmentId);
      expect(fresh.assignment.expertId).toBe(other.id);
      if (action === 'decide')
        expect(fresh.sections.find((s) => s.kind === 'contacts')!.decision !== null).toBe(
          outcomes[0]!.status === 'fulfilled',
        );
      await expect(workbench.read(expert, sent.assignmentId)).rejects.toMatchObject({ code: 'forbidden' });
    },
  );
  it('retains decisions, assignment timestamps and receipt time for same-SME administrator reassignment', async () => {
    const { sent } = await ready();
    const view = await workbench.read(expert, sent.assignmentId);
    await workbench.decideSection(expert, sent.assignmentId, batch(view.sections.find((s) => s.kind === 'contacts')!));
    const before = await snapshot(sent.assignmentId),
      assignment = (
        await pool.query('select to_jsonb(a) as value from review_assignment a where id=$1', [sent.assignmentId])
      ).rows[0].value;
    await assignments.assign(admin, sent.assignmentId, { expertId: expert.id, expectedExpertId: expert.id });
    expect(
      (await pool.query('select to_jsonb(a) as value from review_assignment a where id=$1', [sent.assignmentId]))
        .rows[0].value,
    ).toEqual(assignment);
    expect((await snapshot(sent.assignmentId)).decisions).toEqual(before.decisions);
    const audit = (
      await pool.query("select diff from audit_entries where object_id=$1 and action='review.assign'", [
        sent.assignmentId,
      ])
    ).rows[0].diff;
    expect(audit.before).toEqual(audit.after);
  });
  it('uses canonical assignment for authorization and explicit take/assign to repair a stale profile mirror', async () => {
    const { g, sent } = await ready();
    await db
      .update(s.manufacturerProfile)
      .set({ assignedExpertId: other.id })
      .where(eq(s.manufacturerProfile.id, g.profile));
    expect((await workbench.read(expert, sent.assignmentId)).assignment.expertId).toBe(expert.id);
    await expect(workbench.read(other, sent.assignmentId)).rejects.toMatchObject({ code: 'forbidden' });
    await assignments.take(expert, sent.assignmentId);
    expect(
      (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile)))[0]!
        .assignedExpertId,
    ).toBe(expert.id);
    await db
      .update(s.manufacturerProfile)
      .set({ assignedExpertId: other.id })
      .where(eq(s.manufacturerProfile.id, g.profile));
    await expect(
      assignments.assign(admin, sent.assignmentId, { expertId: expert.id, expectedExpertId: other.id }),
    ).rejects.toMatchObject({ code: 'assignment_changed' });
    await assignments.assign(admin, sent.assignmentId, { expertId: expert.id, expectedExpertId: expert.id });
    expect(
      (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile)))[0]!
        .assignedExpertId,
    ).toBe(expert.id);
    const audit = (
      await pool.query("select diff from audit_entries where object_id=$1 and action='review.assign'", [
        sent.assignmentId,
      ])
    ).rows[0].diff;
    expect(audit.before.assignment).toEqual(audit.after.assignment);
    expect(audit.before.profile.assignedExpertId).toBe(other.id);
    expect(audit.after.profile.assignedExpertId).toBe(expert.id);
  });
  it('publishes complete initial acceptance exactly once and keeps every decision immutable', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId);
    expect((await workbench.read(expert, sent.assignmentId)).canSubmitResult).toBe(true);
    const before = await snapshot(sent.assignmentId),
      jobs = (await pool.query('select count(*)::integer as n from pgboss_auth_test.job')).rows[0].n;
    const response = await http.send(
      'POST',
      `/api/v1/reviews/assignments/${sent.assignmentId}/submit-result`,
      'expert',
      {},
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ profileStatus: 'verified' });
    expect(
      (await db.select().from(s.profileSection).where(eq(s.profileSection.profileId, g.profile))).every(
        (s) => s.verifiedRevisionId !== null && s.pendingRevisionId === null,
      ),
    ).toBe(true);
    expect((await pool.query('select count(*)::integer as n from pgboss_auth_test.job')).rows[0].n).toBe(jobs + 1);
    await expect(workbench.submitResult(expert, sent.assignmentId)).rejects.toMatchObject({
      code: 'assignment_changed',
    });
    expect((await snapshot(sent.assignmentId)).decisions).toEqual(before.decisions);
  });
  it('returns an initial rejected section and resubmits with previous SME and unchanged decisions retained', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId, ['contacts']);
    expect(await workbench.submitResult(expert, sent.assignmentId)).toMatchObject({ profileStatus: 'returned' });
    await editContact(g, 'Corrected contact');
    const second = await send(g);
    expect(second.sections.filter((s) => s.reviewRequired).map((s) => s.kind)).toEqual(['contacts']);
    const queue = await workbench.read(expert, second.assignmentId);
    expect(queue.assignment.expertId).toBe(expert.id);
    expect(queue.profileStatus).toBe('submitted');
    await workbench.open(expert, second.assignmentId);
    const retained = queue.sections.find((s) => !s.reviewRequired)!;
    await expect(workbench.decideSection(expert, second.assignmentId, batch(retained))).rejects.toMatchObject({
      code: 'review_section_not_required',
    });
    await decideAll(second.assignmentId);
    expect(await workbench.submitResult(expert, second.assignmentId)).toMatchObject({ profileStatus: 'verified' });
  });
  it('keeps Verified and old published section during pending-change rejection, then accepts only the changed section', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId);
    await workbench.submitResult(expert, sent.assignmentId);
    const original = (
      await db
        .select()
        .from(s.profileSection)
        .where(sql`profile_id=${g.profile} and kind='contacts'`)
    )[0]!.verifiedRevisionId;
    await editContact(g, 'New pending contact');
    const pending = await send(g);
    const opened = await workbench.open(expert, pending.assignmentId);
    expect(opened.profileStatus).toBe('verified');
    expect(opened.hasPendingChanges).toBe(true);
    expect(opened.sections.filter((s) => s.reviewRequired).map((s) => s.kind)).toEqual(['contacts']);
    await decideAll(pending.assignmentId, ['contacts']);
    const rejected = await workbench.submitResult(expert, pending.assignmentId);
    expect(rejected.profileStatus).toBe('verified');
    expect(rejected.publishKinds).not.toContain('contacts');
    expect(
      (
        await db
          .select()
          .from(s.profileSection)
          .where(sql`profile_id=${g.profile} and kind='contacts'`)
      )[0]!.verifiedRevisionId,
    ).toBe(original);
    await editContact(g, 'Accepted new contact');
    const final = await send(g);
    await workbench.open(expert, final.assignmentId);
    await decideAll(final.assignmentId);
    await workbench.submitResult(expert, final.assignmentId);
    const section = (
      await db
        .select()
        .from(s.profileSection)
        .where(sql`profile_id=${g.profile} and kind='contacts'`)
    )[0]!;
    expect(section.verifiedRevisionId).not.toBe(original);
    expect(section.pendingRevisionId).toBeNull();
  });
  it('queues only explicit final decision IDs and loads initial rejection comments from immutable closure', async () => {
    const { g, sent } = await ready();
    const view = await workbench.read(expert, sent.assignmentId);
    const comment = 'Correct <script> markup and analyst@submit.local contact';
    for (const section of view.sections)
      await workbench.decideSection(
        expert,
        sent.assignmentId,
        batch(
          section,
          section.kind === 'contacts' ? 'rejected' : 'verified',
          section.kind === 'contacts' ? comment : null,
        ),
      );
    await workbench.submitResult(expert, sent.assignmentId);
    const job = await resultJob(sent.assignmentId);
    expect(job.params.schema).toBe(REVIEW_RESULT_NOTIFICATION_SCHEMA);
    expect(Object.keys(job.params)).toHaveLength(8);
    expect(JSON.stringify(job.params)).not.toContain(comment);
    expect(JSON.stringify(job.params)).not.toContain(g.actor.email);
    const context = await resultContext(job);
    expect(context).toMatchObject({
      assignmentId: sent.assignmentId,
      profileId: g.profile,
      mode: 'initial',
      status: 'returned',
    });
    expect(context.sections.find((section) => section.kind === 'contacts')).toMatchObject({
      outcome: 'rejected',
      comment,
      publication: 'rejected',
    });
    expect(await resultContext({ ...job, params: {} })).toEqual(context);
  });
  it('refuses forged result IDs, wrong scope, unclosed assignment and ambiguous or missing closure audit', async () => {
    const { sent } = await ready();
    await decideAll(sent.assignmentId);
    await workbench.submitResult(expert, sent.assignmentId);
    const job = await resultJob(sent.assignmentId);
    await expect(resultContext({ ...job, params: { ...job.params, decision_contacts: randomUUID() } })).rejects.toThrow(
      'differs from closure',
    );
    await expect(resultContext({ ...job, organizationId: randomUUID() })).rejects.toThrow(
      'closed result assignment required',
    );
    const active = await ready();
    await expect(
      resultContext({
        ...job,
        params: {},
        profileId: active.g.profile,
        organizationId: active.g.org,
        related: { type: 'review_assignment', id: active.sent.assignmentId },
        eventKey: `profile-review-result:${active.sent.assignmentId}`,
      }),
    ).rejects.toThrow('closed result assignment required');
    const auditId = (
      await pool.query("select id from audit_entries where action='review.submit_result' and object_id=$1", [
        sent.assignmentId,
      ])
    ).rows[0].id;
    const duplicateId = randomUUID();
    await pool.query(
      'insert into audit_entries(id,at,user_id,organization_id,action,object_type,object_id,outcome,diff,is_account_event,ip) select $1,at,user_id,organization_id,action,object_type,object_id,outcome,diff,is_account_event,ip from audit_entries where id=$2',
      [duplicateId, auditId],
    );
    try {
      await expect(resultContext(job)).rejects.toThrow('unique result closure required');
    } finally {
      await pool.query('delete from audit_entries where id=$1', [duplicateId]);
    }
    await pool.query("update audit_entries set action='synthetic.missing' where id=$1", [auditId]);
    try {
      await expect(resultContext({ ...job, params: {} })).rejects.toThrow('unique result closure required');
    } finally {
      await pool.query("update audit_entries set action='review.submit_result' where id=$1", [auditId]);
    }
  });
  it('loads a resubmission mail from its own retained map after a newer working copy and submission', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId, ['contacts']);
    await workbench.submitResult(expert, sent.assignmentId);
    await editContact(g, 'Corrected submission contact');
    const second = await send(g);
    await workbench.open(expert, second.assignmentId);
    await decideAll(second.assignmentId);
    await workbench.submitResult(expert, second.assignmentId);
    const job = await resultJob(second.assignmentId),
      before = await resultContext(job);
    expect(before.mode).toBe('resubmit');
    expect(before.status).toBe('verified');
    expect(before.sections.filter((section) => section.reviewRequired).map((section) => section.kind)).toEqual([
      'contacts',
    ]);
    expect(
      before.sections
        .filter((section) => !section.reviewRequired)
        .every((section) => section.publication === 'published' && !section.notificationRelevant),
    ).toBe(true);
    await editContact(g, 'FUTURE private contact');
    const future = await send(g);
    await workbench.open(expert, future.assignmentId);
    await decideAll(future.assignmentId);
    await workbench.submitResult(expert, future.assignmentId);
    expect(await resultContext(job)).toEqual(before);
    expect(await resultContext({ ...job, params: {} })).toEqual(before);
  });
  it('COWs an unedited rejected candidate on resubmission, publishes the new revision and preserves the old result', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId, ['contacts']);
    await workbench.submitResult(expert, sent.assignmentId);
    const job = await resultJob(sent.assignmentId),
      original = await resultContext(job);
    const previousContact = original.sections.find((section) => section.kind === 'contacts')!;
    const content = (
      await pool.query('select to_jsonb(c) as value from contact c where section_revision_id=$1 order by id', [
        previousContact.revisionId,
      ])
    ).rows;
    const history = await snapshot(sent.assignmentId);
    // Send copies a rejected frozen candidate even when the producer has not manually edited its content.
    const later = await send(g);
    await workbench.open(expert, later.assignmentId);
    const section = (await workbench.read(expert, later.assignmentId)).sections.find(
      (section) => section.kind === 'contacts',
    )!;
    expect(section.revisionId).not.toBe(previousContact.revisionId);
    const decision = await workbench.decideSection(expert, later.assignmentId, batch(section));
    expect(decision.decisions.at(-1)!.id).not.toBe(previousContact.decisionId);
    expect(
      (
        await pool.query('select profile_review_effective_decision($1,$2,$3) as id', [
          g.profile,
          g.org,
          section.revisionId,
        ])
      ).rows[0].id,
    ).toBe(decision.decisions.at(-1)!.id);
    const published = await http.send(
      'POST',
      `/api/v1/reviews/assignments/${later.assignmentId}/submit-result`,
      'expert',
      {},
    );
    expect(published.status).toBe(201);
    expect(await published.json()).toMatchObject({ profileStatus: 'verified' });
    expect(
      (
        await db
          .select()
          .from(s.profileSection)
          .where(sql`profile_id=${g.profile} and kind='contacts'`)
      )[0]!.verifiedRevisionId,
    ).toBe(section.revisionId);
    expect(
      (await pool.query('select state from section_revision where id=$1', [section.revisionId])).rows[0].state,
    ).toBe('verified');
    expect(
      (await pool.query('select state from section_revision where id=$1', [previousContact.revisionId])).rows[0].state,
    ).toBe('rejected');
    expect(
      (
        await pool.query('select to_jsonb(c) as value from contact c where section_revision_id=$1 order by id', [
          previousContact.revisionId,
        ])
      ).rows,
    ).toEqual(content);
    expect((await snapshot(sent.assignmentId)).decisions).toEqual(history.decisions);
    expect(await resultContext(job)).toEqual(original);
    expect(await resultContext({ ...job, params: {} })).toEqual(original);
    expect(await resultContext(await resultJob(later.assignmentId))).toMatchObject({
      mode: 'resubmit',
      status: 'verified',
    });
  });
  it('derives pending-change Verified mail status and only changed rejection from the exact closure', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId);
    await workbench.submitResult(expert, sent.assignmentId);
    await editContact(g, 'Pending rejected contact');
    const pending = await send(g);
    await workbench.open(expert, pending.assignmentId);
    await decideAll(pending.assignmentId, ['contacts']);
    await workbench.submitResult(expert, pending.assignmentId);
    const context = await resultContext(await resultJob(pending.assignmentId));
    expect(context.mode).toBe('verified_changes');
    expect(context.status).toBe('verified');
    expect(context.sections.filter((section) => section.reviewRequired)).toEqual([
      expect.objectContaining({
        kind: 'contacts',
        outcome: 'rejected',
        comment: 'Correct this section together',
        publication: 'rejected',
      }),
    ]);
    expect(context.sections.filter((section) => !section.reviewRequired)).toHaveLength(6);
  });
  it('keeps untouched rejected decisions after Unlock and allows a new active SME to finish without repeating them', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId, ['contacts']);
    const old = await workbench.read(expert, sent.assignmentId);
    const contact = old.sections.find((section) => section.kind === 'contacts')!;
    const history = await snapshot(sent.assignmentId);
    await unlock.unlock(g.actor, { operationKey: randomUUID(), expectedAssignmentId: sent.assignmentId });
    await editPersonnel(g);
    await db.update(s.userAccounts).set({ state: 'blocked' }).where(eq(s.userAccounts.id, expert.id));
    let next;
    try {
      next = await send(g);
      expect(
        (await db.select().from(s.reviewAssignment).where(eq(s.reviewAssignment.id, next.assignmentId)))[0]!.expertId,
      ).toBeNull();
      await assignments.take(other, next.assignmentId);
      const view = await workbench.open(other, next.assignmentId);
      expect(view.sections.find((section) => section.kind === 'contacts')).toMatchObject({
        revisionId: contact.revisionId,
        reviewRequired: false,
        retainedDecisionId: contact.decision!.id,
        decision: contact.decision,
      });
      expect(view.sections.filter((section) => section.reviewRequired).map((section) => section.kind)).toEqual([
        'personnel',
      ]);
      expect(view.canSubmitResult).toBe(false);
      await workbench.decideSection(
        other,
        next.assignmentId,
        batch(view.sections.find((section) => section.kind === 'personnel')!),
      );
      expect((await workbench.read(other, next.assignmentId)).canSubmitResult).toBe(true);
      expect(await workbench.submitResult(other, next.assignmentId)).toMatchObject({ profileStatus: 'returned' });
      const context = await resultContext(await resultJob(next.assignmentId));
      expect(context.sections.filter((section) => section.notificationRelevant)).toEqual([
        expect.objectContaining({
          kind: 'contacts',
          outcome: 'rejected',
          comment: contact.decision!.comment,
          reviewRequired: false,
          publication: 'rejected',
        }),
      ]);
      expect((await snapshot(sent.assignmentId)).decisions).toEqual(history.decisions);
      expect(
        (
          await pool.query('select accepted_decision_id from profile_section_candidate where section_revision_id=$1', [
            contact.revisionId,
          ])
        ).rows[0].accepted_decision_id,
      ).toBeNull();
    } finally {
      await db.update(s.userAccounts).set({ state: 'active' }).where(eq(s.userAccounts.id, expert.id));
    }
  });
  it('retains item-only document, certificate and captured-file decisions through repeated Unlocks', async () => {
    const { g, sent } = await ready();
    const initial = await workbench.read(expert, sent.assignmentId);
    const doc = initial.sections.find((section) => section.kind === 'documents')!;
    const cert = initial.sections.find((section) => section.kind === 'certificates')!;
    const subjects = [
      doc.items.find((item) => item.subject.kind === 'file')!.subject,
      doc.items.find((item) => item.subject.kind === 'document')!.subject,
      cert.items.find((item) => item.subject.kind === 'certificate')!.subject,
    ];
    const retained = [];
    for (const subject of subjects)
      retained.push(await core.decide(expert, sent.assignmentId, { subject, outcome: 'verified', comment: null }));
    const second = await unlockSend(g, sent.assignmentId);
    const secondView = await workbench.open(expert, second.assignmentId);
    for (const original of [doc, cert]) {
      const section = secondView.sections.find((section) => section.kind === original.kind)!;
      expect(section).toMatchObject({
        revisionId: original.revisionId,
        reviewRequired: true,
        retainedDecisionId: null,
        decision: null,
      });
      expect(
        section.items
          .filter((item) => item.decision)
          .map((item) => item.decision!.id)
          .sort(),
      ).toEqual(
        retained
          .filter((decision) =>
            original.items.some((item) => JSON.stringify(item.subject) === JSON.stringify(decision.subject)),
          )
          .map((decision) => decision.id)
          .sort(),
      );
    }
    expect(secondView.canSubmitResult).toBe(false);
    const third = await unlockSend(g, second.assignmentId);
    const thirdView = await workbench.open(expert, third.assignmentId);
    expect(thirdView.sections.find((section) => section.kind === 'documents')!.revisionId).toBe(doc.revisionId);
    expect(
      thirdView.sections
        .flatMap((section) => section.items)
        .filter((item) => item.decision)
        .map((item) => item.decision!.id)
        .sort(),
    ).toEqual(retained.map((decision) => decision.id).sort());
    await decideAll(third.assignmentId);
    expect((await workbench.read(expert, third.assignmentId)).canSubmitResult).toBe(true);
    expect(await workbench.submitResult(expert, third.assignmentId)).toMatchObject({ profileStatus: 'verified' });
    expect(
      (await pool.query('select id from review_decision where review_assignment_id=$1', [second.assignmentId])).rows,
    ).toHaveLength(0);
  });
  it('retains incomplete accepted section CAS and prefers its own completion on the next Unlock', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId);
    const initial = await workbench.read(expert, sent.assignmentId);
    const doc = initial.sections.find((section) => section.kind === 'documents')!;
    const subject = doc.items.find((item) => item.subject.kind === 'document')!.subject;
    const rejected = await core.decide(expert, sent.assignmentId, {
      subject,
      outcome: 'rejected',
      comment: 'Finish this document',
    });
    const second = await unlockSend(g, sent.assignmentId);
    const view = await workbench.open(expert, second.assignmentId);
    const partial = view.sections.find((section) => section.kind === 'documents')!;
    expect(partial).toMatchObject({
      revisionId: doc.revisionId,
      reviewRequired: true,
      retainedDecisionId: doc.decision!.id,
      decision: doc.decision,
    });
    expect(
      partial.items.find(
        (item) => item.subject.kind === 'document' && JSON.stringify(item.subject) === JSON.stringify(subject),
      )!.decision!.id,
    ).toBe(rejected.id);
    expect(view.canSubmitResult).toBe(false);
    await expect(workbench.submitResult(expert, second.assignmentId)).rejects.toMatchObject({
      status: 409,
      code: 'review_incomplete',
    });
    await expect(
      workbench.decideSection(expert, second.assignmentId, { ...batch(partial), expectedDecisionId: null }),
    ).rejects.toMatchObject({ code: 'review_section_changed' });
    const completed = await workbench.decideSection(expert, second.assignmentId, batch(partial));
    const completedId = completed.decisions.at(-1)!.id;
    expect(completedId).not.toBe(doc.decision!.id);
    const third = await unlockSend(g, second.assignmentId);
    const thirdView = await workbench.open(expert, third.assignmentId);
    expect(thirdView.sections.find((section) => section.kind === 'documents')).toMatchObject({
      revisionId: doc.revisionId,
      reviewRequired: false,
      retainedDecisionId: completedId,
      decision: { id: completedId, outcome: 'verified' },
    });
    expect(thirdView.canSubmitResult).toBe(true);
    await workbench.submitResult(expert, third.assignmentId);
    const job = await resultJob(third.assignmentId);
    const context = await resultContext(job);
    const file = doc.items.find((item) => item.subject.kind === 'file')!.subject;
    if (file.kind !== 'file') throw new Error('Missing file');
    await pool.query("update file_version set scan_state='rejected',rejection_reason='malware' where id=$1", [
      file.fileVersionId,
    ]);
    expect(await resultContext(job)).toEqual(context);
    expect(await resultContext({ ...job, params: {} })).toEqual(context);
  });
  it('invalidates only the edited Unlock section while keeping unchanged rejected section and file decisions', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId, ['contacts', 'documents']);
    const original = await workbench.read(expert, sent.assignmentId);
    const docs = original.sections.find((section) => section.kind === 'documents')!;
    const file = docs.items.find((item) => item.subject.kind === 'file')!.subject;
    const rejectedFile = await core.decide(expert, sent.assignmentId, {
      subject: file,
      outcome: 'rejected',
      comment: 'Replace attachment',
    });
    await unlock.unlock(g.actor, { operationKey: randomUUID(), expectedAssignmentId: sent.assignmentId });
    await editContact(g, 'Corrected after Unlock');
    const second = await send(g);
    const view = await workbench.open(expert, second.assignmentId);
    const contact = view.sections.find((section) => section.kind === 'contacts')!;
    expect(contact.revisionId).not.toBe(original.sections.find((section) => section.kind === 'contacts')!.revisionId);
    expect(contact).toMatchObject({ reviewRequired: true, retainedDecisionId: null, decision: null });
    const retained = view.sections.find((section) => section.kind === 'documents')!;
    expect(retained).toMatchObject({
      revisionId: docs.revisionId,
      reviewRequired: false,
      retainedDecisionId: docs.decision!.id,
      decision: docs.decision,
    });
    expect(retained.items.find((item) => item.subject.kind === 'file')!.decision!.id).toBe(rejectedFile.id);
    await workbench.decideSection(expert, second.assignmentId, batch(contact));
    expect((await workbench.read(expert, second.assignmentId)).canSubmitResult).toBe(true);
    expect(await workbench.submitResult(expert, second.assignmentId)).toMatchObject({ profileStatus: 'returned' });
    expect(
      (await resultContext(await resultJob(second.assignmentId))).sections
        .filter((section) => section.notificationRelevant)
        .map((section) => section.kind),
    ).toEqual(['documents']);
  });
  it('moves the quarter anchor when an accepted changed candidate is published after Unlock without fresh review clicks', async () => {
    const { g, sent } = await ready();
    await decideAll(sent.assignmentId);
    await workbench.submitResult(expert, sent.assignmentId);
    await db
      .update(s.manufacturerProfile)
      .set({ quarterAnchorAt: '2025-01-01' })
      .where(eq(s.manufacturerProfile.id, g.profile));
    await editPersonnel(g);
    const pending = await send(g);
    await workbench.open(expert, pending.assignmentId);
    await decideAll(pending.assignmentId);
    const changed = (await workbench.read(expert, pending.assignmentId)).sections.find(
      (section) => section.kind === 'personnel',
    )!;
    const resumed = await unlockSend(g, pending.assignmentId);
    const view = await workbench.open(expert, resumed.assignmentId);
    expect(view.sections.every((section) => !section.reviewRequired)).toBe(true);
    expect(view.sections.find((section) => section.kind === 'personnel')!.decision!.id).toBe(changed.decision!.id);
    expect(view.canSubmitResult).toBe(true);
    const result = await workbench.submitResult(expert, resumed.assignmentId);
    expect(result.profileStatus).toBe('verified');
    const expected = (
      await pool.query(
        "select to_char(closed_at at time zone 'Asia/Almaty','YYYY-MM-DD') as day from review_assignment where id=$1",
        [resumed.assignmentId],
      )
    ).rows[0].day;
    expect(
      (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile)))[0]!
        .quarterAnchorAt,
    ).toBe(expected);
    const audit = (
      await pool.query("select diff from audit_entries where action='review.submit_result' and object_id=$1", [
        resumed.assignmentId,
      ])
    ).rows[0].diff;
    expect(audit).toMatchObject({ quarterAnchorBefore: '2025-01-01', quarterAnchorAfter: expected });
    expect(
      (await resultContext(await resultJob(resumed.assignmentId))).sections.filter(
        (section) => section.notificationRelevant,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: 'personnel',
        reviewRequired: false,
        outcome: 'verified',
        publication: 'published',
      }),
    ]);
  });
  it('keeps a partial rejected section comment and final own CAS through another Unlock', async () => {
    const { g, sent } = await ready();
    const docs = (await workbench.read(expert, sent.assignmentId)).sections.find(
      (section) => section.kind === 'documents',
    )!;
    const original = await core.decide(expert, sent.assignmentId, {
      subject: { kind: 'section', sectionRevisionId: docs.revisionId },
      outcome: 'rejected',
      comment: 'Original incomplete section',
    });
    const second = await unlockSend(g, sent.assignmentId);
    const secondView = await workbench.open(expert, second.assignmentId);
    expect(secondView.sections.find((section) => section.kind === 'documents')).toMatchObject({
      revisionId: docs.revisionId,
      reviewRequired: true,
      retainedDecisionId: original.id,
      decision: { id: original.id, comment: original.comment },
    });
    // A legacy per-subject review can update a section while item decisions are still missing.
    const own = await core.decide(expert, second.assignmentId, {
      subject: { kind: 'section', sectionRevisionId: docs.revisionId },
      outcome: 'rejected',
      comment: 'Own final incomplete section',
    });
    const third = await unlockSend(g, second.assignmentId);
    const thirdView = await workbench.open(expert, third.assignmentId);
    const partial = thirdView.sections.find((section) => section.kind === 'documents')!;
    expect(partial).toMatchObject({
      revisionId: docs.revisionId,
      reviewRequired: true,
      retainedDecisionId: own.id,
      decision: { id: own.id, comment: own.comment },
    });
    expect(
      partial.items.filter((item) => item.subject.kind === 'document').every((item) => item.decision === null),
    ).toBe(true);
    await expect(
      workbench.decideSection(expert, third.assignmentId, {
        ...batch(partial, 'rejected', own.comment),
        expectedDecisionId: original.id,
      }),
    ).rejects.toMatchObject({ code: 'review_section_changed' });
    await workbench.decideSection(expert, third.assignmentId, batch(partial, 'rejected', own.comment));
    const after = await workbench.read(expert, third.assignmentId);
    for (const section of after.sections.filter((section) => section.kind !== 'documents'))
      await workbench.decideSection(expert, third.assignmentId, batch(section));
    expect((await workbench.read(expert, third.assignmentId)).canSubmitResult).toBe(true);
    expect(await workbench.submitResult(expert, third.assignmentId)).toMatchObject({ profileStatus: 'returned' });
    expect(
      (await resultContext(await resultJob(third.assignmentId))).sections.filter(
        (section) => section.notificationRelevant,
      ),
    ).toEqual([expect.objectContaining({ kind: 'documents', outcome: 'rejected', comment: own.comment })]);
  });
});
