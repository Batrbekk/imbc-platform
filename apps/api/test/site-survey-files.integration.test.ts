import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { companyPageSchema, ROLES, type Role, type SiteSurveyRecordView } from '@imbc/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { withQueueTransaction } from '../src/database/transaction.js';
import { FILE_SCAN_QUEUE_OPTIONS, QUEUES } from '../src/jobs/queues.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { CatalogController } from '../src/modules/catalog/catalog.controller.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { DiligenceService } from '../src/modules/due-diligence/diligence.service.js';
import { FilesController } from '../src/modules/files/files.controller.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { acceptUpload } from '../src/modules/files/upload.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { ProfileReviewService, profileReviewEvidence } from '../src/modules/profiles/profile-review.service.js';
import { profileCandidateRevisions, profileSubmissionRevisions } from '../src/modules/profiles/profile-candidate.js';
import { SiteSurveyPublicationService } from '../src/modules/site-survey/site-survey-publication.service.js';
import { SiteSurveyService } from '../src/modules/site-survey/site-survey.service.js';
import { SiteSurveyUploadService } from '../src/modules/site-survey/site-survey-upload.service.js';
import { FileScanJob } from '../src/worker/file-scan.job.js';
import { StubAntivirus } from './support/antivirus-stub.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';
import { MemoryObjectStorage } from './support/memory-storage.js';
import { ORGANIZATION_TYPE } from './support/organization-type.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';

const bytes = readFileSync(new URL('./fixtures/files/sample.pdf', import.meta.url));
const env = { S3_BUCKET_QUARANTINE: 'survey-files-test-quarantine', S3_BUCKET_FILES: 'survey-files-test-files' } as Env;
type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
const content = (fileId: string, version?: number) =>
  `/api/v1/files/${fileId}/content${version === undefined ? '' : `?version=${version}`}`;
const company = (g: Fixture) => `/api/v1/catalog/companies/${g.profile}`;
const edit = (row: SiteSurveyRecordView) => ({
  visitStartedOn: row.visitStartedOn!,
  visitEndedOn: row.visitEndedOn,
  result: row.result,
  reportFileId: row.reportFileId,
  expiresOn: row.expiresOn,
  comment: row.comment,
  expectedUpdatedAt: row.updatedAt,
});

/** Canonical submit/review + actual audited DD override + actual Survey publication, real file HTTP; no live storage/mail. */
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'Survey company/current/history file boundary on actual PostgreSQL and HTTP',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool,
      appPool: pg.Pool,
      db: Database,
      boss: PgBoss,
      audit: AuditService,
      files: FilesService,
      catalog: CatalogService;
    let surveys: SiteSurveyService,
      uploads: SiteSurveyUploadService,
      diligence: DiligenceService,
      storage: MemoryObjectStorage,
      scan: FileScanJob;
    let expert: AuthUser;
    const actors = {} as Record<Role, AuthUser>,
      stands: HttpStand[] = [],
      dbRole = 'survey_files_' + randomUUID().replaceAll('-', '');
    const stand = async (actor: AuthUser) => {
      const http = await startHttp({
        controllers: [FilesController, CatalogController],
        providers: [
          { provide: FilesService, useValue: files },
          { provide: CatalogService, useValue: catalog },
        ],
        organizationId: actor.organizationId,
        accountIds: { [actor.role]: actor.id },
      });
      stands.push(http);
      return http;
    };
    const report = async (g: Fixture, name = 'signed.pdf', data = bytes) => {
      const accepted = await acceptUpload({
        buffer: data,
        originalname: name,
        mimetype: 'application/pdf',
      } as Express.Multer.File);
      const result = (await uploads.upload(expert, g.profile, accepted, null)).upload;
      expect(await scan.run({ fileVersionId: result.versionId! })).toBe('passed');
      return result;
    };
    const add = async (
      g: Fixture,
      visit = '2020-01-01',
      options: { fileId?: string; result?: 'yes' | 'no'; expiresOn?: string | null } = {},
    ) => {
      const fileId = options.fileId ?? (await report(g)).fileId;
      return surveys.create(
        expert,
        g.profile,
        {
          visitStartedOn: visit,
          visitEndedOn: null,
          result: options.result ?? 'yes',
          expiresOn: options.expiresOn ?? null,
          reportFileId: fileId,
          comment: 'INTERNAL CLASS C SURVEY COMMENT',
        },
        randomUUID(),
      );
    };
    const day = async (offset = 0) =>
      (await pool.query("select ((clock_timestamp() at time zone 'Asia/Almaty')::date+$1::int)::text as day", [offset]))
        .rows[0]!.day as string;
    const dd = async (g: Fixture, result: 'green' | 'amber' | 'red') => {
      const current = await diligence.read({ actor: expert }, g.profile);
      return diligence.override({ actor: expert }, g.profile, {
        result,
        comment: 'INTERNAL DD OVERRIDE COMMENT',
        reportFileId: null,
        expectedUpdatedAt: current.record?.updatedAt ?? null,
      });
    };
    const verify = async (g: Fixture) => {
      const submit = new ProfileSubmitService(appPool, audit, boss, submissionHandlers()),
        core = new ProfileReviewService(appPool, audit, boss);
      const candidates = await profileCandidateRevisions(db, { profileId: g.profile, organizationId: g.org });
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
      const evidence = await profileReviewEvidence(db, { profile, map });
      for (const fact of evidence.filter((f) => f.subject.kind !== 'file' && f.subject.kind !== 'section'))
        await core.decide(expert, sent.assignmentId, { subject: fact.subject, outcome: 'verified', comment: null });
      for (const fact of evidence.filter((f) => f.subject.kind === 'section'))
        await core.decide(expert, sent.assignmentId, { subject: fact.subject, outcome: 'verified', comment: null });
      await core.submitResult(expert, sent.assignmentId);
    };
    const visible = async (result: 'green' | 'amber' = 'green') => {
      const g = await seedSubmissionProfile(pool);
      await verify(g);
      await dd(g, result);
      return g;
    };
    // Explicit adversarial catalogue control only. Business DD/profile/survey changes still use their actual services.
    const catalogRaw = async (g: Fixture) =>
      (await pool.query('select to_jsonb(c) as raw from catalog_visible c where profile_id=$1', [g.profile])).rows[0]!
        .raw as Record<string, unknown>;
    const forgeCatalog = async (raw: Record<string, unknown>) => {
      await pool.query('delete from catalog_visible where profile_id=$1', [raw.profile_id]);
      const columns = (
        await pool.query<{ columns: string }>(
          `select string_agg(quote_ident(attname),',' order by attnum) as columns from pg_attribute
           where attrelid='catalog_visible'::regclass and attnum>0 and not attisdropped and attgenerated=''`,
        )
      ).rows[0]!.columns;
      await pool.query(
        `insert into catalog_visible(${columns}) select ${columns} from jsonb_populate_record(null::catalog_visible,$1::jsonb)`,
        [JSON.stringify(raw)],
      );
    };
    const denies = async (http: HttpStand, fileId: string, role: Role, status = 403) => {
      const before = (
        await pool.query(
          "select count(*)::int as n from audit_entries where user_id=$1 and object_id=$2 and action='file.read' and outcome='denied'",
          [actors[role].id, fileId],
        )
      ).rows[0]!.n;
      const response = await http.get(content(fileId, 1), role);
      expect(response.status).toBe(status);
      if (status === 403) {
        expect(await response.json()).toMatchObject({ code: 'forbidden' });
        expect(
          (
            await pool.query(
              "select count(*)::int as n from audit_entries where user_id=$1 and object_id=$2 and action='file.read' and outcome='denied'",
              [actors[role].id, fileId],
            )
          ).rows[0]!.n,
        ).toBe(before + 1);
      }
    };
    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema, casing: 'snake_case' });
      const imbc = (await db.select().from(schema.organizations).where(eq(schema.organizations.type, 'imbc')))[0]!;
      for (const role of ROLES) {
        const org =
          ORGANIZATION_TYPE[role] === 'imbc'
            ? imbc
            : (
                await db
                  .insert(schema.organizations)
                  .values({ name: `File boundary ${role}`, type: ORGANIZATION_TYPE[role] })
                  .returning()
              )[0]!;
        const a = (
          await db
            .insert(schema.userAccounts)
            .values({ organizationId: org.id, role, state: 'active', email: `${randomUUID()}@survey.local` })
            .returning()
        )[0]!;
        actors[role] = {
          id: a.id,
          organizationId: org.id,
          organizationType: org.type,
          role,
          email: a.email,
          fullName: null,
          locale: 'en',
        };
      }
      expert = actors.expert;
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.fileScan, FILE_SCAN_QUEUE_OPTIONS);
      await boss.createQueue(QUEUES.notify);
      await pool.query(`create role "${dbRole}" nologin`);
      await applyAppRoleGrants(pool, dbRole);
      await pool.query(
        `grant usage on schema pgboss_auth_test to "${dbRole}";grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${dbRole}"`,
      );
      appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c role=${dbRole}`, max: 5 });
      const appDb = drizzle(appPool, { schema, casing: 'snake_case' });
      audit = new AuditService(appDb);
      storage = new MemoryObjectStorage();
      files = new FilesService(appDb, boss, storage, env, audit);
      uploads = new SiteSurveyUploadService(appPool, files, audit);
      surveys = new SiteSurveyService(appPool, audit, new SiteSurveyPublicationService());
      diligence = new DiligenceService(appPool, audit);
      scan = new FileScanJob(db, storage, new StubAntivirus(), env, new AuditService(db), boss, {});
      catalog = new CatalogService(appDb, { get: async () => null, set: async () => null } as unknown as Redis);
    });
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      for (const h of stands) await h.close();
      await boss?.stop();
      await appPool?.end();
      if (pool) await pool.query(`drop owned by "${dbRole}";drop role "${dbRole}"`);
      await pool?.end();
    });
    it.each(ROLES)('enforces current saved report access for the real %s account', async (role) => {
      const g = await visible(),
        record = await add(g),
        http = await stand(actors[role]);
      if (['expert', 'director', 'operator', 'observer'].includes(role)) {
        const response = await http.get(content(record.reportFileId!, 1), role);
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
        expect(response.headers.get('content-disposition')).toContain('attachment');
      } else await denies(http, record.reportFileId!, role);
    });
    it.each(ROLES)('denies an unbound passed candidate even for %s', async (role) => {
      const g = await visible(),
        file = await report(g),
        http = await stand(actors[role]);
      await denies(http, file.fileId, role);
    });
    it.each(['green', 'amber'] as const)(
      'company %s visibility exposes only dates and the current exact report, without internal fields',
      async (result) => {
        const g = await visible(result),
          record = await add(g),
          operator = await stand(actors.operator),
          observer = await stand(actors.observer);
        for (const [http, role] of [
          [operator, 'operator'],
          [observer, 'observer'],
        ] as const) {
          const response = await http.get(company(g), role);
          expect(response.status).toBe(200);
          const raw = (await response.json()) as Record<string, unknown>,
            page = companyPageSchema.parse(raw);
          expect(page.siteSurveyed).toBe(true);
          expect(page.tier).toBe('tier_2');
          expect(Object.keys(raw.siteSurvey as Record<string, unknown>).sort()).toEqual([
            'expiresOn',
            'report',
            'visitEndedOn',
            'visitStartedOn',
          ]);
          expect(page.siteSurvey?.report).toMatchObject({
            fileId: record.reportFileId,
            versionId: record.reportFileVersionId,
            versionNumber: 1,
            scanState: 'passed',
            canDownload: true,
          });
          const surveyJSON = JSON.stringify(raw.siteSurvey);
          for (const excluded of [
            'INTERNAL CLASS C SURVEY COMMENT',
            'source',
            'recordedBy',
            'recordedAt',
            'updatedAt',
            'history',
            'recordId',
          ])
            expect(surveyJSON).not.toContain(excluded);
          if (role === 'observer') expect(raw).not.toHaveProperty('focalPoint');
        }
      },
    );
    it('uses the saved v1 pin despite a later global pending v2 for every allowed reader and HEAD', async () => {
      const g = await visible(),
        record = await add(g),
        accepted = await acceptUpload({
          buffer: bytes,
          originalname: 'pending-v2.pdf',
          mimetype: 'application/pdf',
        } as Express.Multer.File);
      const next = await files.withStagedObject(accepted, (key) =>
        withQueueTransaction(appPool, (tx, queueDb) =>
          files.recordVersion(tx, queueDb, record.reportFileId!, {
            uploadedBy: expert.id,
            upload: accepted,
            storageKey: key,
          }),
        ),
      );
      expect(next.versionNumber).toBe(2);
      for (const role of ['expert', 'director', 'operator', 'observer'] as const) {
        const http = await stand(actors[role]),
          response = await http.get(content(record.reportFileId!), role);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-disposition')).toContain('signed.pdf');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
        expect((await http.get(content(record.reportFileId!, 2), role)).status).toBe(404);
      }
      const http = await stand(actors.operator),
        get = vi.spyOn(storage, 'get');
      get.mockClear();
      const head = await fetch(http.base + content(record.reportFileId!, 1), {
        method: 'HEAD',
        headers: { cookie: 'imbc-session=operator' },
      });
      expect(head.status).toBe(200);
      expect(get).not.toHaveBeenCalled();
      expect(
        companyPageSchema.parse(await (await http.get(company(g), 'operator')).json()).siteSurvey?.report.versionId,
      ).toBe(record.reportFileVersionId);
    });
    it('replacement keeps the old exact report and immutable metadata accessible to staff only', async () => {
      const g = await visible(),
        first = await add(g),
        replacement = await report(g, 'replacement.pdf');
      const current = await surveys.update(expert, g.profile, first.id, {
        ...edit(first),
        reportFileId: replacement.fileId,
        comment: 'SECOND INTERNAL COMMENT',
      });
      for (const role of ['expert', 'director'] as const) {
        const http = await stand(actors[role]);
        expect((await http.get(content(first.reportFileId!, 1), role)).status).toBe(200);
        const history = await surveys.history(actors[role], g.profile, current.id, {});
        expect(history.items.some((item) => item.before?.reportFileVersionId === first.reportFileVersionId)).toBe(true);
      }
      for (const role of ['operator', 'observer'] as const) {
        const http = await stand(actors[role]);
        await denies(http, first.reportFileId!, role);
        expect((await http.get(content(current.reportFileId!, 1), role)).status).toBe(200);
        const page = companyPageSchema.parse(await (await http.get(company(g), role)).json());
        expect(page.siteSurvey?.report.fileId).toBe(replacement.fileId);
      }
    });
    it('a newer No does not cancel an older eligible Yes; expiring the newest Yes falls back to the older report', async () => {
      const g = await visible(),
        old = await add(g, '2019-01-01'),
        no = await add(g, '2021-01-01', { result: 'no' }),
        http = await stand(actors.operator);
      const first = companyPageSchema.parse(await (await http.get(company(g), 'operator')).json());
      expect(first.siteSurvey?.report.fileId).toBe(old.reportFileId);
      await denies(http, no.reportFileId!, 'operator');
      const newest = await add(g, '2025-01-01', { expiresOn: await day(1) });
      expect(
        companyPageSchema.parse(await (await http.get(company(g), 'operator')).json()).siteSurvey?.report.fileId,
      ).toBe(newest.reportFileId);
      await surveys.update(expert, g.profile, newest.id, { ...edit(newest), expiresOn: await day() });
      const fallback = companyPageSchema.parse(await (await http.get(company(g), 'operator')).json());
      expect(fallback.siteSurvey?.report.fileId).toBe(old.reportFileId);
      await denies(http, newest.reportFileId!, 'operator');
      expect((await http.get(content(old.reportFileId!, 1), 'operator')).status).toBe(200);
      await surveys.update(expert, g.profile, old.id, { ...edit(old), expiresOn: await day(-1) });
      const expired = companyPageSchema.parse(await (await http.get(company(g), 'operator')).json());
      expect(expired.siteSurvey).toBeNull();
      expect(expired.siteSurveyed).toBe(false);
      expect(expired.tier).toBe('tier_1');
      await denies(http, old.reportFileId!, 'operator');
    });
    it('fresh DD red denies public bytes despite a deliberately stale catalogue row', async () => {
      const g = await visible(),
        record = await add(g),
        raw = await catalogRaw(g),
        http = await stand(actors.operator);
      await dd(g, 'red');
      expect((await pool.query('select 1 from catalog_visible where profile_id=$1', [g.profile])).rowCount).toBe(0);
      await forgeCatalog(raw);
      await denies(http, record.reportFileId!, 'operator');
      const page = await http.get(company(g), 'operator');
      expect(page.status).toBe(404);
    });
    it('a forged mismatched seven-revision catalogue graph cannot expose the report', async () => {
      const g = await visible(),
        record = await add(g),
        raw = await catalogRaw(g),
        http = await stand(actors.observer);
      const card = raw.card as { verifiedRevisionIds: Record<string, string> };
      card.verifiedRevisionIds.contacts = randomUUID();
      await forgeCatalog(raw);
      await denies(http, record.reportFileId!, 'observer');
      const page = await http.get(company(g), 'observer');
      expect(page.status).toBe(404);
    });
    it('a nonVerified profile cannot gain report access from a forged catalogue row', async () => {
      const source = await visible(),
        raw = await catalogRaw(source),
        g = await seedSubmissionProfile(pool),
        record = await add(g);
      await dd(g, 'green');
      await forgeCatalog({ ...raw, profile_id: g.profile, organization_id: g.org });
      const http = await stand(actors.operator);
      await denies(http, record.reportFileId!, 'operator');
      expect((await http.get(company(g), 'operator')).status).toBe(404);
    });
    it.each(['operator', 'observer', 'expert', 'director'] as const)(
      'fresh blocked or changed role %s cannot read, and denial is audited',
      async (role) => {
        const g = await visible(),
          record = await add(g),
          http = await stand(actors[role]);
        await db
          .update(schema.userAccounts)
          .set({ state: 'blocked' })
          .where(eq(schema.userAccounts.id, actors[role].id));
        try {
          await denies(http, record.reportFileId!, role);
        } finally {
          await db
            .update(schema.userAccounts)
            .set({ state: 'active' })
            .where(eq(schema.userAccounts.id, actors[role].id));
        }
        await db
          .update(schema.userAccounts)
          .set({ role: 'administrator' })
          .where(eq(schema.userAccounts.id, actors[role].id));
        try {
          await denies(http, record.reportFileId!, role);
        } finally {
          await db.update(schema.userAccounts).set({ role }).where(eq(schema.userAccounts.id, actors[role].id));
        }
      },
    );
    it.each(['operator', 'observer', 'expert', 'director'] as const)(
      'uses current persisted file-read policy for %s and audits rejection',
      async (role) => {
        const g = await visible(),
          record = await add(g),
          http = await stand(actors[role]),
          action = ['expert', 'director'].includes(role) ? 'imbc_records.read' : 'catalog.search';
        const rules = (
          await pool.query('select id,effect from policy_rule where role=$1 and action=$2', [role, action])
        ).rows;
        await pool.query("update policy_rule set effect='deny' where role=$1 and action=$2", [role, action]);
        try {
          await denies(http, record.reportFileId!, role);
        } finally {
          for (const r of rules) await pool.query('update policy_rule set effect=$1 where id=$2', [r.effect, r.id]);
        }
      },
    );
    it.each(['operator', 'observer'] as const)(
      'refuses company metadata under current denied or incorrectly scoped policy for %s and audits the route',
      async (role) => {
        const g = await visible();
        await add(g);
        const http = await stand(actors[role]);
        expect((await http.get(company(g), role)).status).toBe(200);
        const rules = (
          await pool.query("select id,effect,condition from policy_rule where role=$1 and action='catalog.search'", [
            role,
          ])
        ).rows;
        const before = (
          await pool.query(
            "select count(*)::int as n from audit_entries where user_id=$1 and action='catalog.search' and object_type='route' and outcome='denied'",
            [actors[role].id],
          )
        ).rows[0]!.n;
        try {
          for (const mutation of ["effect='deny'", "effect='allow',condition='own_organisation'"]) {
            await pool.query(`update policy_rule set ${mutation} where role=$1 and action='catalog.search'`, [role]);
            const response = await http.get(company(g), role);
            expect(response.status).toBe(403);
            expect(await response.json()).not.toHaveProperty('siteSurvey');
          }
          expect(
            (
              await pool.query(
                "select count(*)::int as n from audit_entries where user_id=$1 and action='catalog.search' and object_type='route' and outcome='denied'",
                [actors[role].id],
              )
            ).rows[0]!.n,
          ).toBe(before + 2);
        } finally {
          for (const rule of rules)
            await pool.query('update policy_rule set effect=$1,condition=$2 where id=$3', [
              rule.effect,
              rule.condition,
              rule.id,
            ]);
        }
        expect((await http.get(company(g), role)).status).toBe(200);
      },
    );
  },
);
