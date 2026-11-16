import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DataClass, FilePurpose } from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import type { AuthContext, AuthUser } from '../src/modules/auth/auth.types.js';
import { FilesService } from '../src/modules/files/files.service.js';
import {
  claimUnusedProfileUpload,
  fileHasReferences,
  UNUSED_PROFILE_UPLOAD_TTL_MS,
} from '../src/modules/files/file-cleanup.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { PersonnelHandler } from '../src/modules/profiles/personnel.handler.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { profileFiles, validateProfileFileBindings } from '../src/modules/profiles/profile-files.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { FileCleanupJob } from '../src/worker/file-cleanup.job.js';
import { FileScanJob } from '../src/worker/file-scan.job.js';
import { StubAntivirus } from './support/antivirus-stub.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { MemoryObjectStorage } from './support/memory-storage.js';

const QUARANTINE = 'purge-quarantine';
const FILES = 'purge-files';
const bytes = readFileSync(new URL('./fixtures/files/sample.pdf', import.meta.url));
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const OWNER_COLUMNS = {
  object: 'object_ref',
  version: 'version_ref',
  version_number: 'object_v,version_number',
} as const;

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'unused upload purge with real PostgreSQL FK guards and object-storage races',
  () => {
    vi.setConfig({ testTimeout: 30000 });
    let pool: pg.Pool;
    let db: Database;
    let storage: MemoryObjectStorage;
    let audit: AuditService;
    let cleanup: FileCleanupJob;
    let scanner: FileScanJob;
    let files: FilesService;
    let queue: { send: ReturnType<typeof vi.fn> };
    let profile: typeof s.manufacturerProfile.$inferSelect;
    let actor: AuthUser;
    let context: { profileId: string; organizationId: string; sectionId: string; revisionId: string };
    let clock: Date;
    let old: Date;
    let seed = 0;
    const env = { S3_BUCKET_QUARANTINE: QUARANTINE, S3_BUCKET_FILES: FILES } as Env;
    const auth = (): AuthContext => ({
      user: actor,
      sessionId: randomUUID(),
      mfaPassed: true,
      responsibilityAccepted: true,
    });

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
      // Future version-number and direct version FKs must be protected without changing hard-coded owner lists.
      await pool.query(`create table cleanup_future_owner(id uuid primary key default uuidv7(),
      object_ref uuid references file_object(id), version_ref uuid references file_version(id),
      object_v uuid, version_number int,
      foreign key(object_v,version_number) references file_version(file_object_id,version_number));
      select install_file_binding_guards()`);
      clock = new Date();
      old = new Date(clock.getTime() - UNUSED_PROFILE_UPLOAD_TTL_MS - 60_000);
    }, 60000);
    beforeEach(async () => {
      const id = randomUUID();
      const [org] = await db
        .insert(s.organizations)
        .values({ type: 'manufacturer', name: `Purge ${id}`, bin: `2416${String(++seed).padStart(8, '0')}` })
        .returning();
      const [account] = await db
        .insert(s.userAccounts)
        .values({ organizationId: org!.id, role: 'manufacturer', state: 'active', email: `${id}@purge.local` })
        .returning();
      const [created] = await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning();
      profile = created!;
      actor = {
        id: account!.id,
        email: account!.email,
        role: 'manufacturer',
        organizationId: org!.id,
        organizationType: 'manufacturer',
        locale: 'kk',
        fullName: null,
      };
      const [section] = await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'personnel')));
      context = {
        profileId: profile.id,
        organizationId: org!.id,
        sectionId: section!.id,
        revisionId: section!.workingRevisionId!,
      };
      storage = new MemoryObjectStorage();
      audit = new AuditService(db);
      queue = { send: vi.fn(async () => randomUUID()) };
      files = new FilesService(db, queue as unknown as PgBoss, storage, env, audit);
      scanner = new FileScanJob(db, storage, new StubAntivirus(), env, audit, queue as unknown as PgBoss, {});
      cleanup = new FileCleanupJob(db, storage, env, audit, queue as unknown as PgBoss);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });
    afterAll(async () => {
      await pool?.end();
    });

    const file = async (
      options: {
        state?: 'passed' | 'rejected' | 'pending';
        uploadedAt?: Date;
        purpose?: FilePurpose;
        dataClass?: DataClass;
      } = {},
    ) => {
      const [object] = await db
        .insert(s.fileObject)
        .values({
          organizationId: profile.organizationId,
          purpose: options.purpose ?? 'organisation_chart',
          dataClass: options.dataClass ?? 'b_manufacturer',
        })
        .returning();
      const [version] = await db
        .insert(s.fileVersion)
        .values({
          fileObjectId: object!.id,
          versionNumber: 1,
          originalName: 'Private aged evidence.pdf',
          byteSize: bytes.length,
          declaredMediaType: 'application/pdf',
          detectedMediaType: 'application/pdf',
          checksum: createHash('sha256').update(bytes).digest('hex'),
          scanState: options.state ?? 'passed',
          uploadedAt: options.uploadedAt ?? old,
          uploadedBy: actor.id,
          storageKey: randomUUID(),
          rejectionReason: options.state === 'rejected' ? 'malware' : null,
        })
        .returning();
      await storage.put(QUARANTINE, version!.storageKey, bytes, 'application/pdf');
      if (version!.scanState !== 'pending') await storage.put(FILES, version!.storageKey, bytes, 'application/pdf');
      return { object: object!, version: version! };
    };
    const object = async (id: string) => (await db.select().from(s.fileObject).where(eq(s.fileObject.id, id)))[0];
    const owner = (kind: keyof typeof OWNER_COLUMNS, item: Awaited<ReturnType<typeof file>>) =>
      pool.query(
        `insert into cleanup_future_owner(${OWNER_COLUMNS[kind]}) values (${kind === 'version_number' ? '$1,$2' : '$1'})`,
        kind === 'version' ? [item.version.id] : kind === 'version_number' ? [item.object.id, 1] : [item.object.id],
      );
    const waitForParentWait = () =>
      vi.waitFor(
        async () => {
          const { rows } = await pool.query<{
            n: number;
          }>(`select count(*)::int n from pg_stat_activity where datname=current_database()
      and wait_event_type='Lock' and query like '%file_object%'`);
          expect(rows[0]!.n).toBeGreaterThan(0);
        },
        { timeout: 2000, interval: 20 },
      );
    const savePersonnel = (fileId: string, editVersion = 0) =>
      new ProfileSectionsService(pool, audit, [defineSectionHandler(new PersonnelHandler())]).save(actor, 'personnel', {
        editVersion,
        data: {
          managersCount: 1,
          engineersCount: 2,
          productionWorkersCount: 3,
          nonresidentCount: 0,
          organisationChartIds: [fileId],
          cvFileIds: [],
        },
      });

    it.each(['passed', 'rejected'] as const)(
      'purges an old terminal %s orphan from both buckets and DB only after storage succeeds',
      async (state) => {
        const item = await file({ state });
        expect(await cleanup.run({ fileObjectId: item.object.id }, clock)).toBe('purged');
        expect(await object(item.object.id)).toBeUndefined();
        expect(await db.select().from(s.fileVersion).where(eq(s.fileVersion.id, item.version.id))).toEqual([]);
        expect(storage.keys(QUARANTINE)).toEqual([]);
        expect(storage.keys(FILES)).toEqual([]);
        expect(await cleanup.run({ fileObjectId: item.object.id }, clock)).toBe('skipped');
        const { rows } = await pool.query('select diff from audit_entries where action=$1 and object_id=$2', [
          'file.orphan_purged',
          item.object.id,
        ]);
        expect(rows).toEqual([{ diff: { versionCount: 1 } }]);
      },
    );

    it('retains recent, pending, administrative and unsupported-purpose files', async () => {
      const items = [
        await file({ uploadedAt: clock }),
        await file({ state: 'pending' }),
        await file({ dataClass: 'e_administration' }),
        await file({ purpose: 'site_survey_report' }),
      ];
      for (const item of items) expect(await cleanup.run({ fileObjectId: item.object.id }, clock)).toBe('skipped');
      expect(storage.keys(QUARANTINE)).toHaveLength(4);
      for (const item of items) expect((await object(item.object.id))?.purgeRequestedAt).toBeNull();
    });

    it.each(['object', 'version', 'version_number'] as const)(
      'catalog retention recognizes a future %s foreign key',
      async (kind) => {
        const item = await file();
        await owner(kind, item);
        expect(await db.transaction((tx) => fileHasReferences(tx as Database, item.object.id))).toBe(true);
        expect(await cleanup.run({ fileObjectId: item.object.id }, clock)).toBe('skipped');
        expect(storage.objects.get(`${FILES}/${item.version.storageKey}`)).toEqual(bytes);
      },
    );

    it.each(['snapshot', 'history'] as const)(
      'an exact %s reference alone prevents purge even with no current domain owner',
      async (kind) => {
        const item = await file();
        if (kind === 'snapshot')
          await db.insert(s.revisionFileVersion).values({
            sectionRevisionId: context.revisionId,
            organizationId: context.organizationId,
            fileObjectId: item.object.id,
            fileVersionId: item.version.id,
          });
        else
          await db.insert(s.profileFileHistory).values({
            sectionRevisionId: context.revisionId,
            organizationId: context.organizationId,
            fileObjectId: item.object.id,
            fileVersionId: item.version.id,
            editVersion: 1,
            actorId: actor.id,
          });
        expect(await cleanup.run({ fileObjectId: item.object.id }, clock)).toBe('skipped');
        expect((await object(item.object.id))?.purgeRequestedAt).toBeNull();
      },
    );

    it('a legacy plural document owner is retained by its actual FK', async () => {
      const item = await file({ purpose: 'document_file' });
      const [section] = await db
        .insert(s.profileSections)
        .values({ profileId: profile.id, kind: 'documents' })
        .returning();
      const [revision] = await db.insert(s.sectionRevisions).values({ sectionId: section!.id, number: 1 }).returning();
      await db
        .insert(s.documents)
        .values({ revisionId: revision!.id, typeCode: 'registration_certificate', fileId: item.object.id });
      expect(await cleanup.run({ fileObjectId: item.object.id }, clock)).toBe('skipped');
      expect(storage.objects.get(`${FILES}/${item.version.storageKey}`)).toEqual(bytes);
    });

    it('draft F to G replacement retains old F bytes through append-only save history', async () => {
      const first = await file();
      const second = await file();
      const saved = await savePersonnel(first.object.id);
      await savePersonnel(second.object.id, saved.editVersion);
      expect(
        await db.select().from(s.profileFileHistory).where(eq(s.profileFileHistory.fileObjectId, first.object.id)),
      ).not.toEqual([]);
      expect(await cleanup.run({ fileObjectId: first.object.id }, clock)).toBe('skipped');
      const opened = await files.open(auth(), first.object.id, 1, null);
      const chunks: Buffer[] = [];
      for await (const part of opened.stream) chunks.push(Buffer.from(part));
      expect(Buffer.concat(chunks)).toEqual(bytes);
    });

    it('frozen F version 1 stays exact and downloadable after version 2 and a new working G', async () => {
      const first = await file();
      const second = await file();
      const saved = await savePersonnel(first.object.id);
      await db.transaction(async (tx) => {
        await captureRevisionFileVersions(tx as Database, {
          sectionRevisionId: saved.revisionId!,
          organizationId: context.organizationId,
        });
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: new Date() })
          .where(eq(s.sectionRevision.id, saved.revisionId!));
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null, verifiedRevisionId: saved.revisionId! })
          .where(eq(s.profileSection.id, context.sectionId));
        await tx
          .update(s.sectionRevision)
          .set({ state: 'verified' })
          .where(eq(s.sectionRevision.id, saved.revisionId!));
        await tx
          .update(s.manufacturerProfile)
          .set({ status: 'verified' })
          .where(eq(s.manufacturerProfile.id, profile.id));
      });
      const [v2] = await db
        .insert(s.fileVersion)
        .values({
          fileObjectId: first.object.id,
          versionNumber: 2,
          originalName: 'Replacement.pdf',
          byteSize: bytes.length,
          declaredMediaType: 'application/pdf',
          detectedMediaType: 'application/pdf',
          checksum: first.version.checksum,
          scanState: 'passed',
          uploadedAt: old,
          uploadedBy: actor.id,
          storageKey: randomUUID(),
        })
        .returning();
      await storage.put(FILES, v2!.storageKey, bytes, 'application/pdf');
      await savePersonnel(second.object.id, saved.editVersion);
      const frozen = await db.transaction((tx) =>
        profileFiles(tx as Database, { ...context, revisionId: saved.revisionId! }, [first.object.id]),
      );
      expect(frozen[0]).toMatchObject({ versionId: first.version.id, versionNumber: 1, canDownload: true });
      expect(await cleanup.run({ fileObjectId: first.object.id }, clock)).toBe('skipped');
      expect(storage.objects.get(`${FILES}/${first.version.storageKey}`)).toEqual(bytes);
    });

    it.each(['object', 'version', 'version_number'] as const)(
      'claim rejects a new %s FK, version insertion, API binding and read while storage deletion is paused',
      async (kind) => {
        const item = await file();
        const entered = gate();
        const release = gate();
        const original = storage.remove.bind(storage);
        vi.spyOn(storage, 'remove').mockImplementationOnce(async (...args) => {
          entered.resolve();
          await release.promise;
          await original(...args);
        });
        const pending = cleanup.run({ fileObjectId: item.object.id }, clock);
        await entered.promise;
        expect((await object(item.object.id))?.purgeRequestedAt).not.toBeNull();
        await expect(owner(kind, item)).rejects.toMatchObject({
          code: '23514',
          constraint: 'file_binding_not_purging',
        });
        await expect(
          db
            .insert(s.fileVersion)
            .values({ ...item.version, id: randomUUID(), versionNumber: 2, storageKey: randomUUID() }),
        ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'file_binding_not_purging' } });
        await expect(
          db.transaction((tx) =>
            validateProfileFileBindings(tx as Database, context, [
              { fileId: item.object.id, purposes: ['organisation_chart'], path: 'organisationChartIds.0' },
            ]),
          ),
        ).rejects.toMatchObject({ code: 'validation' });
        await expect(files.describe(auth(), item.object.id, 1, null)).rejects.toMatchObject({ code: 'not_found' });
        await expect(
          db.update(s.fileObject).set({ purgeRequestedAt: null }).where(eq(s.fileObject.id, item.object.id)),
        ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'file_purge_claim_immutable' } });
        release.resolve();
        expect(await pending).toBe('purged');
      },
    );

    it.each(['object', 'version', 'version_number'] as const)(
      'cleanup waiting behind a %s binding rechecks ownership after acquiring its lock',
      async (kind) => {
        const item = await file();
        const client = await pool.connect();
        await client.query('begin');
        try {
          await client.query(
            `insert into cleanup_future_owner(${OWNER_COLUMNS[kind]}) values (${kind === 'version_number' ? '$1,$2' : '$1'})`,
            kind === 'version' ? [item.version.id] : kind === 'version_number' ? [item.object.id, 1] : [item.object.id],
          );
          const pending = cleanup.run({ fileObjectId: item.object.id }, clock);
          await waitForParentWait();
          expect((await object(item.object.id))?.purgeRequestedAt).toBeNull();
          await client.query('commit');
          expect(await pending).toBe('skipped');
        } finally {
          await client.query('rollback');
          client.release();
        }
        expect(storage.objects.get(`${FILES}/${item.version.storageKey}`)).toEqual(bytes);
      },
    );

    it('storage failure keeps the claim and all DB rows for an idempotent retry', async () => {
      const item = await file();
      storage.failNext('remove');
      await expect(cleanup.run({ fileObjectId: item.object.id }, clock)).rejects.toThrow(
        'File purge storage unavailable',
      );
      expect((await object(item.object.id))?.purgeRequestedAt).not.toBeNull();
      expect(await db.select().from(s.fileVersion).where(eq(s.fileVersion.id, item.version.id))).toHaveLength(1);
      expect(await cleanup.run({ fileObjectId: item.object.id }, clock)).toBe('purged');
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(storage.keys(FILES)).toEqual([]);
    });

    it('a late scanner cannot recreate blobs after another scan completes and cleanup claims the object', async () => {
      const item = await file({ state: 'pending' });
      const entered = gate();
      const release = gate();
      const lateAntivirus = {
        scan: async (body: AsyncIterable<Buffer>) => {
          for await (const _part of body) {
          }
          entered.resolve();
          await release.promise;
          return { clean: true as const };
        },
      };
      const lateScanner = new FileScanJob(db, storage, lateAntivirus, env, audit, queue as unknown as PgBoss, {});
      const copy = vi.spyOn(storage, 'copy');
      const late = lateScanner.run({ fileVersionId: item.version.id }, clock);
      await entered.promise;
      expect(await scanner.run({ fileVersionId: item.version.id }, clock)).toBe('passed');
      expect(await cleanup.run({ fileObjectId: item.object.id }, clock)).toBe('purged');
      release.resolve();
      expect(await late).toBe('skipped');
      expect(copy).toHaveBeenCalledOnce();
      expect(storage.keys(FILES)).toEqual([]);
      expect(storage.keys(QUARANTINE)).toEqual([]);
    });

    it('a copy in progress holds the parent lock through its decision, and cleanup rechecks terminal state afterward', async () => {
      const item = await file({ state: 'pending' });
      const entered = gate();
      const release = gate();
      const original = storage.copy.bind(storage);
      vi.spyOn(storage, 'copy').mockImplementationOnce(async (...args) => {
        entered.resolve();
        await release.promise;
        await original(...args);
      });
      const scanning = scanner.run({ fileVersionId: item.version.id }, clock);
      await entered.promise;
      const pending = cleanup.run({ fileObjectId: item.object.id }, clock);
      await waitForParentWait();
      expect((await object(item.object.id))?.purgeRequestedAt).toBeNull();
      release.resolve();
      expect(await scanning).toBe('passed');
      expect(await pending).toBe('purged');
      expect(storage.keys(FILES)).toEqual([]);
      expect(storage.keys(QUARANTINE)).toEqual([]);
    });

    it('sweep filters retained old files before LIMIT and only enqueues eligible or claimed candidates', async () => {
      const retained = await file();
      await owner('version_number', retained);
      const candidate = await file();
      await file({ state: 'pending' });
      await file({ uploadedAt: clock });
      const result = await cleanup.sweep(clock);
      expect(result.enqueued).toBe(1);
      expect(queue.send).toHaveBeenCalledWith(
        'file-cleanup',
        { fileObjectId: candidate.object.id },
        { singletonKey: candidate.object.id },
      );
    });
  },
);
