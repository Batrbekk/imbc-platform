import { computeBinCheckDigit, normalizeCompanyName, ownProfileSchema } from '@imbc/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProblemException } from '../src/common/problem.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { ProfilesService } from '../src/modules/profiles/profiles.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

function bin(seed: number): string {
  for (let i = 0; i < 100; i++) {
    const head = `2512${String(seed * 100 + i).padStart(7, '0')}`;
    const digit = computeBinCheckDigit(head);
    if (digit !== null) return `${head}${digit}`;
  }
  throw new Error('не удалось подобрать БИН');
}

// Свой профиль производителя: статус, полнота и актуальность из manufacturer_profiles, тир — из проекции
// (MAN-41, MAN-46, IMBC-22). Профиль ищется только по организации (GEN-11).
describe.skipIf(!process.env.TEST_DATABASE_URL)('свой профиль производителя', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let profiles: ProfilesService;
  let seed = 0;

  async function manufacturer(name: string, profile: Partial<typeof schema.manufacturerProfiles.$inferInsert>) {
    const [org] = await db
      .insert(schema.organizations)
      .values({ type: 'manufacturer', name, bin: bin(++seed) })
      .returning();
    const [row] = await db
      .insert(schema.manufacturerProfiles)
      .values({ organizationId: org!.id, ...profile })
      .returning();
    return { org: org!, profile: row! };
  }

  /** Строка проекции; её updateStatus и pendingChanges намеренно расходятся с manufacturer_profiles. */
  async function project(org: { id: string; bin: string | null; name: string }, profileId: string, siteSurveyed: boolean) {
    await db.insert(schema.catalogVisible).values({
      profileId,
      organizationId: org.id,
      bin: org.bin!,
      nameEn: org.name,
      nameRu: org.name,
      nameNormalized: normalizeCompanyName(org.name),
      region: 'KZ-ATY',
      commodityGroups: ['A'],
      commodityTypes: [],
      tnvedCodes: [],
      kpvedCodes: [],
      okedCodes: [],
      certificateTypes: [],
      certificatesValidUntil: {},
      siteSurveyed,
      updateStatus: 'active',
      pendingChanges: false,
      verifiedAt: new Date('2026-11-03T10:00:00Z'),
      card: {},
    });
  }

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    profiles = new ProfilesService(db);
  }, 60000);

  afterAll(async () => {
    await pool?.end();
  });

  it('verified + site surveyed → tier_2, статус и полнота из manufacturer_profiles', async () => {
    const verifiedAt = new Date('2026-11-03T10:00:00Z');
    const registeredAt = new Date('2026-10-01T10:00:00Z');
    const { org, profile } = await manufacturer('Альфа', {
      status: 'verified',
      hasPendingChanges: true,
      updateStatus: 'outdated',
      completenessPct: 100,
      registeredAt,
      verifiedAt,
    });
    await project(org, profile.id, true);
    // Чужой профиль рядом: в ответ не попадает (GEN-11).
    const other = await manufacturer('Бета', { status: 'verified', updateStatus: 'active', verifiedAt, completenessPct: 90 });
    await project(other.org, other.profile.id, false);

    const own = await profiles.own(org.id);
    expect(ownProfileSchema.parse(own)).toEqual({
      profileId: profile.id,
      organizationName: 'Альфа',
      bin: org.bin,
      status: 'verified',
      hasPendingChanges: true,
      updateStatus: 'outdated',
      tier: 'tier_2',
      completenessPct: 100,
      registeredAt: registeredAt.toISOString(),
      verifiedAt: verifiedAt.toISOString(),
    });
  });

  it('draft — status draft, updateStatus и tier null', async () => {
    // Значение в колонке до верификации не показывается (раздел 5.5).
    const { org, profile } = await manufacturer('Гамма', { status: 'draft', updateStatus: 'active', completenessPct: 40 });

    expect(await profiles.own(org.id)).toMatchObject({
      profileId: profile.id,
      status: 'draft',
      updateStatus: null,
      tier: null,
      completenessPct: 40,
      verifiedAt: null,
    });
  });

  it('verified вне проекции — tier_1', async () => {
    const { org } = await manufacturer('Дельта', {
      status: 'verified',
      updateStatus: 'unresponsive',
      verifiedAt: new Date(),
      completenessPct: 100,
    });

    expect(await profiles.own(org.id)).toMatchObject({ status: 'verified', updateStatus: 'unresponsive', tier: 'tier_1' });
  });

  it('организация без профиля — 404 not_found', async () => {
    const [org] = await db.insert(schema.organizations).values({ type: 'imbc', name: 'IMBC' }).returning();

    const error = await profiles.own(org!.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).getStatus()).toBe(404);
    expect((error as ProblemException).code).toBe('not_found');
  });
});
