import { computeBinCheckDigit, reviewQueueSchema } from '@imbc/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { ReviewsService } from '../src/modules/reviews/reviews.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

function bin(seed: number): string {
  for (let i = 0; i < 100; i++) {
    const head = `2513${String(seed * 100 + i).padStart(7, '0')}`;
    const digit = computeBinCheckDigit(head);
    if (digit !== null) return `${head}${digit}`;
  }
  throw new Error('не удалось подобрать БИН');
}

// Очередь SME читает рабочие таблицы manufacturer_profiles, organizations, user_accounts (REV-01, REV-04).
describe.skipIf(!process.env.TEST_DATABASE_URL)('очередь проверки SME', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let reviews: ReviewsService;
  let seed = 0;
  const ids: Record<string, string> = {};
  const bins: Record<string, string> = {};

  /** Производитель с профилем; registered_at — по порядку создания. */
  async function manufacturer(name: string, profile: Partial<typeof schema.manufacturerProfiles.$inferInsert>) {
    const n = ++seed;
    const [org] = await db
      .insert(schema.organizations)
      .values({ type: 'manufacturer', name, bin: bin(n) })
      .returning();
    const [row] = await db
      .insert(schema.manufacturerProfiles)
      .values({ organizationId: org!.id, registeredAt: new Date(Date.UTC(2026, 9, n, 10)), ...profile })
      .returning();
    ids[name] = row!.id;
    bins[name] = org!.bin!;
  }

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    reviews = new ReviewsService(db);

    const [imbc] = await db.insert(schema.organizations).values({ type: 'imbc', name: 'IMBC' }).returning();
    const [named] = await db
      .insert(schema.userAccounts)
      .values({ organizationId: imbc!.id, email: 'expert@imbc.local', fullName: 'Эксперт IMBC', role: 'expert' })
      .returning();
    const [unnamed] = await db
      .insert(schema.userAccounts)
      .values({ organizationId: imbc!.id, email: 'second@imbc.local', fullName: '', role: 'expert' })
      .returning();

    await manufacturer('Отправлен', { status: 'submitted' });
    await manufacturer('На проверке', { status: 'under_review', assignedExpertId: named!.id });
    await manufacturer('Черновик', { status: 'draft', hasPendingChanges: true });
    await manufacturer('Возвращён', { status: 'returned', hasPendingChanges: true, assignedExpertId: named!.id });
    await manufacturer('Верифицирован', { status: 'verified', updateStatus: 'active', verifiedAt: new Date() });
    await manufacturer('Ожидает изменений', {
      status: 'verified',
      hasPendingChanges: true,
      updateStatus: 'active',
      verifiedAt: new Date(),
      assignedExpertId: unnamed!.id,
    });
    // Тот же registered_at, что у первого: порядок решает id.
    await manufacturer('Отправлен тогда же', { status: 'submitted', registeredAt: new Date(Date.UTC(2026, 9, 1, 10)) });
  }, 60000);

  afterAll(async () => {
    await pool?.end();
  });

  it('в очереди submitted, under_review и verified с pending changes; draft и returned — нет (REV-01, MAN-43)', async () => {
    const queue = reviewQueueSchema.parse(await reviews.queue({}));
    const first = [ids['Отправлен']!, ids['Отправлен тогда же']!].sort();
    expect(queue.items.map((i) => i.profileId)).toEqual([...first, ids['На проверке'], ids['Ожидает изменений']]);
    expect(queue.total).toBe(4);
    // Только поля очереди, ничего больше о профиле.
    expect(queue.items.find((i) => i.profileId === ids['Ожидает изменений'])).toEqual({
      profileId: ids['Ожидает изменений'],
      organizationName: 'Ожидает изменений',
      bin: bins['Ожидает изменений'],
      status: 'verified',
      hasPendingChanges: true,
      assignedExpert: 'second@imbc.local',
      registeredAt: new Date(Date.UTC(2026, 9, 6, 10)).toISOString(),
    });
  });

  it('фильтр status=submitted', async () => {
    const submitted = await reviews.queue({ status: ['submitted'] });
    expect(submitted.items.map((i) => i.organizationName).sort()).toEqual(['Отправлен', 'Отправлен тогда же']);
    expect(submitted.total).toBe(2);

    const pending = await reviews.queue({ status: ['pending_changes'] });
    expect(pending.items.map((i) => i.organizationName)).toEqual(['Ожидает изменений']);

    const both = await reviews.queue({ status: ['under_review', 'pending_changes'] });
    expect(both.items.map((i) => i.organizationName)).toEqual(['На проверке', 'Ожидает изменений']);
  });

  it('назначенный SME — имя из user_accounts', async () => {
    const { items } = await reviews.queue({});
    const assignee = Object.fromEntries(items.map((i) => [i.organizationName, i.assignedExpert]));
    expect(assignee).toEqual({
      Отправлен: null,
      'Отправлен тогда же': null,
      'На проверке': 'Эксперт IMBC',
      // Имя пустое — email.
      'Ожидает изменений': 'second@imbc.local',
    });
  });
});
