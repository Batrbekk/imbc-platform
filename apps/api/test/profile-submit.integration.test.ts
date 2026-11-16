import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  ownCertificatesSchema,
  ownDocumentsSchema,
  profileSubmitResultSchema,
  SECTION_KINDS,
  type ProfileSubmitInput,
  type SectionKind,
} from '@imbc/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { profileItemReviews } from '../src/modules/profiles/profile-item-review.js';
import { ProfileSubmitController } from '../src/modules/profiles/profile-submit.controller.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { ProfileUnlockService } from '../src/modules/profiles/profile-unlock.service.js';
import { ProfileSubmissionStateService } from '../src/modules/profiles/profile-submission-state.service.js';
import { ReviewsService } from '../src/modules/reviews/reviews.service.js';
import { profileCandidateRevisions } from '../src/modules/profiles/profile-candidate.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import {
  captureSubmissionRequirements,
  lockCurrentSubmissionRequirements,
} from '../src/modules/profiles/submission-requirements.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';

const ROOT = '/api/v1/profiles/own/submit';
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'atomic own-profile Send with seven real handlers, HTTP, PostgreSQL and pg-boss',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool;
    let db: Database;
    let appPool: pg.Pool;
    let appDb: Database;
    let boss: PgBoss;
    let http: HttpStand;
    let service: ProfileSubmitService;
    let editor: ProfileSectionsService;
    let fixture: Awaited<ReturnType<typeof seedSubmissionProfile>>;
    let expertId: string;
    let adminId: string;
    let imbcId: string;
    let requiredIds: string[] = [];
    const role = `submit_test_${randomUUID().replaceAll('-', '')}`;
    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
      imbcId = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!.id;
      const [expert] = await db
        .insert(s.userAccounts)
        .values({ organizationId: imbcId, role: 'expert', state: 'active', email: 'reviewer@submit.local' })
        .returning();
      const [admin] = await db
        .insert(s.userAccounts)
        .values({ organizationId: imbcId, role: 'administrator', state: 'active', email: 'administrator@submit.local' })
        .returning();
      expertId = expert!.id;
      adminId = admin!.id;
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.notify);
      await pool.query(`CREATE ROLE "${role}" NOLOGIN; GRANT USAGE ON SCHEMA public,pgboss_auth_test TO "${role}"`);
      await applyAppRoleGrants(pool, role);
      await pool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pgboss_auth_test TO "${role}"`);
      appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5, options: `-c role=${role}` });
      appDb = drizzle(appPool, { schema: s, casing: 'snake_case' });
    });
    beforeEach(async () => {
      fixture = await seedSubmissionProfile(pool);
      const audit = new AuditService(appDb);
      service = new ProfileSubmitService(appPool, audit, boss, submissionHandlers());
      editor = new ProfileSectionsService(appPool, audit, submissionHandlers());
      http = await startHttp({
        controllers: [ProfileSubmitController],
        providers: [{ provide: ProfileSubmitService, useValue: service }],
        organizationId: fixture.org,
        accountIds: { manufacturer: fixture.actor.id },
      });
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      await http?.close();
      if (requiredIds.length)
        await db.update(s.dictionaryEntry).set({ mandatory: false }).where(inArray(s.dictionaryEntry.id, requiredIds));
      await db
        .update(s.userAccounts)
        .set({ state: 'active' })
        .where(inArray(s.userAccounts.id, [adminId, expertId]));
      requiredIds = [];
    });
    afterAll(async () => {
      await boss?.stop();
      await appPool?.end();
      if (pool) await pool.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
      await pool?.end();
    });
    const request = async (): Promise<ProfileSubmitInput> => {
      const candidates = await profileCandidateRevisions(db, {
        profileId: fixture.profile,
        organizationId: fixture.org,
      });
      const revisions = await db
        .select()
        .from(s.sectionRevision)
        .where(eq(s.sectionRevision.organizationId, fixture.org));
      return {
        operationKey: randomUUID(),
        accuracyConfirmed: true,
        expectedSections: candidates.map((candidate) => ({
          kind: candidate.kind,
          revisionId: candidate.revisionId!,
          editVersion: revisions.find((r) => r.id === candidate.revisionId)!.editVersion,
        })),
      };
    };
    const send = async (body?: ProfileSubmitInput) => {
      const response = await http.send('POST', ROOT, 'manufacturer', body ?? (await request()));
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    };
    const state = async () => {
      const queries = [
        [
          'profile',
          'select status,accuracy_confirmed_at,has_pending_changes from manufacturer_profile where id=$1',
          fixture.profile,
        ],
        [
          'sections',
          'select id,working_revision_id,pending_revision_id,verified_revision_id from profile_section where profile_id=$1 order by id',
          fixture.profile,
        ],
        [
          'revisions',
          'select id,state,submitted_at,edit_version from section_revision where organization_id=$1 order by id',
          fixture.org,
        ],
        [
          'snapshots',
          'select * from revision_file_version where organization_id=$1 order by section_revision_id,file_object_id',
          fixture.org,
        ],
        [
          'requirements',
          'select * from submission_requirement where organization_id=$1 order by section_revision_id,dictionary_entry_id',
          fixture.org,
        ],
        [
          'assignments',
          'select id,operation_key from review_assignment where profile_id=$1 order by id',
          fixture.profile,
        ],
        ['jobs', "select id from pgboss_auth_test.job where data->>'profileId'=$1 order by id", fixture.profile],
        ['audit', 'select id from audit_entries where organization_id=$1 order by id', fixture.org],
      ] as const;
      return Object.fromEntries(
        await Promise.all(queries.map(async ([name, query, value]) => [name, (await pool.query(query, [value])).rows])),
      );
    };
    const approve = async (
      assignmentId: string,
      options: { skipDocumentDecision?: boolean; lateRejection?: 'document' | 'file' } = {},
    ) => {
      await db
        .update(s.reviewAssignment)
        .set({ expertId, assignedBy: adminId, assignedAt: new Date() })
        .where(eq(s.reviewAssignment.id, assignmentId));
      const map = await db
        .select()
        .from(s.reviewAssignmentSection)
        .where(eq(s.reviewAssignmentSection.reviewAssignmentId, assignmentId));
      for (const item of map) {
        const documents = await db
          .select()
          .from(s.document)
          .where(eq(s.document.sectionRevisionId, item.sectionRevisionId));
        const certificates = await db
          .select()
          .from(s.certificate)
          .where(and(eq(s.certificate.sectionRevisionId, item.sectionRevisionId), eq(s.certificate.notHeld, false)));
        for (const subject of [
          ...(options.skipDocumentDecision ? [] : documents.map((d) => ({ documentId: d.id }))),
          ...certificates.map((c) => ({ certificateId: c.id })),
        ])
          await db.insert(s.reviewDecision).values({
            reviewAssignmentId: assignmentId,
            organizationId: fixture.org,
            expertId,
            profileSectionId: item.profileSectionId,
            subjectRevisionId: item.sectionRevisionId,
            outcome: 'verified',
            decidedAt: new Date(),
            ...subject,
          });
        const [decision] = await db
          .insert(s.reviewDecision)
          .values({
            reviewAssignmentId: assignmentId,
            organizationId: fixture.org,
            expertId,
            profileSectionId: item.profileSectionId,
            subjectRevisionId: item.sectionRevisionId,
            sectionRevisionId: item.sectionRevisionId,
            outcome: 'verified',
            decidedAt: new Date(),
          })
          .returning();
        await db
          .update(s.profileSectionCandidate)
          .set({ acceptedDecisionId: decision!.id })
          .where(eq(s.profileSectionCandidate.profileSectionId, item.profileSectionId));
      }
      if (options.lateRejection) {
        const kind = options.lateRejection === 'document' ? 'documents' : 'personnel';
        const item = map.find((row) => row.profileSectionId === fixture.sections[kind])!;
        const [document] = await db
          .select()
          .from(s.document)
          .where(eq(s.document.sectionRevisionId, item.sectionRevisionId));
        const [capture] = await db
          .select()
          .from(s.revisionFileVersion)
          .where(eq(s.revisionFileVersion.sectionRevisionId, item.sectionRevisionId));
        await db.insert(s.reviewDecision).values({
          reviewAssignmentId: assignmentId,
          organizationId: fixture.org,
          expertId,
          profileSectionId: item.profileSectionId,
          subjectRevisionId: item.sectionRevisionId,
          outcome: 'rejected',
          comment: 'Fixture rejection',
          decidedAt: new Date(),
          ...(options.lateRejection === 'document'
            ? { documentId: document!.id }
            : { fileVersionId: capture!.fileVersionId, fileObjectId: capture!.fileObjectId }),
        });
      }
      await db
        .update(s.profileSection)
        .set({ pendingRevisionId: null })
        .where(eq(s.profileSection.profileId, fixture.profile));
      await db
        .update(s.sectionRevision)
        .set({ state: 'verified' })
        .where(eq(s.sectionRevision.organizationId, fixture.org));
      for (const item of map)
        await db
          .update(s.profileSection)
          .set({ verifiedRevisionId: item.sectionRevisionId })
          .where(eq(s.profileSection.id, item.profileSectionId));
      await db
        .update(s.reviewAssignment)
        .set({ closedAt: new Date(), closedBy: expertId, closeReason: 'review_result' })
        .where(eq(s.reviewAssignment.id, assignmentId));
      await db
        .update(s.manufacturerProfile)
        .set({ status: 'verified', verifiedAt: new Date(), hasPendingChanges: false })
        .where(eq(s.manufacturerProfile.id, fixture.profile));
    };
    const editContacts = async () => {
      const handler = submissionHandlers().find((h) => h.kind === 'contacts')!;
      const candidate = (
        await profileCandidateRevisions(db, { profileId: fixture.profile, organizationId: fixture.org })
      ).find((c) => c.kind === 'contacts')!;
      const data = (await handler.editable(db, {
        profileId: fixture.profile,
        organizationId: fixture.org,
        sectionId: candidate.sectionId,
        revisionId: candidate.revisionId!,
      })) as { contacts: { email: string | null }[] };
      data.contacts[0]!.email = 'new-focal@submit.local';
      const [revision] = await db
        .select()
        .from(s.sectionRevision)
        .where(eq(s.sectionRevision.id, candidate.revisionId!));
      return editor.save(fixture.actor, 'contacts', { editVersion: revision!.editVersion, data });
    };
    const addRequired = async (kind: 'certificates' | 'documents') => {
      const [dictionary] = await db
        .select()
        .from(s.dictionary)
        .where(eq(s.dictionary.code, kind === 'certificates' ? 'certificate_type' : 'document_type'));
      const [entry] = await db
        .insert(s.dictionaryEntry)
        .values({ dictionaryId: dictionary!.id, code: `new_${randomUUID()}`, mandatory: true })
        .returning();
      requiredIds.push(entry!.id);
      await db.insert(s.dictionaryEntryTranslation).values(
        (['en', 'ru', 'kk'] as const).map((language) => ({
          dictionaryEntryId: entry!.id,
          language,
          name: `New required ${language}`,
        })),
      );
      return entry!.id;
    };
    const waitFor = async (predicate: () => Promise<boolean>) => {
      const deadline = Date.now() + 4000;
      while (!(await predicate())) {
        if (Date.now() > deadline) throw new Error('Expected database lock was not reached');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };

    it('atomically freezes seven complete sections, captures all seven files, confirms accuracy and queues one ID-only NOT04', async () => {
      const result = await send();
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      const parsed = profileSubmitResultSchema.parse(result.body);
      expect(parsed.mode).toBe('initial');
      expect(parsed.profileStatus).toBe('submitted');
      expect(parsed.sections.map((section) => section.kind).sort()).toEqual([...SECTION_KINDS].sort());
      expect(parsed.sections.every((section) => section.reviewRequired && section.retainedDecisionId === null)).toBe(
        true,
      );
      const after = await state();
      expect(after.assignments).toHaveLength(1);
      expect(after.jobs).toHaveLength(1);
      expect(after.snapshots).toHaveLength(7);
      expect(after.revisions.every((r: any) => r.state === 'submitted' && r.submitted_at)).toBe(true);
      expect(
        after.sections.every((section: any) => section.working_revision_id === null && section.pending_revision_id),
      ).toBe(true);
      expect(after.audit).toHaveLength(1);
      const job = (await pool.query('select data from pgboss_auth_test.job where id=$1', [after.jobs[0].id])).rows[0]!
        .data;
      expect(job.rule).toBe('NOT-04');
      expect(job.related).toEqual({ type: 'review_assignment', id: parsed.assignmentId });
      expect(JSON.stringify(job)).not.toContain('@');
      expect(Object.keys(job.params)).toEqual([]);
    });
    it('projects exact item outcomes and late rejection without rewriting frozen rows or carrying review to a COW', async () => {
      const initial = await send();
      expect(initial.status).toBe(201);
      const submitted = ownDocumentsSchema.parse(await editor.read(fixture.actor, 'documents'));
      expect(submitted.data.documents.map((row) => row.status)).toEqual(['under_review', 'under_review']);
      const documentsBefore = await db
        .select()
        .from(s.document)
        .where(eq(s.document.sectionRevisionId, fixture.revisions.documents!));
      const certificatesBefore = await db
        .select()
        .from(s.certificate)
        .where(eq(s.certificate.sectionRevisionId, fixture.revisions.certificates!));
      await approve(initial.body.assignmentId, { lateRejection: 'document' });
      const reviewed = ownDocumentsSchema.parse(await editor.read(fixture.actor, 'documents'));
      expect(reviewed.data.documents.map((row) => row.status).sort()).toEqual(['rejected', 'verified']);
      const certificates = ownCertificatesSchema.parse(await editor.read(fixture.actor, 'certificates'));
      expect(
        certificates.data.certificates.find((row) => row.identityId === String(fixture.rows.certificate!.identity_id))
          ?.status,
      ).toBe('verified');
      expect(
        certificates.data.certificates
          .filter((row) => row.certificateType?.code.startsWith('ISO'))
          .every((row) => row.status === null),
      ).toBe(true);
      expect(
        await db.select().from(s.document).where(eq(s.document.sectionRevisionId, fixture.revisions.documents!)),
      ).toEqual(documentsBefore);
      expect(
        await db
          .select()
          .from(s.certificate)
          .where(eq(s.certificate.sectionRevisionId, fixture.revisions.certificates!)),
      ).toEqual(certificatesBefore);
      const context = {
        profileId: fixture.profile,
        organizationId: fixture.org,
        sectionId: fixture.sections.documents!,
        revisionId: fixture.revisions.documents!,
      };
      expect(await profileItemReviews(appDb, { ...context, organizationId: randomUUID() }, 'document')).toEqual(
        new Map(),
      );
      expect(await profileItemReviews(appDb, { ...context, profileId: randomUUID() }, 'document')).toEqual(new Map());
      const changed = ownDocumentsSchema.parse(
        await editor.save(fixture.actor, 'documents', {
          editVersion: reviewed.editVersion,
          data: { documents: reviewed.data.editable.documents.map((row) => ({ ...row, fileId: null })) },
        }),
      );
      expect(changed.data.documents.map((row) => row.status)).toEqual(['missing', 'missing']);
      expect(await profileItemReviews(appDb, { ...context, revisionId: changed.revisionId }, 'document')).toEqual(
        new Map(changed.data.documents.map((row) => [row.identityId, { outcome: null, fileOutcome: null }])),
      );
    });
    it('an explicit rejection of the exact captured file suppresses an item approval', async () => {
      const initial = await send();
      expect(initial.status).toBe(201);
      await db
        .update(s.reviewAssignment)
        .set({ expertId, assignedBy: adminId, assignedAt: new Date() })
        .where(eq(s.reviewAssignment.id, initial.body.assignmentId));
      const [capture] = await db
        .select()
        .from(s.revisionFileVersion)
        .where(eq(s.revisionFileVersion.sectionRevisionId, fixture.revisions.documents!));
      await db.insert(s.reviewDecision).values({
        reviewAssignmentId: initial.body.assignmentId,
        organizationId: fixture.org,
        expertId,
        profileSectionId: fixture.sections.documents!,
        subjectRevisionId: fixture.revisions.documents!,
        fileVersionId: capture!.fileVersionId,
        fileObjectId: capture!.fileObjectId,
        outcome: 'rejected',
        comment: 'Fixture file rejection',
        decidedAt: new Date(),
      });
      await approve(initial.body.assignmentId);
      const documents = ownDocumentsSchema.parse(await editor.read(fixture.actor, 'documents'));
      expect(documents.data.documents.find((row) => row.file?.fileId === capture!.fileObjectId)?.status).toBe(
        'rejected',
      );
      expect(
        documents.data.documents
          .filter((row) => row.file?.fileId !== capture!.fileObjectId)
          .every((row) => row.status === 'verified'),
      ).toBe(true);
    });
    it('requires explicit accuracy true and an exact strict seven-section viewed vector', async () => {
      const body = await request();
      const before = await state();
      for (const invalid of [
        { ...body, accuracyConfirmed: false },
        { ...body, profileId: fixture.profile },
        { ...body, expectedSections: body.expectedSections.slice(1) },
        { ...body, expectedSections: [...body.expectedSections.slice(1), body.expectedSections[1]] },
      ])
        expect((await http.send('POST', ROOT, 'manufacturer', invalid)).status).toBe(400);
      expect(await state()).toEqual(before);
    });
    it('uses persisted manufacturer authority and rejects blocked/changed-role actors even with an old valid session', async () => {
      const body = await request();
      for (const change of [{ state: 'blocked' as const }, { state: 'active' as const, role: 'operator' as const }]) {
        await db.update(s.userAccounts).set(change).where(eq(s.userAccounts.id, fixture.actor.id));
        expect((await send(body)).status).toBe(403);
      }
      expect((await state()).assignments).toEqual([]);
      expect((await state()).jobs).toEqual([]);
    });
    it('rejects unauthorized IMBC and foreign persisted tenant scopes before mutating either profile', async () => {
      const body = await request();
      expect((await http.send('POST', ROOT, 'expert', body)).status).toBe(403);
      expect((await http.send('POST', ROOT, 'administrator', body)).status).toBe(403);
      const other = await seedSubmissionProfile(pool);
      await db.update(s.userAccounts).set({ role: 'operator' }).where(eq(s.userAccounts.id, other.actor.id));
      await db.update(s.userAccounts).set({ organizationId: other.org }).where(eq(s.userAccounts.id, fixture.actor.id));
      expect((await send(body)).status).toBe(403);
      expect((await state()).assignments).toEqual([]);
    });
    it('rejects stale revision IDs and editVersion even when cached completeness says 100', async () => {
      const body = await request();
      await db
        .update(s.sectionRevision)
        .set({ editVersion: 1 })
        .where(eq(s.sectionRevision.id, fixture.revisions.contacts!));
      expect((await send(body)).body.code).toBe('section_changed');
      const next = await request();
      next.expectedSections[0]!.revisionId = randomUUID();
      expect((await send(next)).body.code).toBe('section_changed');
      expect((await state()).assignments).toEqual([]);
    });
    it('recomputes true mandatory fields instead of trusting a rounded or cached 100', async () => {
      await db
        .update(s.sectionRevision)
        .set({ completenessPct: '100' })
        .where(eq(s.sectionRevision.organizationId, fixture.org));
      await db.update(s.personnel).set({ engineersCount: null }).where(eq(s.personnel.organizationId, fixture.org));
      const before = await state();
      const result = await send();
      expect(result.status).toBe(400);
      expect(result.body.code).toBe('profile_incomplete');
      expect(result.body.missing).toContainEqual({ kind: 'personnel', path: 'engineersCount', code: 'required' });
      expect(await state()).toEqual(before);
    });
    it('blocks legacy manual name plus exact TN VED duplicates even when Save cached completeness is 100', async () => {
      const [line] = await db.select().from(s.productLine).where(eq(s.productLine.organizationId, fixture.org));
      const [identity] = await db
        .insert(s.productLineIdentity)
        .values({ profileId: fixture.profile, organizationId: fixture.org })
        .returning();
      await db
        .insert(s.productLine)
        .values({ ...line!, id: randomUUID(), identityId: identity!.id, nameEn: '  WIDGET  ', positionInList: 1 });
      const result = await send();
      expect(result.body.code).toBe('profile_incomplete');
      expect(
        result.body.missing.some((item: any) => item.kind === 'products' && item.code === 'duplicate_product'),
      ).toBe(true);
      expect((await state()).assignments).toEqual([]);
    });
    it.each(['cv', 'unified_register_extract', 'production_photo'] as const)(
      'blocks pending optional %s without inventing business completeness requirements',
      async (purpose) => {
        const [file] = await db
          .select()
          .from(s.fileObject)
          .where(and(eq(s.fileObject.organizationId, fixture.org), eq(s.fileObject.purpose, purpose)));
        await db.update(s.fileVersion).set({ scanState: 'pending' }).where(eq(s.fileVersion.fileObjectId, file!.id));
        const before = await state();
        const result = await send();
        expect(result.status).toBe(409);
        expect(result.body.code).toBe('submission_file_unavailable');
        expect(await state()).toEqual(before);
      },
    );
    it('keeps optional unfinished production complete but rejects its rejected shared photo', async () => {
      const [photo] = await db
        .select()
        .from(s.fileObject)
        .where(and(eq(s.fileObject.organizationId, fixture.org), eq(s.fileObject.purpose, 'production_photo')));
      await db
        .update(s.fileVersion)
        .set({ scanState: 'rejected', rejectionReason: 'malware' })
        .where(eq(s.fileVersion.fileObjectId, photo!.id));
      const result = await send();
      expect(result.body.code).toBe('submission_file_unavailable');
      expect(result.body.missing[0].kind).toBe('production');
    });
    it('replays the original immutable result with the same key and canonical vector order, without a second assignment/audit/job', async () => {
      const body = await request();
      const first = await send(body);
      const before = await state();
      const replay = await send({ ...body, expectedSections: [...body.expectedSections].reverse() });
      expect(replay).toEqual(first);
      expect(await state()).toEqual(before);
      const conflicting = {
        ...body,
        expectedSections: body.expectedSections.map((section, index) => ({
          ...section,
          editVersion: section.editVersion + (index === 0 ? 1 : 0),
        })),
      };
      expect((await send(conflicting)).body.code).toBe('operation_conflict');
      expect(await state()).toEqual(before);
    });
    it('two concurrent copies of one operation create exactly one Send', async () => {
      const body = await request();
      const [first, second] = await Promise.all([send(body), send(body)]);
      expect(first).toEqual(second);
      expect(first.status).toBe(201);
      const after = await state();
      expect(after.assignments).toHaveLength(1);
      expect(after.jobs).toHaveLength(1);
      expect(after.audit).toHaveLength(1);
    });
    it('two different concurrent Sends serialize and leave one locked current assignment', async () => {
      const body = await request();
      const results = await Promise.all([send(body), send({ ...body, operationKey: randomUUID() })]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe('profile_locked');
      expect((await state()).assignments).toHaveLength(1);
      expect((await state()).jobs).toHaveLength(1);
    });
    it('rollback after a real queue insert undoes every frozen revision, snapshot, map, audit and job', async () => {
      const original = boss.send.bind(boss);
      const before = await state();
      vi.spyOn(boss, 'send').mockImplementation(async (...args: any[]) => {
        await (original as any)(...args);
        throw new Error('fixture enqueue failure');
      });
      await expect(service.submit(fixture.actor, await request())).rejects.toThrow('fixture enqueue failure');
      expect(await state()).toEqual(before);
    });
    it('an awaited revision lock rechecks committed editVersion before freezing', async () => {
      const client = await pool.connect();
      const body = await request();
      await client.query('BEGIN');
      await client.query('update section_revision set edit_version=edit_version+1 where id=$1', [
        fixture.revisions.contacts,
      ]);
      const pending = send(body);
      try {
        await waitFor(
          async () =>
            (
              await pool.query(
                "select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%section_revision%for update%') as waiting",
              )
            ).rows[0]!.waiting,
        );
        await client.query('COMMIT');
        const result = await pending;
        expect(result.status).toBe(409);
        expect(result.body.code).toBe('section_changed');
        expect((await state()).assignments).toEqual([]);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    it('Verified changes retain six exact accepted baselines, send only the working change and reuse the immediate previous SME', async () => {
      const initial = await send();
      await approve(initial.body.assignmentId);
      await editContacts();
      const result = await send();
      expect(result.status).toBe(201);
      expect(result.body.profileStatus).toBe('verified');
      expect(result.body.mode).toBe('verified_changes');
      expect(
        result.body.sections.filter((section: any) => section.reviewRequired).map((section: any) => section.kind),
      ).toEqual(['contacts']);
      const [assignment] = await db
        .select()
        .from(s.reviewAssignment)
        .where(eq(s.reviewAssignment.id, result.body.assignmentId));
      expect(assignment!.expertId).toBe(expertId);
      expect(assignment!.assignedBy).toBe(adminId);
      expect(assignment!.reusedFromAssignmentId).toBe(initial.body.assignmentId);
      expect(assignment!.receivedAt.getTime()).toBeGreaterThan(new Date(initial.body.receivedAt).getTime());
      expect((await state()).sections.filter((section: any) => section.pending_revision_id)).toHaveLength(1);
    });
    it('Verified with no changes cannot create an invisible all-retained assignment', async () => {
      const initial = await send();
      await approve(initial.body.assignmentId);
      const before = await state();
      const result = await send();
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('profile_no_changes');
      expect(await state()).toEqual(before);
    });
    it('accepted but unpublished C2 survives partial review Unlock and resends unchanged with exact d1 and authoritative assignment lock', async () => {
      const first = await send();
      expect(first.status).toBe(201);
      await approve(first.body.assignmentId);
      const c1 = fixture.revisions.contacts;
      await editContacts();
      const second = await send();
      expect(second.status).toBe(201);
      const c2 = second.body.sections.find((section: any) => section.kind === 'contacts').revisionId;
      expect(c2).not.toBe(c1);
      const [d1] = await db
        .insert(s.reviewDecision)
        .values({
          reviewAssignmentId: second.body.assignmentId,
          organizationId: fixture.org,
          expertId,
          profileSectionId: fixture.sections.contacts,
          subjectRevisionId: c2,
          sectionRevisionId: c2,
          outcome: 'verified',
          decidedAt: new Date(),
        })
        .returning();
      const unlocker = new ProfileUnlockService(appPool, new AuditService(appDb), boss);
      await unlocker.unlock(fixture.actor, {
        operationKey: randomUUID(),
        expectedAssignmentId: second.body.assignmentId,
      });
      const stateService = new ProfileSubmissionStateService(appPool, new AuditService(appDb));
      expect((await stateService.current(fixture.actor)).hasUnsubmittedChanges).toBe(true);
      const before = await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, fixture.org));
      const third = await send();
      expect(third.status, JSON.stringify(third.body)).toBe(201);
      expect(third.body.sections.every((section: any) => !section.reviewRequired)).toBe(true);
      const retained = third.body.sections.find((section: any) => section.kind === 'contacts');
      expect(retained.revisionId).toBe(c2);
      expect(retained.retainedDecisionId).toBe(d1!.id);
      expect(
        await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, fixture.org)),
      ).toEqual(before);
      const storedSections = await db
        .select()
        .from(s.profileSection)
        .where(eq(s.profileSection.profileId, fixture.profile));
      expect(storedSections.every((section) => section.pendingRevisionId === null)).toBe(true);
      expect(storedSections.find((section) => section.kind === 'contacts')!.verifiedRevisionId).toBe(c1);
      const overview = await editor.overview(fixture.actor);
      expect(overview.readOnly).toBe(true);
      expect(overview.sections.every((section) => section.readOnly)).toBe(true);
      await expect(editContacts()).rejects.toMatchObject({ code: 'profile_locked' });
      const queue = await new ReviewsService(appPool, new AuditService(appDb)).queue(
        {
          id: expertId,
          organizationId: imbcId,
          organizationType: 'imbc',
          role: 'expert',
          email: 'reviewer@submit.local',
          fullName: null,
          locale: 'en',
        },
        { status: ['pending_changes'] },
      );
      expect(queue.items.some((item) => item.profileId === fixture.profile && item.hasPendingChanges)).toBe(true);
      const current = await stateService.current(fixture.actor);
      expect(current.activeAssignmentId).toBe(third.body.assignmentId);
      expect(current.hasUnsubmittedChanges).toBe(false);
    });
    it.each(['certificates', 'documents'] as const)(
      'a new mandatory %s type blocks Contacts-only Send through a COW requirement candidate and rolls back completely',
      async (kind) => {
        const initial = await send();
        await approve(initial.body.assignmentId);
        await editContacts();
        const id = await addRequired(kind);
        const before = await state();
        const result = await send();
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('profile_incomplete');
        expect(
          result.body.missing.some((item: any) => item.kind === kind && item.code.endsWith('_type_required')),
        ).toBe(true);
        expect(result.body.requirements).toContainEqual({ kind, requiredTypeIds: expect.arrayContaining([id]) });
        expect(await state()).toEqual(before);
      },
    );
    it('a newly required type already supplied as optional creates a new Documents subject and snapshot without rewriting old approval', async () => {
      const id = await addRequired('documents');
      await db.update(s.dictionaryEntry).set({ mandatory: false }).where(eq(s.dictionaryEntry.id, id));
      const [identity] = await db
        .insert(s.documentIdentity)
        .values({ profileId: fixture.profile, organizationId: fixture.org })
        .returning();
      const [file] = await db
        .insert(s.fileObject)
        .values({ organizationId: fixture.org, purpose: 'document_file', dataClass: 'b_manufacturer' })
        .returning();
      await db.insert(s.fileVersion).values({
        fileObjectId: file!.id,
        versionNumber: 1,
        originalName: 'optional.pdf',
        byteSize: 1,
        declaredMediaType: 'application/pdf',
        checksum: 'fixture',
        storageKey: randomUUID(),
        scanState: 'passed',
      });
      await db.insert(s.document).values({
        sectionRevisionId: fixture.revisions.documents!,
        organizationId: fixture.org,
        identityId: identity!.id,
        documentTypeId: id,
        fileObjectId: file!.id,
        positionInList: 2,
      });
      const initial = await send();
      expect(initial.status).toBe(201);
      await approve(initial.body.assignmentId);
      const oldSnapshot = await db
        .select()
        .from(s.submissionRequirement)
        .where(eq(s.submissionRequirement.sectionRevisionId, fixture.revisions.documents!));
      await db.update(s.dictionaryEntry).set({ mandatory: true }).where(eq(s.dictionaryEntry.id, id));
      await editContacts();
      const result = await send();
      expect(result.status).toBe(201);
      const section = result.body.sections.find((row: any) => row.kind === 'documents');
      expect(section.reviewRequired).toBe(true);
      expect(section.retainedDecisionId).toBeNull();
      expect(section.revisionId).not.toBe(fixture.revisions.documents);
      expect(
        await db
          .select()
          .from(s.submissionRequirement)
          .where(eq(s.submissionRequirement.sectionRevisionId, fixture.revisions.documents!)),
      ).toEqual(oldSnapshot);
      const updated = await db
        .select()
        .from(s.submissionRequirement)
        .where(eq(s.submissionRequirement.sectionRevisionId, section.revisionId));
      expect(updated.map((entry) => entry.dictionaryEntryId)).toContain(id);
    });
    it('unchanged frozen evidence keeps captured v1 even when latest v2 is pending', async () => {
      const initial = await send();
      await approve(initial.body.assignmentId);
      await editContacts();
      const [file] = await db
        .select()
        .from(s.fileObject)
        .where(and(eq(s.fileObject.organizationId, fixture.org), eq(s.fileObject.purpose, 'organisation_chart')));
      const [v1] = await db.select().from(s.fileVersion).where(eq(s.fileVersion.fileObjectId, file!.id));
      await db.insert(s.fileVersion).values({
        fileObjectId: file!.id,
        versionNumber: 2,
        originalName: 'replacement.pdf',
        byteSize: 1,
        declaredMediaType: 'application/pdf',
        checksum: 'fixture2',
        storageKey: randomUUID(),
        scanState: 'pending',
      });
      const result = await send();
      expect(result.status).toBe(201);
      const retained = result.body.sections.find((section: any) => section.kind === 'personnel');
      expect(retained.reviewRequired).toBe(false);
      expect(retained.revisionId).toBe(fixture.revisions.personnel);
      const [capture] = await db
        .select()
        .from(s.revisionFileVersion)
        .where(
          and(
            eq(s.revisionFileVersion.sectionRevisionId, retained.revisionId),
            eq(s.revisionFileVersion.fileObjectId, file!.id),
          ),
        );
      expect(capture!.fileVersionId).toBe(v1!.id);
    });
    it('a new required type committed while Send waits for its dictionary lock is checked in the same new Send', async () => {
      const initial = await send();
      await approve(initial.body.assignmentId);
      await editContacts();
      const [dictionary] = await db.select().from(s.dictionary).where(eq(s.dictionary.code, 'document_type'));
      const client = await pool.connect();
      await client.query('BEGIN');
      const inserted = (
        await client.query<{ id: string }>(
          'insert into dictionary_entry (dictionary_id,code,mandatory) values ($1,$2,true) returning id',
          [dictionary!.id, `race_${randomUUID()}`],
        )
      ).rows[0]!;
      requiredIds.push(inserted.id);
      const pending = send();
      try {
        await waitFor(
          async () =>
            (
              await pool.query(
                "select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%pg_advisory_xact_lock%') as waiting",
              )
            ).rows[0]!.waiting,
        );
        await client.query('COMMIT');
        const result = await pending;
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('profile_incomplete');
        expect(result.body.requirements).toContainEqual({
          kind: 'documents',
          requiredTypeIds: expect.arrayContaining([inserted.id]),
        });
        expect((await state()).assignments).toHaveLength(1);
        expect((await state()).jobs).toHaveLength(1);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    it('new working capture sees a pending replacement committed while waiting for its file-object lock', async () => {
      const [file] = await db
        .select()
        .from(s.fileObject)
        .where(and(eq(s.fileObject.organizationId, fixture.org), eq(s.fileObject.purpose, 'production_photo')));
      const client = await pool.connect();
      await client.query('BEGIN');
      await client.query('select id from file_object where id=$1 for update', [file!.id]);
      await client.query(
        "insert into file_version (file_object_id,version_number,original_name,byte_size,declared_media_type,checksum,storage_key,scan_state) values ($1,2,'photo2.png',1,'image/png','fixture',$2,'pending')",
        [file!.id, randomUUID()],
      );
      const pending = send();
      try {
        await waitFor(
          async () =>
            (
              await pool.query(
                "select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%file_object%for update%') as waiting",
              )
            ).rows[0]!.waiting,
        );
        await client.query('COMMIT');
        const result = await pending;
        expect(result.status).toBe(409);
        expect(result.body.code).toBe('submission_file_unavailable');
        const after = await state();
        expect(after.assignments).toEqual([]);
        expect(after.jobs).toEqual([]);
        expect(
          after.revisions.every((revision: any) => revision.state === 'working' && revision.submitted_at === null),
        ).toBe(true);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    it.each(['document', 'file'] as const)(
      'a latest %s rejection cannot be bypassed by an older verified section decision',
      async (subject) => {
        const initial = await send();
        await approve(initial.body.assignmentId, { lateRejection: subject });
        await editContacts();
        const result = await send();
        expect(result.status).toBe(201);
        const kind = subject === 'document' ? 'documents' : 'personnel';
        const section = result.body.sections.find((row: any) => row.kind === kind);
        expect(section.reviewRequired).toBe(true);
        expect(section.retainedDecisionId).toBeNull();
        expect(section.revisionId).not.toBe(fixture.revisions[kind]);
      },
    );
    it('a section decision with missing document decisions requires a new Documents COW rather than transferring acceptance', async () => {
      const initial = await send();
      await approve(initial.body.assignmentId, { skipDocumentDecision: true });
      await editContacts();
      const result = await send();
      expect(result.status).toBe(201);
      const section = result.body.sections.find((row: any) => row.kind === 'documents');
      expect(section.reviewRequired).toBe(true);
      expect(section.retainedDecisionId).toBeNull();
      expect(section.revisionId).not.toBe(fixture.revisions.documents);
    });
    it('proven immediate previous SME reuse preserves an inactive historical administrator as assignedBy', async () => {
      const initial = await send();
      await approve(initial.body.assignmentId);
      await db.update(s.userAccounts).set({ state: 'inactive' }).where(eq(s.userAccounts.id, adminId));
      await editContacts();
      const result = await send();
      expect(result.status).toBe(201);
      const [assignment] = await db
        .select()
        .from(s.reviewAssignment)
        .where(eq(s.reviewAssignment.id, result.body.assignmentId));
      expect(assignment!.expertId).toBe(expertId);
      expect(assignment!.assignedBy).toBe(adminId);
      expect(assignment!.reusedFromAssignmentId).toBe(initial.body.assignmentId);
    });
    it('an inactive prior expert is not automatically assigned to the new cycle', async () => {
      const initial = await send();
      await approve(initial.body.assignmentId);
      await db.update(s.userAccounts).set({ state: 'inactive' }).where(eq(s.userAccounts.id, expertId));
      await editContacts();
      const result = await send();
      expect(result.status).toBe(201);
      const [assignment] = await db
        .select()
        .from(s.reviewAssignment)
        .where(eq(s.reviewAssignment.id, result.body.assignmentId));
      expect(assignment!.expertId).toBeNull();
      expect(assignment!.reusedFromAssignmentId).toBeNull();
    });
    it('complete fields and a legitimate site identity do not permit a site absent from the exact Main revision graph', async () => {
      const [oldSite] = await db
        .select()
        .from(s.productionSite)
        .where(eq(s.productionSite.organizationId, fixture.org));
      const [identity] = await db
        .insert(s.productionSiteIdentity)
        .values({ profileId: fixture.profile, organizationId: fixture.org })
        .returning();
      await db.insert(s.productionSite).values({
        mainInformationId: oldSite!.mainInformationId,
        organizationId: fixture.org,
        identityId: identity!.id,
        address: 'Other complete address',
        city: 'Almaty',
        regionId: oldSite!.regionId,
      });
      await db.delete(s.productionSite).where(eq(s.productionSite.id, oldSite!.id));
      const before = await state();
      const result = await send();
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('submission_graph_invalid');
      expect(result.body.missing).toContainEqual({
        kind: 'products',
        path: 'products.0.productionSiteIdentityId',
        code: 'site_not_in_revision_graph',
      });
      expect(await state()).toEqual(before);
    });
    it('an actual Unlock followed by Send without Save keeps unaccepted frozen subjects and the first immutable map', async () => {
      const initial = await send();
      expect(initial.status).toBe(201);
      await db
        .update(s.reviewAssignment)
        .set({ expertId, assignedBy: expertId, assignedAt: new Date() })
        .where(eq(s.reviewAssignment.id, initial.body.assignmentId));
      const original = await db
        .select()
        .from(s.sectionRevision)
        .where(eq(s.sectionRevision.organizationId, fixture.org));
      const originalMap = (
        await pool.query(
          'select to_jsonb(m) as value from review_assignment_section m where review_assignment_id=$1 order by profile_section_id',
          [initial.body.assignmentId],
        )
      ).rows;
      const unlocker = new ProfileUnlockService(appPool, new AuditService(appDb), boss);
      await unlocker.unlock(fixture.actor, {
        operationKey: randomUUID(),
        expectedAssignmentId: initial.body.assignmentId,
      });
      const result = await send();
      expect(result.status).toBe(201);
      expect(result.body.mode).toBe('resubmit');
      expect(
        result.body.sections.every(
          (section: any) =>
            section.reviewRequired &&
            section.retainedDecisionId === null &&
            section.revisionId === fixture.revisions[section.kind],
        ),
      ).toBe(true);
      const old = await db
        .select()
        .from(s.sectionRevision)
        .where(
          inArray(
            s.sectionRevision.id,
            original.map((revision) => revision.id),
          ),
        );
      expect(old).toEqual(original);
      expect(
        (
          await pool.query(
            'select to_jsonb(m) as value from review_assignment_section m where review_assignment_id=$1 order by profile_section_id',
            [initial.body.assignmentId],
          )
        ).rows,
      ).toEqual(originalMap);
      expect(
        (
          await pool.query(
            'select retained_from_assignment_id from review_assignment_section where review_assignment_id=$1',
            [result.body.assignmentId],
          )
        ).rows.every((row) => row.retained_from_assignment_id === initial.body.assignmentId),
      ).toBe(true);
      const [assignment] = await db
        .select()
        .from(s.reviewAssignment)
        .where(eq(s.reviewAssignment.id, result.body.assignmentId));
      expect(assignment!.expertId).toBe(expertId);
      expect(assignment!.reusedFromAssignmentId).toBe(initial.body.assignmentId);
      expect((await state()).jobs).toHaveLength(3);
    });
    it('a concurrent actual Save and Send either freezes the viewed draft or refuses the stale vector, without mixing writes', async () => {
      const body = await request();
      const data = (await submissionHandlers()
        .find((handler) => handler.kind === 'contacts')!
        .editable(db, {
          profileId: fixture.profile,
          organizationId: fixture.org,
          sectionId: fixture.sections.contacts,
          revisionId: fixture.revisions.contacts!,
        })) as { contacts: { email: string | null }[] };
      data.contacts[0]!.email = 'concurrent-edit@submit.local';
      const results = await Promise.allSettled([
        send(body),
        editor.save(fixture.actor, 'contacts', { editVersion: 0, data }),
      ]);
      const sent = results[0];
      const saved = results[1];
      expect(sent.status).toBe('fulfilled');
      const result = (sent as PromiseFulfilledResult<Awaited<ReturnType<typeof send>>>).value;
      if (result.status === 201) {
        expect(saved.status).toBe('rejected');
        expect((await state()).assignments).toHaveLength(1);
        expect((await state()).jobs).toHaveLength(1);
      } else {
        expect(result.status).toBe(409);
        expect(result.body.code).toBe('section_changed');
        expect(saved.status).toBe('fulfilled');
        expect((await state()).assignments).toEqual([]);
        expect((await state()).jobs).toEqual([]);
      }
    });
    it('a frozen optional CV without its exact capture refuses Send instead of repairing history from latest PASSED', async () => {
      const [cv] = await db
        .select()
        .from(s.fileObject)
        .where(and(eq(s.fileObject.organizationId, fixture.org), eq(s.fileObject.purpose, 'cv')));
      const assignmentId = await db.transaction(async (tx) => {
        const requirements = await lockCurrentSubmissionRequirements(tx);
        const sentAt = new Date();
        for (const kind of SECTION_KINDS) {
          const revisionId = fixture.revisions[kind]!;
          if (kind === 'certificates' || kind === 'documents')
            await captureSubmissionRequirements(
              tx,
              {
                profileId: fixture.profile,
                organizationId: fixture.org,
                sectionId: fixture.sections[kind],
                revisionId,
              },
              requirements[kind],
              sentAt,
            );
          await captureRevisionFileVersions(tx as unknown as Database, {
            sectionRevisionId: revisionId,
            organizationId: fixture.org,
          });
        }
        // Deliberately reproduce incomplete legacy evidence while it is still writable; frozen guards remain enabled.
        await tx
          .delete(s.revisionFileVersion)
          .where(
            and(
              eq(s.revisionFileVersion.sectionRevisionId, fixture.revisions.personnel!),
              eq(s.revisionFileVersion.fileObjectId, cv!.id),
            ),
          );
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null })
          .where(eq(s.profileSection.profileId, fixture.profile));
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: sentAt })
          .where(eq(s.sectionRevision.organizationId, fixture.org));
        const [assignment] = await tx
          .insert(s.reviewAssignment)
          .values({
            profileId: fixture.profile,
            organizationId: fixture.org,
            receivedAt: sentAt,
            accuracyConfirmedAt: sentAt,
            submittedBy: fixture.actor.id,
            submissionMode: 'initial',
            operationKey: randomUUID(),
            requestFingerprint: 'a'.repeat(64),
          })
          .returning();
        await tx.insert(s.reviewAssignmentSection).values(
          SECTION_KINDS.map((kind) => ({
            reviewAssignmentId: assignment!.id,
            profileId: fixture.profile,
            organizationId: fixture.org,
            profileSectionId: fixture.sections[kind],
            sectionRevisionId: fixture.revisions[kind]!,
            reviewRequired: true,
          })),
        );
        await tx.insert(s.profileSectionCandidate).values(
          SECTION_KINDS.map((kind) => ({
            profileSectionId: fixture.sections[kind],
            organizationId: fixture.org,
            reviewAssignmentId: assignment!.id,
            sectionRevisionId: fixture.revisions[kind]!,
          })),
        );
        for (const kind of SECTION_KINDS)
          await tx
            .update(s.profileSection)
            .set({ pendingRevisionId: fixture.revisions[kind]! })
            .where(eq(s.profileSection.id, fixture.sections[kind]));
        await tx
          .update(s.manufacturerProfile)
          .set({ status: 'submitted', accuracyConfirmedAt: sentAt })
          .where(eq(s.manufacturerProfile.id, fixture.profile));
        return assignment!.id;
      });
      await approve(assignmentId);
      await editContacts();
      const before = await state();
      const result = await send();
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('submission_file_unavailable');
      expect(await state()).toEqual(before);
      expect(
        await db
          .select()
          .from(s.revisionFileVersion)
          .where(
            and(
              eq(s.revisionFileVersion.sectionRevisionId, fixture.revisions.personnel!),
              eq(s.revisionFileVersion.fileObjectId, cv!.id),
            ),
          ),
      ).toEqual([]);
    });
  },
);
