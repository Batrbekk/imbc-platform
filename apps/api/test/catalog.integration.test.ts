import {
  catalogFilterSchema,
  catalogItemSchema,
  computeBinCheckDigit,
  dashboardSchema,
  normalizeCompanyName,
} from '@imbc/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

type Status = 'active' | 'outdated' | 'unresponsive';

/** Пять видимых профилей проекции. Названия и даты подобраны так, что без правила UPD-04 unresponsive шли бы первыми. */
const COMPANIES: { name: string; region: string; status: Status; surveyed: boolean; daysAgo: number }[] = [
  { name: 'Альфа', region: 'KZ-ATY', status: 'active', surveyed: true, daysAgo: 30 },
  { name: 'Бета', region: 'KZ-MAN', status: 'outdated', surveyed: false, daysAgo: 20 },
  { name: 'Гамма', region: 'KZ-ATY', status: 'active', surveyed: false, daysAgo: 10 },
  { name: 'Аааа Первая', region: 'KZ-AKM', status: 'unresponsive', surveyed: true, daysAgo: 1 },
  { name: 'Яяя', region: 'KZ-ZAP', status: 'unresponsive', surveyed: false, daysAgo: 40 },
];

function bin(seed: number): string {
  for (let i = 0; i < 100; i++) {
    const head = `2511${String(seed * 100 + i).padStart(7, '0')}`;
    const digit = computeBinCheckDigit(head);
    if (digit !== null) return `${head}${digit}`;
  }
  throw new Error('не удалось подобрать БИН');
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('каталог и дашборд на проекции catalog_visible', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  const valkey = { get: vi.fn(), set: vi.fn() };
  let catalog: CatalogService;

  async function manufacturer(seed: number, name: string, status: Status, verifiedAt: Date) {
    const [org] = await db
      .insert(schema.organizations)
      .values({ type: 'manufacturer', name, bin: bin(seed) })
      .returning();
    const [profile] = await db
      .insert(schema.manufacturerProfiles)
      .values({ organizationId: org!.id, status: 'verified', updateStatus: status, verifiedAt, completenessPct: 100 })
      .returning();
    return { org: org!, profile: profile! };
  }

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });

    for (const [i, c] of COMPANIES.entries()) {
      const verifiedAt = new Date(Date.now() - c.daysAgo * 86_400_000);
      const { org, profile } = await manufacturer(i + 1, c.name, c.status, verifiedAt);
      await db.insert(schema.catalogVisible).values({
        profileId: profile.id,
        organizationId: org.id,
        bin: org.bin!,
        nameEn: c.name,
        nameRu: c.name,
        nameNormalized: normalizeCompanyName(c.name),
        region: c.region,
        commodityGroups: ['A'],
        commodityTypes: [],
        tnvedCodes: [],
        kpvedCodes: [],
        okedCodes: [],
        certificateTypes: [],
        certificatesValidUntil: {},
        siteSurveyed: c.surveyed,
        updateStatus: c.status,
        verifiedAt,
        card: {},
      });
    }
    // Верифицированный unresponsive-профиль, которого нет в проекции: каталог и дашборд его не видят.
    await manufacturer(COMPANIES.length + 1, 'Вне проекции', 'unresponsive', new Date());
  }, 60000);

  beforeEach(() => {
    valkey.get.mockReset().mockResolvedValue(null);
    valkey.set.mockReset().mockResolvedValue('OK');
    catalog = new CatalogService(db, valkey as never);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const names = (page: { items: { nameRu: string }[] }) => page.items.map((i) => i.nameRu);

  it.each(['name', 'verified_at', 'region'] as const)(
    'unresponsive остаётся в выдаче и идёт ниже active и outdated при сортировке %s (UPD-04, OPR-01, OPR-33)',
    async (sort) => {
      const page = await catalog.search(catalogFilterSchema.parse({ sort }), 'visible');
      expect(page.total).toBe(5);
      expect(page.items.map((i) => i.updateStatus).slice(3)).toEqual(['unresponsive', 'unresponsive']);
      expect(page.items.slice(0, 3).some((i) => i.updateStatus === 'unresponsive')).toBe(false);
    },
  );

  it('по названию: Альфа, Бета, Гамма, затем Аааа Первая, Яяя', async () => {
    const page = await catalog.search(catalogFilterSchema.parse({ sort: 'name' }), 'visible');
    expect(names(page)).toEqual(['Альфа', 'Бета', 'Гамма', 'Аааа Первая', 'Яяя']);
  });

  it.each([
    ['verified_at', ['Гамма', 'Бета', 'Альфа', 'Аааа Первая', 'Яяя']],
    ['region', ['Альфа', 'Гамма', 'Бета', 'Аааа Первая', 'Яяя']],
  ] as const)('сортировка %s внутри каждой группы сохраняет прежние ключи', async (sort, expected) => {
    const page = await catalog.search(catalogFilterSchema.parse({ sort }), 'visible');
    expect(names(page)).toEqual(expected);
  });

  it('порядок сохраняется между страницами', async () => {
    const pages = [];
    for (const page of [1, 2, 3]) {
      pages.push(
        names(await catalog.search(catalogFilterSchema.parse({ sort: 'name', page, pageSize: 2 }), 'visible')),
      );
    }
    expect(pages).toEqual([['Альфа', 'Бета'], ['Гамма', 'Аааа Первая'], ['Яяя']]);
  });

  it.each(['name', 'verified_at', 'region'] as const)(
    'обход всех страниц при сортировке %s возвращает каждую компанию ровно один раз (OPR-01)',
    async (sort) => {
      const seen: string[] = [];
      for (const page of [1, 2, 3, 4]) {
        seen.push(...names(await catalog.search(catalogFilterSchema.parse({ sort, page, pageSize: 2 }), 'visible')));
      }
      expect(seen).toHaveLength(COMPANIES.length);
      expect([...seen].sort()).toEqual(COMPANIES.map((c) => c.name).sort());
    },
  );

  it('дашборд считает все три статуса и оставляет unresponsive на карте (OPR-32, OPR-33)', async () => {
    const d = dashboardSchema.parse(await catalog.dashboard());
    expect(d.total).toBe(5);
    expect(d.updateStatus).toEqual({ active: 2, outdated: 1, unresponsive: 2 });
    expect(d.byRegion).toContainEqual({ region: 'KZ-AKM', count: 1 }); // регион только с unresponsive
    expect(d.byRegion).toHaveLength(4);
    expect(d.siteSurveyed).toBe(2);
    expect(d.byCommodityGroup).toEqual([{ group: 'A', count: 5 }]);
    expect(valkey.set).toHaveBeenCalledWith('dashboard:v2', expect.any(String), 'EX', 60);
  });

  it('фильтр tier_2 — только компании с обследованием; оба значения — все (OPR-02, OPR-04)', async () => {
    const byTier = async (tier: string) =>
      names(await catalog.search(catalogFilterSchema.parse({ tier, sort: 'name' }), 'visible'));
    expect(await byTier('tier_2')).toEqual(['Альфа', 'Аааа Первая']);
    expect(await byTier('tier_1')).toEqual(['Бета', 'Гамма', 'Яяя']);
    expect(await byTier('tier_1,tier_2')).toHaveLength(COMPANIES.length);
  });

  it('тир не зависит от статуса актуальности', async () => {
    const page = await catalog.search(catalogFilterSchema.parse({ q: 'Аааа Первая' }), 'visible');
    expect(page.items.map(({ nameRu, updateStatus, tier }) => ({ nameRu, updateStatus, tier }))).toEqual([
      { nameRu: 'Аааа Первая', updateStatus: 'unresponsive', tier: 'tier_2' },
    ]);
  });

  it('тир есть в каждой строке результата (OPR-06)', async () => {
    const page = await catalog.search(catalogFilterSchema.parse({}), 'visible');
    const tiers = Object.fromEntries(page.items.map((i) => [i.nameRu, catalogItemSchema.parse(i).tier]));
    expect(tiers).toEqual(Object.fromEntries(COMPANIES.map((c) => [c.name, c.surveyed ? 'tier_2' : 'tier_1'])));
  });

  it('дашборд: счётчики по тирам (OPR-32)', async () => {
    const d = dashboardSchema.parse(await catalog.dashboard());
    expect(d.tier).toEqual({ tier_1: 3, tier_2: 2 });
  });

  it('кеш dashboard:v1 прежней формы не отдаётся', async () => {
    const legacy = JSON.stringify({
      total: 99,
      byRegion: [],
      byCommodityGroup: [],
      siteSurveyed: 0,
      unifiedRegister: 0,
      updateStatus: { active: 99, outdated: 0, inactive: 0 },
      generatedAt: new Date().toISOString(),
    });
    valkey.get.mockImplementation(async (key: string) => (key === 'dashboard:v1' ? legacy : null));

    const d = dashboardSchema.parse(await catalog.dashboard());

    expect(d.total).toBe(5);
    expect(d.updateStatus).toEqual({ active: 2, outdated: 1, unresponsive: 2 });
    expect(valkey.get.mock.calls).toEqual([['dashboard:v2']]);
  });
});
