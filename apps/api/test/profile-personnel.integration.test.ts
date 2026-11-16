import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ownPersonnelSchema, type PersonnelWrite, type FilePurpose, type DataClass } from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { PersonnelHandler } from '../src/modules/profiles/personnel.handler.js';
import { ProfileSectionsController } from '../src/modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';

const ROOT = '/api/v1/profiles/own/sections/personnel';
const empty = (): PersonnelWrite => ({
  managersCount: null,
  engineersCount: null,
  productionWorkersCount: null,
  nonresidentCount: null,
  organisationChartIds: [],
  cvFileIds: [],
});
const counts = (): PersonnelWrite => ({
  ...empty(),
  managersCount: 2,
  engineersCount: 3,
  productionWorkersCount: 5,
  nonresidentCount: 7,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'MAN-17–20 personnel through actual section HTTP and PostgreSQL',
  () => {
    vi.setConfig({ testTimeout: 30000 });
    let pool: pg.Pool;
    let db: Database;
    let http: HttpStand;
    let profile: typeof s.manufacturerProfile.$inferSelect;
    let foreignOrg: string;
    let accountId: string;
    let binSeed = 0;

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
    }, 60000);

    beforeEach(async () => {
      const suffix = randomUUID();
      const [org] = await db
        .insert(s.organizations)
        .values({ type: 'manufacturer', name: `Personnel ${suffix}`, bin: `2413${String(++binSeed).padStart(8, '0')}` })
        .returning();
      const [foreign] = await db
        .insert(s.organizations)
        .values({ type: 'manufacturer', name: `Other ${suffix}`, bin: `2413${String(++binSeed).padStart(8, '0')}` })
        .returning();
      foreignOrg = foreign!.id;
      const [account] = await db
        .insert(s.userAccounts)
        .values({
          organizationId: org!.id,
          role: 'manufacturer',
          state: 'active',
          email: `personnel-${suffix}@fixture.local`,
        })
        .returning();
      accountId = account!.id;
      const [created] = await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning();
      profile = created!;
      const service = new ProfileSectionsService(pool, new AuditService(db), [
        defineSectionHandler(new PersonnelHandler()),
      ]);
      http = await startHttp({
        controllers: [ProfileSectionsController],
        providers: [{ provide: ProfileSectionsService, useValue: service }],
        organizationId: org!.id,
        accountIds: { manufacturer: account!.id },
      });
    });
    afterEach(async () => {
      await http?.close();
    });
    afterAll(async () => {
      await pool?.end();
    });

    const read = async () => ownPersonnelSchema.parse(await (await http.get(ROOT, 'manufacturer')).json());
    const save = (data: unknown, editVersion = 0) => http.send('PUT', ROOT, 'manufacturer', { editVersion, data });
    const file = async (
      purpose: FilePurpose,
      state: 'pending' | 'passed' | 'rejected' = 'passed',
      organizationId = profile.organizationId,
      dataClass: DataClass = 'b_manufacturer',
    ) => {
      const [object] = await db.insert(s.fileObject).values({ organizationId, purpose, dataClass }).returning();
      const [version] = await db
        .insert(s.fileVersion)
        .values({
          fileObjectId: object!.id,
          versionNumber: 1,
          originalName: 'Private fixture chart.pdf',
          byteSize: 100,
          declaredMediaType: 'application/pdf',
          detectedMediaType: 'application/pdf',
          checksum: 'a'.repeat(64),
          scanState: state,
          rejectionReason: state === 'rejected' ? 'malware' : null,
          uploadedBy: accountId,
          storageKey: randomUUID(),
        })
        .returning();
      return { object: object!, version: version! };
    };

    const context = async (revisionId: string) => {
      const [section] = await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'personnel')));
      return { profileId: profile.id, organizationId: profile.organizationId, sectionId: section!.id, revisionId };
    };
    const verify = async (revisionId: string, capture = true) => {
      const ctx = await context(revisionId);
      await db.transaction(async (tx) => {
        if (capture)
          await captureRevisionFileVersions(tx as Database, {
            sectionRevisionId: revisionId,
            organizationId: profile.organizationId,
          });
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: new Date() })
          .where(eq(s.sectionRevision.id, revisionId));
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null, verifiedRevisionId: revisionId })
          .where(eq(s.profileSection.id, ctx.sectionId));
        await tx.update(s.sectionRevision).set({ state: 'verified' }).where(eq(s.sectionRevision.id, revisionId));
        await tx
          .update(s.manufacturerProfile)
          .set({ status: 'verified' })
          .where(eq(s.manufacturerProfile.id, profile.id));
      });
      return ctx;
    };

    it('an empty personnel section is a partial draft without invented Adata headcount or files', async () => {
      const initial = await read();
      expect(initial).toMatchObject({
        editVersion: 0,
        readOnly: false,
        completeness: { percent: 0 },
        data: { editable: empty(), totalHeadcount: null, organisationCharts: [], cvs: [] },
      });
      const noOp = await save(empty());
      expect(noOp.status).toBe(200);
      expect(ownPersonnelSchema.parse(await noOp.json())).toMatchObject({ editVersion: 0, savedAt: null });
    });

    it('computes total from exactly three categories, stores the nonresident subset separately and reaches 100 with a passed chart', async () => {
      const chart = await file('organisation_chart');
      const response = await save({ ...counts(), organisationChartIds: [chart.object.id] });
      expect(response.status).toBe(200);
      const result = ownPersonnelSchema.parse(await response.json());
      expect(result.data.totalHeadcount).toBe(10);
      expect(result.data.editable.nonresidentCount).toBe(7);
      expect(result.completeness).toEqual({ percent: 100, missing: [] });
      expect(result.data.organisationCharts[0]).toMatchObject({
        fileId: chart.object.id,
        versionId: chart.version.id,
        versionNumber: 1,
        scanState: 'passed',
        canDownload: true,
      });
      const [stored] = await db.select().from(s.personnel).where(eq(s.personnel.sectionRevisionId, result.revisionId!));
      expect(stored).toMatchObject({
        managersCount: 2,
        engineersCount: 3,
        productionWorkersCount: 5,
        nonresidentCount: 7,
      });
      expect(Object.hasOwn(stored!, 'totalHeadcount')).toBe(false);
    });

    it.each(['pending', 'rejected'] as const)(
      'zero counts are complete values and a %s chart becomes complete only after passing the scan',
      async (state) => {
        const chart = await file('organisation_chart', state);
        const first = ownPersonnelSchema.parse(
          await (
            await save({
              ...empty(),
              managersCount: 0,
              engineersCount: 0,
              productionWorkersCount: 0,
              nonresidentCount: 0,
              organisationChartIds: [chart.object.id],
            })
          ).json(),
        );
        expect(first).toMatchObject({ completeness: { percent: 80 }, data: { totalHeadcount: 0 } });
        expect(first.completeness.missing).toEqual([
          { path: 'organisationChartIds', code: 'organisation_chart_required' },
        ]);
        expect(first.data.organisationCharts[0]).toMatchObject({
          scanState: state,
          canDownload: false,
          rejectionReason: state === 'rejected' ? 'malware' : null,
        });
        await db
          .update(s.fileVersion)
          .set({ scanState: 'passed', rejectionReason: null, scannedAt: new Date() })
          .where(eq(s.fileVersion.id, chart.version.id));
        expect((await read()).completeness).toEqual({ percent: 100, missing: [] });
      },
    );

    it('allows incomplete count drafts and keeps total null until all three categories are entered', async () => {
      const result = ownPersonnelSchema.parse(
        await (await save({ ...empty(), managersCount: 2, nonresidentCount: 10 })).json(),
      );
      expect(result).toMatchObject({
        editVersion: 1,
        data: {
          totalHeadcount: null,
          editable: { managersCount: 2, nonresidentCount: 10, engineersCount: null, productionWorkersCount: null },
        },
      });
      expect(result.completeness.percent).toBe(40);
    });

    it('rejects an impossible nonresident subset atomically without echoing values or changing history', async () => {
      const response = await save({ ...counts(), nonresidentCount: 11 });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: 'validation',
        errors: [{ path: 'nonresidentCount', code: 'nonresident_exceeds_total' }],
      });
      expect(await read()).toMatchObject({ editVersion: 0, data: { editable: empty() } });
    });

    it.each([{ managersCount: -1 }, { engineersCount: 2.5 }, { productionWorkersCount: '5' }, { totalHeadcount: 10 }])(
      'rejects invalid or writable derived counts %j before changing the revision',
      async (override) => {
        const response = await save({ ...counts(), ...override });
        expect(response.status).toBe(400);
        expect((await read()).editVersion).toBe(0);
      },
    );

    it('rejects another manufacturer file, a wrong purpose and a wrong data class without leaking file metadata', async () => {
      const denied = [
        await file('organisation_chart', 'passed', foreignOrg),
        await file('cv'),
        await file('organisation_chart', 'passed', profile.organizationId, 'e_administration'),
      ];
      for (const reference of denied) {
        const response = await save({ ...counts(), organisationChartIds: [reference.object.id] });
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({
          code: 'validation',
          errors: [{ path: 'organisationChartIds.0', code: 'file_invalid' }],
        });
        expect(JSON.stringify(body)).not.toContain(reference.version.originalName);
      }
      expect((await read()).editVersion).toBe(0);
    });

    it('rejects repeated file IDs within and across attachment lists', async () => {
      const chart = await file('organisation_chart');
      for (const input of [
        { ...counts(), organisationChartIds: [chart.object.id, chart.object.id] },
        { ...counts(), organisationChartIds: [chart.object.id], cvFileIds: [chart.object.id] },
      ]) {
        const response = await save(input);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          code: 'validation',
          errors: [expect.objectContaining({ code: 'duplicate_file' })],
        });
      }
    });

    it('retains multiple ordered stable file IDs when reordering, replacing counts and saving a normalized no-op', async () => {
      const charts = [await file('organisation_chart'), await file('organisation_chart')];
      const cvs = [await file('cv'), await file('cv')];
      const input = {
        ...counts(),
        organisationChartIds: charts.map(({ object }) => object.id),
        cvFileIds: cvs.map(({ object }) => object.id),
      };
      const first = ownPersonnelSchema.parse(await (await save(input)).json());
      const second = ownPersonnelSchema.parse(
        await (
          await save(
            {
              ...first.data.editable,
              organisationChartIds: first.data.editable.organisationChartIds.toReversed(),
              managersCount: 4,
            },
            first.editVersion,
          )
        ).json(),
      );
      expect(second.data.organisationCharts.map(({ fileId }) => fileId)).toEqual(
        charts.map(({ object }) => object.id).toReversed(),
      );
      expect(second.data.cvs.map(({ fileId }) => fileId)).toEqual(cvs.map(({ object }) => object.id));
      expect(second.data.totalHeadcount).toBe(12);
      const noOp = ownPersonnelSchema.parse(
        await (
          await save(
            {
              ...second.data.editable,
              organisationChartIds: second.data.editable.organisationChartIds.map((id) => id.toUpperCase()),
            },
            second.editVersion,
          )
        ).json(),
      );
      expect(noOp).toMatchObject({
        revisionId: second.revisionId,
        editVersion: second.editVersion,
        savedAt: second.savedAt,
      });
    });

    it('CVs are optional for completeness, while every selected pending file still blocks the distinct future capture/send gate', async () => {
      const chart = await file('organisation_chart');
      const cv = await file('cv', 'pending');
      const result = ownPersonnelSchema.parse(
        await (await save({ ...counts(), organisationChartIds: [chart.object.id], cvFileIds: [cv.object.id] })).json(),
      );
      expect(result.completeness).toEqual({ percent: 100, missing: [] });
      expect(result.data.cvs[0]).toMatchObject({ fileId: cv.object.id, scanState: 'pending', canDownload: false });
      await expect(
        db.transaction((tx) =>
          captureRevisionFileVersions(tx as Database, {
            sectionRevisionId: result.revisionId!,
            organizationId: profile.organizationId,
          }),
        ),
      ).rejects.toMatchObject({ code: 'file_pending_scan' });
      const [revision] = await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.id, result.revisionId!));
      expect(revision!.state).toBe('working');
    });

    it('frozen reads retain exact captured versions after replacement; COW shares stable file IDs and uses latest only in the new working copy', async () => {
      const chart = await file('organisation_chart');
      const cv = await file('cv');
      const first = ownPersonnelSchema.parse(
        await (await save({ ...counts(), organisationChartIds: [chart.object.id], cvFileIds: [cv.object.id] })).json(),
      );
      const frozenContext = await verify(first.revisionId!);
      const [latest] = await db
        .insert(s.fileVersion)
        .values({
          fileObjectId: chart.object.id,
          versionNumber: 2,
          originalName: 'Replacement chart.pdf',
          byteSize: 200,
          declaredMediaType: 'application/pdf',
          detectedMediaType: 'application/pdf',
          checksum: 'b'.repeat(64),
          scanState: 'passed',
          uploadedBy: accountId,
          storageKey: randomUUID(),
        })
        .returning();
      expect((await read()).data.organisationCharts[0]).toMatchObject({
        versionId: chart.version.id,
        versionNumber: 1,
        originalName: chart.version.originalName,
      });
      const changed = ownPersonnelSchema.parse(
        await (await save({ ...first.data.editable, managersCount: 4 }, first.editVersion)).json(),
      );
      expect(changed.revisionId).not.toBe(first.revisionId);
      expect(changed).toMatchObject({
        profileStatus: 'verified',
        hasWorkingChanges: true,
        data: { totalHeadcount: 12, editable: { organisationChartIds: [chart.object.id], cvFileIds: [cv.object.id] } },
      });
      expect(changed.data.organisationCharts[0]).toMatchObject({ versionId: latest!.id, versionNumber: 2 });
      const old = await db.transaction((tx) => new PersonnelHandler().read(tx as Database, frozenContext));
      expect(old).toMatchObject({ totalHeadcount: 10, organisationCharts: [{ versionNumber: 1 }] });
      const [profileNow] = await db
        .select()
        .from(s.manufacturerProfile)
        .where(eq(s.manufacturerProfile.id, profile.id));
      expect(profileNow!.hasPendingChanges).toBe(false);
    });

    it('a frozen revision without a capture fails closed without disclosing a later global version', async () => {
      const chart = await file('organisation_chart');
      const first = ownPersonnelSchema.parse(
        await (await save({ ...counts(), organisationChartIds: [chart.object.id] })).json(),
      );
      await verify(first.revisionId!, false);
      const result = await read();
      expect(result.data.organisationCharts[0]).toMatchObject({
        fileId: chart.object.id,
        versionId: null,
        originalName: null,
        scanState: null,
        canDownload: false,
      });
      expect(JSON.stringify(result)).not.toContain(chart.version.originalName);
    });

    it('supports 1201 organisation-chart references and preserves ordered IDs across SQL insertion chunks', async () => {
      const ids = Array.from({ length: 1201 }, () => randomUUID());
      for (let start = 0; start < ids.length; start += 1000) {
        const batch = ids.slice(start, start + 1000);
        await db.insert(s.fileObject).values(
          batch.map((id) => ({
            id,
            organizationId: profile.organizationId,
            purpose: 'organisation_chart' as const,
            dataClass: 'b_manufacturer' as const,
          })),
        );
        await db.insert(s.fileVersion).values(
          batch.map((fileObjectId) => ({
            fileObjectId,
            versionNumber: 1,
            originalName: 'Supporting chart.pdf',
            byteSize: 100,
            declaredMediaType: 'application/pdf',
            detectedMediaType: 'application/pdf',
            checksum: 'c'.repeat(64),
            scanState: 'passed' as const,
            uploadedBy: accountId,
            storageKey: randomUUID(),
          })),
        );
      }
      const response = await save({ ...counts(), organisationChartIds: ids });
      expect(response.status).toBe(200);
      const result = ownPersonnelSchema.parse(await response.json());
      expect(result.data.editable.organisationChartIds).toEqual(ids);
      expect(result.data.organisationCharts.map(({ fileId }) => fileId)).toEqual(ids);
      expect(result.completeness.percent).toBe(100);
    });

    it('a stale edit version and a locked submitted profile preserve the stored personnel data', async () => {
      const first = ownPersonnelSchema.parse(await (await save(counts())).json());
      const stale = await save({ ...counts(), managersCount: 100 }, 0);
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ code: 'section_changed' });
      await db
        .update(s.manufacturerProfile)
        .set({ status: 'submitted' })
        .where(eq(s.manufacturerProfile.id, profile.id));
      const locked = await save({ ...counts(), managersCount: 100 }, first.editVersion);
      expect(locked.status).toBe(409);
      expect(await locked.json()).toMatchObject({ code: 'profile_locked' });
      expect((await read()).data.editable.managersCount).toBe(2);
    });
  },
);
