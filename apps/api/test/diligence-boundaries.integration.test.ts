import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
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
import { DiligenceService } from '../src/modules/due-diligence/diligence.service.js';
import { CatalogProjectionRefreshService } from '../src/modules/due-diligence/catalog-projection-refresh.service.js';
import { storedDiligenceState } from '../src/modules/due-diligence/diligence-operation.js';
import { profileCandidateRevisions, profileSubmissionRevisions } from '../src/modules/profiles/profile-candidate.js';
import { ProfileReviewService, profileReviewEvidence } from '../src/modules/profiles/profile-review.service.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { SiteSurveyService } from '../src/modules/site-survey/site-survey.service.js';
import { SiteSurveyPublicationService } from '../src/modules/site-survey/site-survey-publication.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('DD projection and historical-report adversarial boundaries', () => {
  vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
  let pool: pg.Pool,
    appPool: pg.Pool,
    db: Database,
    appDb: Database,
    boss: PgBoss,
    diligence: DiligenceService,
    expert: AuthUser;
  const role = `dd_boundaries_${randomUUID().replaceAll('-', '')}`;
  type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
  beforeAll(async () => {
    pool = openTestPool();
    const target = new URL(process.env.TEST_DATABASE_URL!);
    if (target.hostname !== '127.0.0.1' || target.port !== '55433')
      throw new Error('Exclusive DD isolated55433 required');
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
    const imbc = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
    const a = (
      await db
        .insert(s.userAccounts)
        .values({
          organizationId: imbc.id,
          role: 'expert',
          state: 'active',
          email: `${randomUUID()}@dd-boundary.local`,
        })
        .returning()
    )[0]!;
    expert = {
      id: a.id,
      organizationId: imbc.id,
      organizationType: 'imbc',
      role: 'expert',
      email: a.email,
      fullName: null,
      locale: 'en',
    };
    await pool.query(`create role "${role}" nologin`);
    await applyAppRoleGrants(pool, role);
    appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c role=${role}`, max: 5 });
    appDb = drizzle(appPool, { schema: s, casing: 'snake_case' });
    diligence = new DiligenceService(appPool, new AuditService(appDb));
    boss = new PgBoss({
      connectionString: process.env.TEST_DATABASE_URL,
      schema: 'pgboss_auth_test',
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.createQueue(QUEUES.notify);
    await pool.query(
      `grant usage on schema pgboss_auth_test to "${role}";grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`,
    );
  });
  afterAll(async () => {
    await boss?.stop();
    await appPool?.end();
    if (pool) await pool.query(`drop owned by "${role}";drop role "${role}"`);
    await pool?.end();
  });
  const publish = async (g: Fixture) => {
    const submit = new ProfileSubmitService(appPool, new AuditService(appDb), boss, submissionHandlers()),
      review = new ProfileReviewService(appPool, new AuditService(appDb), boss);
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
    for (const f of (await profileReviewEvidence(db, { profile, map })).filter(
      (f) => f.subject.kind === 'document' || f.subject.kind === 'certificate',
    ))
      await review.decide(expert, sent.assignmentId, { subject: f.subject, outcome: 'verified', comment: null });
    for (const section of sent.sections)
      await review.decide(expert, sent.assignmentId, {
        subject: { kind: 'section', sectionRevisionId: section.revisionId },
        outcome: 'verified',
        comment: null,
      });
    await review.submitResult(expert, sent.assignmentId);
  };
  const green = async (g: Fixture) =>
    diligence.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: (await diligence.read({ actor: expert }, g.profile)).record?.updatedAt ?? null,
      result: 'green',
      comment: null,
      reportFileId: null,
    });
  it.each([40000, 6442450941])(
    'publishes canonical personnel total %s without truncation/overflow or rollback',
    async (total) => {
      const g = await seedSubmissionProfile(pool),
        part = total === 40000 ? [40000, 0, 0] : [2147483647, 2147483647, 2147483647];
      await pool.query(
        'update personnel set managers_count=$2,engineers_count=$3,production_workers_count=$4 where organization_id=$1',
        [g.org, ...part],
      );
      await green(g);
      await publish(g);
      const visible = (await db.select().from(s.catalogVisible).where(eq(s.catalogVisible.profileId, g.profile)))[0]!;
      expect(visible.headcountTotal).toBe(total);
      expect(
        (visible.card as { verifiedSections: { personnel: { totalHeadcount: number } } }).verifiedSections.personnel
          .totalHeadcount,
      ).toBe(total);
      expect((await diligence.read({ actor: expert }, g.profile)).record?.result).toBe('green');
    },
  );
  it('keeps same-type permanent certificate validity when another same-type certificate expired', async () => {
    const g = await seedSubmissionProfile(pool);
    const original = (
      await db
        .select()
        .from(s.certificate)
        .where(eq(s.certificate.id, String(g.rows.certificate!.id)))
    )[0]!;
    const identity = (
      await db.insert(s.certificateIdentity).values({ profileId: g.profile, organizationId: g.org }).returning()
    )[0]!;
    await db.insert(s.certificate).values({
      ...original,
      id: randomUUID(),
      identityId: identity.id,
      number: 'OLD-CERT',
      issuedOn: '2000-01-01',
      expiresOn: '2001-01-01',
      positionInList: 100,
    });
    await green(g);
    await publish(g);
    const row = (await db.select().from(s.catalogVisible).where(eq(s.catalogVisible.profileId, g.profile)))[0]!;
    expect(row.certificateTypes).toContain('other');
    expect((row.certificatesValidUntil as Record<string, unknown>).other).toBeNull();
  });
  it('derives tier only from a signed, clean, tenant/purpose-bound unexpired survey report', async () => {
    const g = await seedSubmissionProfile(pool);
    await green(g);
    await publish(g);
    const survey = (
      await db
        .insert(s.siteSurveyRecords)
        .values({ profileId: g.profile, resultYes: true, reportFileId: null })
        .returning()
    )[0]!;
    const flags = async () => {
      await green(g);
      return (
        await db
          .select({ surveyed: s.catalogVisible.siteSurveyed, tier: s.catalogVisible.tier })
          .from(s.catalogVisible)
          .where(eq(s.catalogVisible.profileId, g.profile))
      )[0]!;
    };
    expect(await flags()).toEqual({ surveyed: false, tier: 'tier_1' });
    const make = async (
      purpose: 'site_survey_report' | 'due_diligence_report',
      organizationId = g.org,
      scanState: 'pending' | 'passed' = 'passed',
    ) => {
      const f = (
        await db.insert(s.fileObject).values({ organizationId, purpose, dataClass: 'c_imbc' }).returning()
      )[0]!;
      await db.insert(s.fileVersion).values({
        fileObjectId: f.id,
        versionNumber: 1,
        originalName: 'signed.pdf',
        byteSize: 1,
        declaredMediaType: 'application/pdf',
        detectedMediaType: 'application/pdf',
        checksum: 'fixture',
        storageKey: randomUUID(),
        scanState,
      });
      return f.id;
    };
    const surveys = new SiteSurveyService(appPool, new AuditService(appDb), new SiteSurveyPublicationService());
    const input = (fileId: string) => ({
      visitStartedOn: '2020-01-01',
      visitEndedOn: null,
      result: 'yes' as const,
      reportFileId: fileId,
      expiresOn: null,
      comment: null,
    });
    const other = await seedSubmissionProfile(pool);
    for (const [id, code] of [
      [await make('due_diligence_report'), 'validation_failed'],
      [await make('site_survey_report', other.org), 'validation_failed'],
      [await make('site_survey_report', g.org, 'pending'), 'site_survey_report_unavailable'],
    ] as const) {
      await db.update(s.siteSurveyRecords).set({ reportFileId: id }).where(eq(s.siteSurveyRecords.id, survey.id));
      await expect(surveys.create(expert, g.profile, input(id), randomUUID())).rejects.toMatchObject({
        code,
      });
      expect(await flags()).toEqual({ surveyed: false, tier: 'tier_1' });
    }
    const valid = await make('site_survey_report');
    await db.update(s.siteSurveyRecords).set({ reportFileId: valid }).where(eq(s.siteSurveyRecords.id, survey.id));
    // Legacy file IDs do not invent exact canonical pins or approved migration mappings.
    expect(await flags()).toEqual({ surveyed: false, tier: 'tier_1' });
    let canonical = await surveys.create(expert, g.profile, input(valid), randomUUID());
    expect(await flags()).toEqual({ surveyed: true, tier: 'tier_2' });
    canonical = await surveys.update(expert, g.profile, canonical.id, {
      ...input(valid),
      expiresOn: '2000-01-01',
      expectedUpdatedAt: canonical.updatedAt,
    });
    expect(await flags()).toEqual({ surveyed: false, tier: 'tier_1' });
    canonical = await surveys.update(expert, g.profile, canonical.id, {
      ...input(valid),
      expectedUpdatedAt: canonical.updatedAt,
    });
    await db.insert(s.fileVersion).values({
      fileObjectId: valid,
      versionNumber: 2,
      originalName: 'unscanned.pdf',
      byteSize: 1,
      declaredMediaType: 'application/pdf',
      checksum: 'fixture2',
      storageKey: randomUUID(),
      scanState: 'pending',
    });
    expect(await flags()).toEqual({ surveyed: true, tier: 'tier_2' });
    expect((await surveys.read(expert, g.profile, canonical.id)).reportFileVersionId).toBe(
      canonical.reportFileVersionId,
    );
  });
  it('updates independent enhanced state while retaining its old clean pinned DD report after a newer candidate upload', async () => {
    const g = await seedSubmissionProfile(pool);
    const f = (
      await db
        .insert(s.fileObject)
        .values({ organizationId: g.org, purpose: 'due_diligence_report', dataClass: 'c_imbc' })
        .returning()
    )[0]!;
    const version = (
      await db
        .insert(s.fileVersion)
        .values({
          fileObjectId: f.id,
          versionNumber: 1,
          originalName: 'first.pdf',
          byteSize: 1,
          declaredMediaType: 'application/pdf',
          checksum: '1',
          storageKey: randomUUID(),
          scanState: 'passed',
        })
        .returning()
    )[0]!;
    const current = await diligence.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: null,
      result: 'green',
      comment: 'Reviewed',
      reportFileId: f.id,
    });
    await db.insert(s.fileVersion).values({
      fileObjectId: f.id,
      versionNumber: 2,
      originalName: 'candidate.pdf',
      byteSize: 1,
      declaredMediaType: 'application/pdf',
      checksum: '2',
      storageKey: randomUUID(),
      scanState: 'pending',
    });
    const next = await diligence.enhanced({ actor: expert }, g.profile, {
      expectedUpdatedAt: current.record!.updatedAt,
      enhanced: 'done',
      comment: 'Independent',
      reportFileId: null,
    });
    expect(next.record).toMatchObject({ result: 'green', reportFileId: f.id, enhanced: 'done' });
    const state = await storedDiligenceState(db, g.profile, g.org);
    expect(state.record?.report_file_version_id).toBe(version.id);
    const history = (await diligence.history({ actor: expert }, g.profile)) as { diff: { after: unknown } }[];
    expect(history[0]!.diff.after).toEqual(state);
  });
  it('rolls back a red projection deletion and its full audit/record/checks, then background refresh reconstructs the exact verified graph', async () => {
    const g = await seedSubmissionProfile(pool);
    await green(g);
    await publish(g);
    const current = await diligence.read({ actor: expert }, g.profile),
      before = await storedDiligenceState(db, g.profile, g.org);
    const visible = (
      await pool.query('select to_jsonb(c) as row from catalog_visible c where profile_id=$1', [g.profile])
    ).rows[0].row;
    const audits = await diligence.history({ actor: expert }, g.profile);
    await expect(
      diligence.override(
        { actor: expert },
        g.profile,
        { expectedUpdatedAt: current.record!.updatedAt, result: 'red', comment: null, reportFileId: null },
        async (phase) => {
          if (phase === 'projection') throw new Error('Projection deletion rollback');
        },
      ),
    ).rejects.toThrow('Projection deletion rollback');
    expect(await storedDiligenceState(db, g.profile, g.org)).toEqual(before);
    expect(await diligence.history({ actor: expert }, g.profile)).toEqual(audits);
    expect(
      (await pool.query('select to_jsonb(c) as row from catalog_visible c where profile_id=$1', [g.profile])).rows[0]
        .row,
    ).toEqual(visible);
    await pool.query('delete from catalog_visible where profile_id=$1', [g.profile]);
    const refresh = new CatalogProjectionRefreshService(appPool);
    await boss.createQueue(QUEUES.refreshCatalog);
    let delivered!: (result: boolean) => void;
    const completed = new Promise<boolean>((resolve) => {
      delivered = resolve;
    });
    await boss.work<{ profileId: string }>(QUEUES.refreshCatalog, async (jobs) => {
      for (const job of jobs) delivered(await refresh.refresh(job.data));
    });
    await boss.send(QUEUES.refreshCatalog, { profileId: g.profile });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      expect(
        await Promise.race([
          completed,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Actual projection queue did not deliver')), 10000);
          }),
        ]),
      ).toBe(true);
    } finally {
      clearTimeout(timeout);
    }
    const restored = (
      await pool.query('select to_jsonb(c) as row from catalog_visible c where profile_id=$1', [g.profile])
    ).rows[0].row;
    const { refreshed_at: _before, ...oldFields } = visible;
    const { refreshed_at: _after, ...newFields } = restored;
    expect(newFields).toEqual(oldFields);
    await diligence.override({ actor: expert }, g.profile, {
      expectedUpdatedAt: current.record!.updatedAt,
      result: 'red',
      comment: null,
      reportFileId: null,
    });
    expect(await refresh.refresh({ profileId: g.profile })).toBe(false);
    expect((await pool.query('select 1 from catalog_visible where profile_id=$1', [g.profile])).rowCount).toBe(0);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('0027 explicit legacy DD compatibility retention', () => {
  it('preserves every old row/FK and severity, flags unresolved mapping, and hides all unproven old projections', async () => {
    const pool = openTestPool();
    try {
      const target = new URL(process.env.TEST_DATABASE_URL!);
      if (target.port !== '55433') throw new Error('ExclusiveDDisolated55433required');
      await resetDatabase(pool);
      await migrateThrough(pool, '0026_stage4b_main_source_ownership');
      const db = drizzle(pool, { schema: s, casing: 'snake_case' }),
        g = await seedSubmissionProfile(pool),
        noOld = await seedSubmissionProfile(pool);
      const rows = await db
        .insert(s.dueDiligenceRecords)
        .values([
          { profileId: g.profile, checkedOn: '2026-11-01', result: 'findings', comment: 'Severity unknown' },
          { profileId: g.profile, checkedOn: '2026-11-02', result: 'no_issues', comment: 'No normalized proof' },
        ])
        .returning();
      for (const fixture of [g, noOld])
        await pool.query(
          `insert into catalog_visible(profile_id,organization_id,bin,name_en,name_ru,name_normalized,region,
        commodity_groups,commodity_types,tnved_codes,kpved_codes,oked_codes,certificate_types,certificates_valid_until,update_status,verified_at,card)
        values($1,$2,$3,'Legacy','Legacy','legacy','',array[]::commodity_group[],array[]::text[],array[]::text[],array[]::text[],array[]::text[],array[]::text[],
          '{}'::jsonb,'active',now(),'{"companyPhone":null,"companyEmail":null,"focalPoint":null}'::jsonb)`,
          [fixture.profile, fixture.org, '000000000000'],
        );
      await migrateThrough(pool);
      expect(
        await db.select().from(s.dueDiligenceRecords).where(eq(s.dueDiligenceRecords.profileId, g.profile)),
      ).toEqual(rows);
      expect(
        (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, g.profile)))[0]
          ?.migrationFlags,
      ).toMatchObject({ dueDiligence: 'legacy_mapping_unresolved' });
      expect((await pool.query('select 1 from due_diligence_record')).rowCount).toBe(0);
      expect((await pool.query('select 1 from catalog_visible')).rowCount).toBe(0);
      const audit = (
        await pool.query(
          "select diff from audit_entries where action='due_diligence.legacy_retained' and object_id=$1",
          [g.profile],
        )
      ).rows[0].diff;
      expect(audit.mapping).toBe('unresolved');
      expect(audit.legacyRows.map((r: { id: string }) => r.id)).toEqual(rows.map((r) => r.id));
    } finally {
      await pool.end();
    }
  }, 60000);
});
