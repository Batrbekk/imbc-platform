import { readFileSync } from 'node:fs';
import {
  catalogFilterSchema,
  computeBinCheckDigit,
  normalizeCompanyName,
  ownAdataReadSchema,
  ownProfileSchema,
  PREFILL_FIELDS,
} from '@imbc/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ProblemException } from '../src/common/problem.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { extractPrefill } from '../src/modules/adata/company-info.js';
import { AccountsService } from '../src/modules/admin/accounts.service.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
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

/** data «Полной информации» из фикстуры коннектора. */
const ADATA_DATA = (
  JSON.parse(readFileSync(new URL('./fixtures/adata-company-info.json', import.meta.url), 'utf8')) as { data: unknown }
).data as { basic: Record<string, unknown> } & Record<string, unknown>;
/** ФИО руководителя, учредители и юр. адрес фикстуры: видит только сам производитель (GEN-11, ADM-06). */
const PERSONAL = ['Тестов Тест Тестович', 'Тестова Айгуль', 'ТОО «Тест Холдинг»', 'Казахстан, г. Алматы, ул. Тестовая, д. 1'];
const REQUESTED_AT = new Date('2026-11-12T09:00:00Z');
const COMPLETED_AT = new Date('2026-11-12T09:01:30Z');
type AttemptState = NonNullable<(typeof schema.externalCheckAttempt.$inferInsert)['state']>;

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

  /**
   * Попытка чтения Adata в нужном состоянии, как её оставляет задание worker: внутренние колонки заполнены,
   * при received — строки prefilled_value из extractPrefill (вставляются в обратном порядке).
   */
  async function adataRead(
    m: { org: typeof schema.organizations.$inferSelect; profile: typeof schema.manufacturerProfiles.$inferSelect },
    state: AttemptState,
    data: unknown = ADATA_DATA,
  ) {
    const [check] = await db
      .insert(schema.externalCheck)
      .values({ profileId: m.profile.id, organizationId: m.org.id, connector: 'adata' })
      .returning();
    const received = state === 'received';
    const final = state !== 'queued' && state !== 'polling';
    const [attempt] = await db
      .insert(schema.externalCheckAttempt)
      .values({
        externalCheckId: check!.id,
        trigger: 'profile_created',
        state,
        bin: m.org.bin!,
        requestedAt: REQUESTED_AT,
        requestSentAt: state === 'queued' ? null : REQUESTED_AT,
        pollToken: state === 'polling' ? '987654321' : null,
        completedAt: final ? COMPLETED_AT : null,
        failure: state === 'unavailable' ? 'http_5xx' : null,
        value: received ? data : null,
        source: received ? 'adata.companyInfo' : null,
      })
      .returning();
    await db
      .update(schema.externalCheck)
      .set({ latestAttemptId: attempt!.id })
      .where(eq(schema.externalCheck.id, check!.id));
    const rows = received ? extractPrefill(data) : [];
    if (rows.length > 0)
      await db.insert(schema.prefilledValue).values(
        rows.reverse().map((row) => ({
          ...row,
          profileId: m.profile.id,
          organizationId: m.org.id,
          attemptId: attempt!.id,
          source: 'adata' as const,
          readAt: COMPLETED_AT,
        })),
      );
    return attempt!.id;
  }

  /** Ожидаемые поля ответа: строки extractPrefill по PREFILL_FIELDS, внутри — по position. */
  function expectedFields(data: unknown) {
    const rows = extractPrefill(data);
    return PREFILL_FIELDS.flatMap((field) => {
      const items = rows.filter((r) => r.field === field).map(({ value, label }) => ({ value, label }));
      return items.length > 0 ? [{ field, source: 'adata', readAt: COMPLETED_AT.toISOString(), items }] : [];
    });
  }

  const tableCounts = async () =>
    (
      await pool.query<Record<string, string>>(
        `select (select count(*) from external_check) as checks,
                (select count(*) from external_check_attempt) as attempts,
                (select count(*) from prefilled_value) as prefilled,
                (select count(*) from information_schema.schemata where schema_name like 'pgboss%') as queues`,
      )
    ).rows[0];

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

  it('организация без БИН — ответ не проходит схему: обычный Error, не ZodError (сбой сервера, 500)', async () => {
    const [org] = await db.insert(schema.organizations).values({ type: 'manufacturer', name: 'Без БИН' }).returning();
    await db.insert(schema.manufacturerProfiles).values({ organizationId: org!.id });

    const error = await profiles.own(org!.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ZodError);
    expect(error).not.toBeInstanceOf(ProblemException);
    expect((error as Error).cause).toBeInstanceOf(ZodError);
  });

  describe('чтение Adata своего профиля (MAN-06, MAN-07, GEN-11)', () => {
    it('received — девять полей по порядку, у каждого source adata и readAt; unknown_bin — received без полей', async () => {
      const m = await manufacturer('Адата Received', { status: 'draft' });
      await adataRead(m, 'received');

      const read = ownAdataReadSchema.parse(await profiles.ownAdata(m.org.id));
      expect(read).toEqual({
        state: 'received',
        requestedAt: REQUESTED_AT.toISOString(),
        readAt: COMPLETED_AT.toISOString(),
        fields: expectedFields(ADATA_DATA),
      });
      expect(read.fields.map((f) => f.field)).toEqual([...PREFILL_FIELDS]);
      for (const f of read.fields) expect(f, f.field).toMatchObject({ source: 'adata', readAt: COMPLETED_AT.toISOString() });
      // ОКЭД с названием, учредители — только имена, строки по position.
      expect(read.fields.find((f) => f.field === 'activity')!.items[0]!.value).toBe('25110');
      expect(read.fields.find((f) => f.field === 'shareholders')!.items.map((i) => i.value)).toEqual([
        'Тестова Айгуль',
        'ТОО «Тест Холдинг»',
      ]);
      // Внутреннее наружу не выходит: БИН попытки, источник ответа, ИИН/БИН учредителей.
      const text = JSON.stringify(read);
      for (const internal of [m.org.bin!, 'adata.companyInfo', '850202400022', '100140000033', 'failure', 'pollToken'])
        expect(text).not.toContain(internal);

      // unknown_bin: Adata ответил, что компании нет — чтение получено, полей нет.
      const unknown = await manufacturer('Адата Unknown', { status: 'draft' });
      await adataRead(unknown, 'received', { basic: null, kzCoContact: null, founders: null });
      expect(await profiles.ownAdata(unknown.org.id)).toEqual({
        state: 'received',
        requestedAt: REQUESTED_AT.toISOString(),
        readAt: COMPLETED_AT.toISOString(),
        fields: [],
      });
    });

    it.each(['queued', 'polling'] as const)('%s — waiting, полей нет', async (state) => {
      const m = await manufacturer(`Адата ${state}`, { status: 'draft' });
      await adataRead(m, state);
      expect(ownAdataReadSchema.parse(await profiles.ownAdata(m.org.id))).toEqual({
        state: 'waiting',
        requestedAt: REQUESTED_AT.toISOString(),
        readAt: null,
        fields: [],
      });
    });

    it('unavailable, not_configured, quota_exhausted — без полей; нет проверки — not_requested', async () => {
      for (const state of ['unavailable', 'not_configured', 'quota_exhausted'] as const) {
        const m = await manufacturer(`Адата ${state}`, { status: 'draft' });
        await adataRead(m, state);
        expect(ownAdataReadSchema.parse(await profiles.ownAdata(m.org.id)), state).toEqual({
          state,
          requestedAt: REQUESTED_AT.toISOString(),
          readAt: null,
          fields: [],
        });
      }

      const none = await manufacturer('Адата без проверки', { status: 'draft' });
      const notRequested = { state: 'not_requested', requestedAt: null, readAt: null, fields: [] };
      expect(await profiles.ownAdata(none.org.id)).toEqual(notRequested);
      // Проверка без попытки — то же not_requested.
      const empty = await manufacturer('Адата без попытки', { status: 'draft' });
      await db
        .insert(schema.externalCheck)
        .values({ profileId: empty.profile.id, organizationId: empty.org.id, connector: 'adata' });
      expect(await profiles.ownAdata(empty.org.id)).toEqual(notRequested);

      // Организация без профиля — 404, как у своего профиля.
      const [imbc] = await db.insert(schema.organizations).values({ type: 'imbc', name: 'IMBC Adata' }).returning();
      const error = await profiles.ownAdata(imbc!.id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).getStatus()).toBe(404);
      expect((error as ProblemException).code).toBe('not_found');
    });

    it('чужая организация не видит чужие значения (GEN-11)', async () => {
      const other = structuredClone(ADATA_DATA);
      other.basic.fullname_director = 'Чужой Директор Иванович';
      other.basic.legal_address = 'Казахстан, г. Астана, ул. Чужая, д. 9';
      const owner = await manufacturer('Адата Владелец', { status: 'draft' });
      await adataRead(owner, 'received', other);

      // Без своей проверки — not_requested, а не значения соседа.
      const neighbour = await manufacturer('Адата Сосед', { status: 'draft' });
      expect(await profiles.ownAdata(neighbour.org.id)).toEqual({
        state: 'not_requested',
        requestedAt: null,
        readAt: null,
        fields: [],
      });
      // Со своей проверкой — только свои значения.
      await adataRead(neighbour, 'received');
      const own = JSON.stringify(await profiles.ownAdata(neighbour.org.id));
      expect(own).toContain('Тестов Тест Тестович');
      for (const foreign of ['Чужой Директор Иванович', 'ул. Чужая']) expect(own).not.toContain(foreign);
      expect(JSON.stringify(await profiles.ownAdata(owner.org.id))).toContain('Чужой Директор Иванович');
    });

    it('чтение не создаёт попыток и не ставит задание', async () => {
      const states = ['quota_exhausted', 'not_configured', 'unavailable'] as const;
      const ms = [];
      for (const state of states) {
        const m = await manufacturer(`Адата повтор ${state}`, { status: 'draft' });
        await adataRead(m, state);
        ms.push(m);
      }
      const none = await manufacturer('Адата повтор без проверки', { status: 'draft' });
      const before = await tableCounts();
      const attemptsBefore = await db.select().from(schema.externalCheckAttempt);

      for (const m of [...ms, none]) await profiles.ownAdata(m.org.id);

      expect(await tableCounts()).toEqual(before);
      expect(await db.select().from(schema.externalCheckAttempt)).toEqual(attemptsBefore);
    });

    it('каталог, страница компании и аккаунты без значений Adata', async () => {
      const m = await manufacturer('Адата Видимый', {
        status: 'verified',
        updateStatus: 'active',
        verifiedAt: new Date('2026-11-03T10:00:00Z'),
        completenessPct: 100,
      });
      await project(m.org, m.profile.id, false);
      const projected = () =>
        db.select().from(schema.catalogVisible).where(eq(schema.catalogVisible.profileId, m.profile.id));
      const before = await projected();

      await adataRead(m, 'received');
      // Значения действительно есть — их видит только сам производитель.
      const own = JSON.stringify(await profiles.ownAdata(m.org.id));
      for (const value of PERSONAL) expect(own).toContain(value);

      const catalog = new CatalogService(db, { get: vi.fn(), set: vi.fn() } as never);
      const answers: [string, unknown][] = [
        ['поиск', await catalog.search(catalogFilterSchema.parse({}), 'visible')],
        ['поиск по БИН', await catalog.search(catalogFilterSchema.parse({ q: m.org.bin! }), 'visible')],
        ['поиск по названию', await catalog.search(catalogFilterSchema.parse({ q: m.org.name }), 'visible')],
        ['аккаунты', await new AccountsService(db).list()],
      ];
      for (const role of ['operator', 'observer', 'director'] as const)
        answers.push([`страница компании, ${role}`, await catalog.company(m.profile.id, role)]);
      // Профиль действительно в выдаче — иначе проверка ничего не значит.
      expect(JSON.stringify(answers[1]![1])).toContain(m.profile.id);

      for (const [what, answer] of answers) {
        const text = JSON.stringify(answer);
        for (const value of PERSONAL) expect(text, what).not.toContain(value);
      }
      expect(await projected()).toEqual(before);
    });
  });
});
