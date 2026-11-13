import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CreateDictionaryEntryInput,
  DICTIONARY_CODES,
  dictionaryChoicesQuerySchema,
  type DictionaryCode,
  type DictionaryEntriesQuery,
  dictionaryEntriesQuerySchema,
  type DictionaryEntry,
  type ReferenceFile,
  referenceFileSchema,
} from '@imbc/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { ProblemException } from '../src/common/problem.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import { loadReferenceDirectory, loadReferenceFile, REFERENCE_DATA_DIR } from '../src/database/reference-data.js';
import * as schema from '../src/database/schema/index.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { DICTIONARY_ROUTES, DictionariesService } from '../src/modules/dictionaries/dictionaries.service.js';
import { DICTIONARY_USAGES } from '../src/modules/dictionaries/usage.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Справочники на PostgreSQL 18: база после всех миграций, списки release загружены, ТН ВЭД — фикстура
// 12 000 значений (ADM-08, ADM-09, DATA-02, DATA-03, DATA-04, GEN-08).
const databaseUrl = process.env.TEST_DATABASE_URL;
const RELEASE = join(REFERENCE_DATA_DIR, 'release');
const IP = '192.0.2.20';
const TN_VED_COUNT = 12000;

/** Названия на трёх языках — форма администратора требует все три. */
const names = (base: string) => ({ kk: `${base} (kk)`, ru: `${base} (ru)`, en: `${base} (en)` });
const query = (input: Partial<DictionaryEntriesQuery> = {}) => dictionaryEntriesQuerySchema.parse(input);
const choicesQuery = (input: Record<string, unknown> = {}) => dictionaryChoicesQuerySchema.parse(input);
const createInput = (code: string, extra: Partial<CreateDictionaryEntryInput> = {}): CreateDictionaryEntryInput => ({
  code,
  parentCode: null,
  names: names(code),
  ...extra,
});

describe.skipIf(!databaseUrl)('справочники: API администратора, поиск и выбор значений', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let service: DictionariesService;
  let admin: AuthUser;
  let imbcId: string;

  /** Код и статус отказа ProblemException. */
  const problem = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProblemException);
    const p = error as ProblemException;
    return { status: p.getStatus(), code: p.code };
  };

  const audits = async (action: string, objectId?: string) =>
    (
      await pool.query<{
        diff: unknown;
        is_account_event: boolean;
        ip: string | null;
        user_id: string;
        outcome: string;
        object_type: string;
      }>(
        `select diff, is_account_event, host(ip) as ip, user_id, outcome, object_type from audit_entries
          where action = $1 and ($2::text is null or object_id = $2) order by at, id`,
        [action, objectId ?? null],
      )
    ).rows;

  /** Администратор IMBC в состоянии `state`. */
  const administrator = async (state: 'active' | 'blocked' = 'active'): Promise<AuthUser> => {
    const id = randomUUID();
    await db
      .insert(schema.userAccounts)
      .values({ id, organizationId: imbcId, email: `${id}@imbc.local`, role: 'administrator', state });
    return {
      id,
      email: `${id}@imbc.local`,
      fullName: null,
      role: 'administrator',
      organizationId: imbcId,
      organizationType: 'imbc',
      locale: 'kk',
    };
  };

  /** Значение по коду среди всех (и выведенных). */
  const entry = async (dictionary: DictionaryCode, code: string): Promise<DictionaryEntry> => {
    const page = await service.entries(dictionary, query({ q: code, status: 'all', pageSize: 100 }));
    const found = page.items.find((i) => i.code === code);
    if (!found) throw new Error(`Нет значения ${dictionary}/${code}`);
    return found;
  };

  const codes = (items: { code: string }[]) => items.map((i) => i.code);

  /** Строка значения целиком (jsonb) и её переводы. */
  const stored = async (id: string) => ({
    row: (await pool.query<{ row: unknown }>('select to_jsonb(e) as row from dictionary_entry e where id = $1', [id]))
      .rows[0]?.row,
    translations: (
      await pool.query(
        'select language, name from dictionary_entry_translation where dictionary_entry_id = $1 order by language',
        [id],
      )
    ).rows,
  });

  /**
   * Чужая транзакция держит строку значения `holdMs`, затем выполняет `during` и фиксируется; `action`
   * стартует, когда блокировка уже взята. Возвращает результат `action`.
   */
  const lockedDuring = async <T>(
    id: string,
    holdMs: number,
    during: (client: pg.PoolClient) => Promise<unknown>,
    action: () => Promise<T>,
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select 1 from dictionary_entry where id = $1 for no key update', [id]);
      const result = action();
      result.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      await during(client);
      await client.query('commit');
      return await result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  /** Производитель с профилем: организация и manufacturer_profiles. */
  const manufacturer = async () => {
    const bin = String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
    const org = await pool.query<{ id: string }>(
      "insert into organizations (type, name, bin) values ('manufacturer', $1, $2) returning id",
      [`ТОО ${bin}`, bin],
    );
    const profile = await pool.query<{ id: string }>(
      'insert into manufacturer_profiles (organization_id) values ($1) returning id',
      [org.rows[0]!.id],
    );
    return { organizationId: org.rows[0]!.id, profileId: profile.rows[0]!.id, bin };
  };

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    await loadReferenceDirectory(db, RELEASE, 'release');
    // 12 000 кодов ТН ВЭД с ведущими нулями; название только на русском, как у классификаторов без перевода.
    const tnVed: ReferenceFile = referenceFileSchema.parse({
      dictionary: 'tn_ved',
      status: 'provisional',
      source: 'тест',
      entries: Array.from({ length: TN_VED_COUNT }, (_, i) => ({
        code: String(i).padStart(10, '0'),
        names: { ru: `Позиция ${i}` },
        sortOrder: i,
      })),
    });
    await loadReferenceFile(db, tnVed, 'provisional');
    imbcId = (await pool.query<{ id: string }>("select id from organizations where type = 'imbc'")).rows[0]!.id;
    admin = await administrator();
    service = new DictionariesService(db, pool, new AuditService(db));
  }, 120000);

  afterAll(async () => {
    await pool?.end();
  });

  it('список: двенадцать справочников в порядке ADM-08 со счётчиками; commodity_group и contact_role — closed, certificate_type и document_type — mandatoryApplicable, у commodity_type parentDictionary commodity_group (ADM-08)', async () => {
    const loaded = new Map<string, number>();
    for (const name of readdirSync(RELEASE).filter((n) => n.endsWith('.json'))) {
      const file = referenceFileSchema.parse(JSON.parse(readFileSync(join(RELEASE, name), 'utf8')));
      loaded.set(file.dictionary, file.entries.length);
    }
    const { dictionaries } = await service.list();
    expect(dictionaries).toEqual(
      DICTIONARY_CODES.map((code) => ({
        code,
        closed: code === 'commodity_group' || code === 'contact_role',
        mandatoryApplicable: code === 'certificate_type' || code === 'document_type',
        parentDictionary: code === 'commodity_type' ? 'commodity_group' : null,
        active: code === 'tn_ved' ? TN_VED_COUNT : (loaded.get(code) ?? 0),
        retired: 0,
      })),
    );
    const byCode = Object.fromEntries(dictionaries.map((d) => [d.code, d]));
    expect(byCode.commodity_group).toMatchObject({ closed: true, active: 5 });
    expect(byCode.contact_role).toMatchObject({ closed: true, active: 3 });
    expect(byCode.certificate_type).toMatchObject({ mandatoryApplicable: true, active: 10 });
    expect(byCode.document_type).toMatchObject({ mandatoryApplicable: true });
    expect(byCode.commodity_type).toMatchObject({ parentDictionary: 'commodity_group', closed: false });
  });

  it('поиск по началу кода и по названию на любом языке без учёта регистра; 12 000 значений ТН ВЭД — страницы по 50, total 12000, страница 241 — пустая', async () => {
    // Точное совпадение кода — первым, затем начало кода, затем название; внутри — порядок и код.
    await service.create(admin, 'process', createInput('PIPE-2'), IP);
    await service.create(admin, 'process', createInput('PIPE'), IP);
    await service.create(
      admin,
      'process',
      createInput('WELD', { names: { kk: 'Құбыр дәнекерлеу', ru: 'Сварка труб', en: 'Pipe welding' } }),
      IP,
    );
    const pipe = await service.entries('process', query({ q: 'pipe' }));
    expect(codes(pipe.items)).toEqual(['PIPE', 'PIPE-2', 'WELD']);
    expect(pipe.total).toBe(3);
    expect(codes((await service.entries('certificate_type', query({ q: 'iec' }))).items)).toEqual(['IEC', 'IECEx']);
    expect(codes((await service.entries('certificate_type', query({ q: 'ISO' }))).items)).toEqual([
      'ISO 9001',
      'ISO 14001',
      'ISO 45001',
    ]);

    // Название — на любом языке, без учёта регистра (кириллица и казахские буквы тоже).
    for (const [dictionary, q, code] of [
      ['certificate_type', 'ҮЗІНДІ КӨШІРМЕСІ', 'Extract from e-Ondiris'],
      ['certificate_type', 'выписка ИЗ', 'Extract from e-Ondiris'],
      ['certificate_type', 'FROM E-ONDIRIS', 'Extract from e-Ondiris'],
      ['process', 'СВАРКА', 'WELD'],
    ] as const)
      expect(codes((await service.entries(dictionary, query({ q }))).items), q).toEqual([code]);
    expect(codes((await service.entries('certificate_type', query({ q: 'укажите НАЗВАНИЕ' }))).items)).toEqual([
      'Other',
    ]);
    expect((await service.entries('certificate_type', query({ q: 'нет такого' }))).items).toEqual([]);

    // Страницы — на сервере: total тем же условием, страница за последней пуста.
    const first = await service.entries('tn_ved', query());
    expect(first).toMatchObject({ total: TN_VED_COUNT, page: 1, pageSize: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]).toMatchObject({ code: '0000000000', names: { kk: null, ru: 'Позиция 0', en: null } });
    expect(first.dictionary).toMatchObject({ code: 'tn_ved', active: TN_VED_COUNT });
    const last = await service.entries('tn_ved', query({ page: 240 }));
    expect(last.items).toHaveLength(50);
    expect(last.items.at(-1)!.code).toBe('0000011999');
    const beyond = await service.entries('tn_ved', query({ page: 241 }));
    expect(beyond).toMatchObject({ items: [], total: TN_VED_COUNT, page: 241, pageSize: 50 });
    const prefix = await service.entries('tn_ved', query({ q: '00000119', pageSize: 100 }));
    expect(prefix.total).toBe(100);
    expect(prefix.items[0]!.code).toBe('0000011900');
    const choices = await service.choices('tn_ved', choicesQuery({ page: '241' }));
    expect(choices).toEqual({ items: [], total: TN_VED_COUNT, page: 241, pageSize: 50 });
  });

  it('поиск со знаками % и _ ищет их буквально', async () => {
    await service.create(
      admin,
      'equipment_type',
      createInput('PUMP_A', { names: { kk: 'Сорғы 100%', ru: 'Насос 100%', en: 'Pump 100%' } }),
      IP,
    );
    await service.create(
      admin,
      'equipment_type',
      createInput('PUMPXA', { names: { kk: 'Сорғы 1000', ru: 'Насос 1000', en: 'Pump 1000' } }),
      IP,
    );
    await service.create(
      admin,
      'equipment_type',
      createInput('VALVE', { names: { kk: 'Клапан a\\b', ru: 'Клапан a\\b', en: 'Valve a\\b' } }),
      IP,
    );
    const found = async (q: string) => codes((await service.entries('equipment_type', query({ q }))).items);
    // Без экранирования «_» — любой символ, «%» — любая строка, «\» — экранирует следующий символ шаблона.
    expect(await found('PUMP_')).toEqual(['PUMP_A']);
    expect(await found('_')).toEqual([]);
    expect(await found('100%')).toEqual(['PUMP_A']);
    expect(await found('%')).toEqual(['PUMP_A']);
    expect(await found('\\')).toEqual(['VALVE']);
    expect(await found('a\\b')).toEqual(['VALVE']);
    expect(codes((await service.choices('equipment_type', choicesQuery({ q: '%' }))).items)).toEqual(['PUMP_A']);
  });

  it("ведущие нули кодов сохраняются: создание '0101210000', ответ создания, список, выбор и поиск по '0101' возвращают '0101210000' (DATA-03)", async () => {
    const created = await service.create(
      admin,
      'tn_ved',
      createInput('0101210000', {
        names: { kk: 'Асыл тұқымды жылқылар', ru: 'Лошади чистопородные', en: 'Pure-bred horses' },
      }),
      IP,
    );
    expect(created.entry.code).toBe('0101210000');
    // Новое значение — в конце списка: порядок = наибольший в справочнике + 1.
    expect(created.entry.sortOrder).toBe(TN_VED_COUNT);
    const { rows } = await pool.query<{ code: string }>('select code from dictionary_entry where id = $1', [
      created.entry.id,
    ]);
    expect(rows[0]!.code).toBe('0101210000');

    const searched = await service.entries('tn_ved', query({ q: '0101' }));
    expect(searched.items[0]).toMatchObject({ id: created.entry.id, code: '0101210000' });
    const lastPage = await service.entries('tn_ved', query({ page: 241 }));
    expect(codes(lastPage.items)).toEqual(['0101210000']);
    const choice = await service.choices('tn_ved', choicesQuery({ q: '0101', lang: 'ru' }));
    expect(choice.items[0]).toEqual({
      id: created.entry.id,
      code: '0101210000',
      name: 'Лошади чистопородные',
      parentCode: null,
    });
    expect(typeof choice.items[0]!.code).toBe('string');
  });

  it('создание: тот же код другим регистром или с пробелом по краям — 409 entry_exists; не по шаблону — 400 code_format; обязательность вне типов сертификатов и документов — 409 mandatory_not_applicable; parentCode у commodity_type — действующее значение commodity_group, иначе 400 parent_invalid; аудит entry_created с названиями (ADM-08)', async () => {
    const before = (await service.entries('certificate_type', query({ status: 'all' }))).total;
    const auditsBefore = (await audits('dictionary.entry_created')).length;

    expect(await problem(service.create(admin, 'certificate_type', createInput('iso 9001'), IP))).toEqual({
      status: 409,
      code: 'entry_exists',
    });
    expect(await problem(service.create(admin, 'certificate_type', createInput('  ASME '), IP))).toEqual({
      status: 409,
      code: 'entry_exists',
    });
    for (const [dictionary, code] of [
      ['tn_ved', '101210000'],
      ['tn_ved', '01012100001'],
      ['oked', '0111'],
      ['kpved', '25.'],
      ['certificate_type', 'ТОО'],
      ['commodity_type', 'a;b'],
    ] as const)
      expect(await problem(service.create(admin, dictionary, createInput(code), IP)), `${dictionary} ${code}`).toEqual({
        status: 400,
        code: 'code_format',
      });
    for (const mandatory of [true, false])
      expect(await problem(service.create(admin, 'tn_ved', createInput('0202020202', { mandatory }), IP))).toEqual({
        status: 409,
        code: 'mandatory_not_applicable',
      });
    expect(
      await problem(service.create(admin, 'commodity_type', createInput('valves', { parentCode: 'F' }), IP)),
    ).toEqual({ status: 400, code: 'parent_invalid' });
    // Родитель есть только у типов товаров.
    expect(await problem(service.create(admin, 'tn_ved', createInput('0303030303', { parentCode: 'A' }), IP))).toEqual({
      status: 400,
      code: 'parent_invalid',
    });
    expect((await service.entries('certificate_type', query({ status: 'all' }))).total).toBe(before);
    expect(
      (await pool.query("select 1 from dictionary_entry where code in ('0202020202', '0303030303')")).rowCount,
    ).toBe(0);

    // Обязательность — только у типов сертификатов и документов; без признака — не обязательное.
    const nace = await service.create(admin, 'certificate_type', createInput('NACE', { mandatory: true }), IP);
    expect(nace.entry).toMatchObject({
      code: 'NACE',
      mandatory: true,
      customNameAllowed: false,
      retiredAt: null,
      parentCode: null,
      names: names('NACE'),
      // В справочнике загружено десять значений с порядком 0–9: новое встаёт в конец.
      sortOrder: 10,
    });
    const gost = await service.create(admin, 'certificate_type', createInput('GOST R'), IP);
    expect(gost.entry).toMatchObject({ mandatory: false, sortOrder: 11 });
    const empty = await service.create(admin, 'legal_form', createInput('SP'), IP);
    expect(empty.entry).toMatchObject({ mandatory: null });

    // Родитель — по коду без учёта регистра, в ответе — код как в справочнике.
    const valves = await service.create(admin, 'commodity_type', createInput('valves', { parentCode: 'b' }), IP);
    expect(valves.entry).toMatchObject({ code: 'valves', parentCode: 'B', mandatory: null, sortOrder: 0 });
    const pumps = await service.create(admin, 'commodity_type', createInput('pumps'), IP);
    expect(pumps.entry).toMatchObject({ parentCode: null, sortOrder: 1 });

    expect(await audits('dictionary.entry_created', nace.entry.id)).toEqual([
      {
        diff: { dictionary: 'certificate_type', code: 'NACE', parentCode: null, names: names('NACE'), mandatory: true },
        is_account_event: false,
        ip: IP,
        user_id: admin.id,
        outcome: 'ok',
        object_type: 'dictionary_entry',
      },
    ]);
    expect((await audits('dictionary.entry_created', valves.entry.id))[0]!.diff).toEqual({
      dictionary: 'commodity_type',
      code: 'valves',
      parentCode: 'B',
      names: names('valves'),
      mandatory: null,
    });
    // Отказы ничего не пишут: записей ровно по числу созданных значений.
    expect((await audits('dictionary.entry_created')).length).toBe(auditsBefore + 5);
  });

  it('названия сохраняются тремя строками перевода (DATA-02)', async () => {
    const { entry: created } = await service.create(
      admin,
      'legal_form',
      createInput('SOE', {
        names: { kk: 'Мемлекеттік кәсіпорын', ru: 'Государственное предприятие', en: 'State-owned enterprise' },
      }),
      IP,
    );
    expect((await stored(created.id)).translations).toEqual([
      { language: 'kk', name: 'Мемлекеттік кәсіпорын' },
      { language: 'ru', name: 'Государственное предприятие' },
      { language: 'en', name: 'State-owned enterprise' },
    ]);
    // Загруженное значение без части языков после правки получает все три строки.
    const zero = await entry('tn_ved', '0000000001');
    expect((await stored(zero.id)).translations).toEqual([{ language: 'ru', name: 'Позиция 1' }]);
    await service.update(admin, 'tn_ved', zero.id, { names: names('Позиция 1'), sortOrder: 1, parentCode: null }, IP);
    expect((await stored(zero.id)).translations).toEqual([
      { language: 'kk', name: 'Позиция 1 (kk)' },
      { language: 'ru', name: 'Позиция 1 (ru)' },
      { language: 'en', name: 'Позиция 1 (en)' },
    ]);
  });

  it('закрытые справочники: добавить, вывести, удалить — 409 dictionary_closed; переименовать — можно', async () => {
    const closed = { status: 409, code: 'dictionary_closed' };
    expect(await problem(service.create(admin, 'commodity_group', createInput('E'), IP))).toEqual(closed);
    expect(await problem(service.create(admin, 'contact_role', createInput('legal'), IP))).toEqual(closed);
    const group = await entry('commodity_group', 'A');
    expect(await problem(service.retire(admin, 'commodity_group', group.id, IP))).toEqual(closed);
    expect(await problem(service.restore(admin, 'commodity_group', group.id, IP))).toEqual(closed);
    expect(await problem(service.remove(admin, 'commodity_group', group.id, IP))).toEqual(closed);
    const role = await entry('contact_role', 'technical');
    expect(await problem(service.remove(admin, 'contact_role', role.id, IP))).toEqual(closed);

    const renamed = await service.update(
      admin,
      'commodity_group',
      group.id,
      { names: { kk: 'А тобы', ru: 'Группа А', en: 'Group A' }, sortOrder: 7, parentCode: null },
      IP,
    );
    expect(renamed.entry).toMatchObject({
      code: 'A',
      sortOrder: 7,
      names: { kk: 'А тобы', ru: 'Группа А', en: 'Group A' },
    });
    expect(await audits('dictionary.entry_updated', group.id)).toHaveLength(1);
    // У закрытых справочников родителя нет.
    expect(
      await problem(
        service.update(admin, 'commodity_group', group.id, { names: names('A'), sortOrder: 7, parentCode: 'B' }, IP),
      ),
    ).toEqual({ status: 400, code: 'parent_invalid' });
    const { rows } = await pool.query(
      `select e.code, e.retired_at from dictionary_entry e join dictionary d on d.id = e.dictionary_id
        where d.code = 'commodity_group' order by e.code`,
    );
    expect(rows).toEqual(['A', 'B', 'C', 'D', 'E'].map((code) => ({ code, retired_at: null })));
  });

  it('правка названий и порядка: аудит from/to; без изменения — 200 без записи', async () => {
    const atex = await entry('certificate_type', 'ATEX');
    const input = { names: { kk: 'ATEX (ЕО)', ru: 'ATEX (ЕС)', en: 'ATEX (EU)' }, sortOrder: 20, parentCode: null };
    const updated = await service.update(admin, 'certificate_type', atex.id, input, IP);
    expect(updated.entry).toEqual({ ...atex, names: input.names, sortOrder: 20 });
    expect(await audits('dictionary.entry_updated', atex.id)).toEqual([
      {
        diff: {
          from: { names: { kk: 'ATEX', ru: 'ATEX', en: 'ATEX' }, sortOrder: 7, parentCode: null },
          to: { names: input.names, sortOrder: 20, parentCode: null },
        },
        is_account_event: false,
        ip: IP,
        user_id: admin.id,
        outcome: 'ok',
        object_type: 'dictionary_entry',
      },
    ]);
    // Повтор — 200 с тем же значением, записи нет.
    expect(await service.update(admin, 'certificate_type', atex.id, input, IP)).toEqual(updated);
    expect(await audits('dictionary.entry_updated', atex.id)).toHaveLength(1);

    // Родитель типа товара меняется и снимается; аудит — коды родителя.
    const valves = await entry('commodity_type', 'valves');
    expect(valves.names).toEqual(names('valves'));
    const keep = { names: names('valves'), sortOrder: valves.sortOrder };
    const moved = await service.update(admin, 'commodity_type', valves.id, { ...keep, parentCode: 'c' }, IP);
    expect(moved.entry.parentCode).toBe('C');
    const unparented = await service.update(admin, 'commodity_type', valves.id, { ...keep, parentCode: null }, IP);
    expect(unparented.entry.parentCode).toBeNull();
    expect((await audits('dictionary.entry_updated', valves.id)).map((a) => a.diff)).toEqual([
      {
        from: { names: valves.names, sortOrder: valves.sortOrder, parentCode: 'B' },
        to: { names: valves.names, sortOrder: valves.sortOrder, parentCode: 'C' },
      },
      {
        from: { names: valves.names, sortOrder: valves.sortOrder, parentCode: 'C' },
        to: { names: valves.names, sortOrder: valves.sortOrder, parentCode: null },
      },
    ]);
    expect(
      await problem(
        service.update(admin, 'commodity_type', valves.id, { ...input, sortOrder: 0, parentCode: 'Z' }, IP),
      ),
    ).toEqual({ status: 400, code: 'parent_invalid' });

    // Значение другого справочника, неизвестный и неверный id — 404.
    for (const [dictionary, id] of [
      ['tn_ved', atex.id],
      ['certificate_type', randomUUID()],
      ['certificate_type', 'not-a-uuid'],
      ['country', atex.id],
    ] as const)
      expect(await problem(service.update(admin, dictionary, id, input, IP)), `${dictionary} ${id}`).toEqual({
        status: 404,
        code: 'not_found',
      });
  });

  it('обязательность (ADM-09): меняется только dictionary_entry.mandatory, аудит {from,to}; у выведенного — 409 entry_retired; повтор — без записи', async () => {
    const iec = await entry('certificate_type', 'IEC');
    const before = await stored(iec.id);
    const result = await service.setMandatory(admin, 'certificate_type', iec.id, true, IP);
    expect(result.entry).toEqual({ ...iec, mandatory: true });
    const after = await stored(iec.id);
    expect(after.translations).toEqual(before.translations);
    expect(after.row).toEqual({ ...(before.row as object), mandatory: true });
    expect(await audits('dictionary.entry_mandatory_changed', iec.id)).toEqual([
      {
        diff: { from: false, to: true },
        is_account_event: false,
        ip: IP,
        user_id: admin.id,
        outcome: 'ok',
        object_type: 'dictionary_entry',
      },
    ]);
    // Повтор — без записи.
    await service.setMandatory(admin, 'certificate_type', iec.id, true, IP);
    expect(await audits('dictionary.entry_mandatory_changed', iec.id)).toHaveLength(1);
    await service.setMandatory(admin, 'certificate_type', iec.id, false, IP);
    expect((await audits('dictionary.entry_mandatory_changed', iec.id)).map((a) => a.diff)).toEqual([
      { from: false, to: true },
      { from: true, to: false },
    ]);

    // Типы документов — тоже; остальные справочники — 409.
    const statements = await entry('document_type', 'financial_statements');
    expect((await service.setMandatory(admin, 'document_type', statements.id, true, IP)).entry.mandatory).toBe(true);
    await service.setMandatory(admin, 'document_type', statements.id, false, IP);
    const tnVed = await entry('tn_ved', '0000000002');
    expect(await problem(service.setMandatory(admin, 'tn_ved', tnVed.id, true, IP))).toEqual({
      status: 409,
      code: 'mandatory_not_applicable',
    });

    // Выведенное из оборота нельзя сделать обязательным.
    const api = await entry('certificate_type', 'API');
    await service.retire(admin, 'certificate_type', api.id, IP);
    expect(await problem(service.setMandatory(admin, 'certificate_type', api.id, true, IP))).toEqual({
      status: 409,
      code: 'entry_retired',
    });
    expect((await stored(api.id)).row).toMatchObject({ mandatory: false });
    expect(await audits('dictionary.entry_mandatory_changed', api.id)).toEqual([]);
    await service.restore(admin, 'certificate_type', api.id, IP);
  });

  it('вывод из оборота (DATA-04): выведенное не отдаётся выбору, остаётся в списке «выведенные» и «все»; возврат возвращает в выбор; обязательное вывести и удалить нельзя — 409 entry_mandatory', async () => {
    const iecex = await entry('certificate_type', 'IECEx');
    const choiceCodes = async () =>
      codes((await service.choices('certificate_type', choicesQuery({ pageSize: '100' }))).items);
    const listed = async (status: 'active' | 'retired' | 'all') =>
      codes((await service.entries('certificate_type', query({ status, pageSize: 100 }))).items);
    expect(await choiceCodes()).toContain('IECEx');

    const retired = await service.retire(admin, 'certificate_type', iecex.id, IP);
    expect(retired.entry.retiredAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(retired.entry.retiredAt!))).toBe(false);
    expect(await choiceCodes()).not.toContain('IECEx');
    expect(await listed('active')).not.toContain('IECEx');
    expect(await listed('retired')).toEqual(['IECEx']);
    expect(await listed('all')).toContain('IECEx');
    const summary = (await service.list()).dictionaries.find((d) => d.code === 'certificate_type')!;
    expect(summary.retired).toBe(1);
    expect((await service.entries('certificate_type', query())).dictionary).toEqual(summary);
    // Повтор — 200 без записи.
    expect((await service.retire(admin, 'certificate_type', iecex.id, IP)).entry.retiredAt).toBe(
      retired.entry.retiredAt,
    );
    expect(await audits('dictionary.entry_retired', iecex.id)).toEqual([
      {
        diff: null,
        is_account_event: false,
        ip: IP,
        user_id: admin.id,
        outcome: 'ok',
        object_type: 'dictionary_entry',
      },
    ]);

    const restored = await service.restore(admin, 'certificate_type', iecex.id, IP);
    expect(restored.entry).toEqual(iecex);
    expect(await choiceCodes()).toContain('IECEx');
    await service.restore(admin, 'certificate_type', iecex.id, IP);
    expect(await audits('dictionary.entry_restored', iecex.id)).toHaveLength(1);

    // Обязательное значение (MAN-34: ISO 9001) не выводится и не удаляется.
    const iso = await entry('certificate_type', 'ISO 9001');
    expect(iso.mandatory).toBe(true);
    expect(await problem(service.retire(admin, 'certificate_type', iso.id, IP))).toEqual({
      status: 409,
      code: 'entry_mandatory',
    });
    expect(await problem(service.remove(admin, 'certificate_type', iso.id, IP))).toEqual({
      status: 409,
      code: 'entry_mandatory',
    });
    expect(await entry('certificate_type', 'ISO 9001')).toEqual(iso);
  });

  it('значение, использованное в профиле, удалить нельзя: код ТН ВЭД в catalog_visible.tnved_codes и тип сертификата ASME в certificates.type_code — 409 entry_in_use, значение на месте; неиспользуемое удаляется вместе с переводами, аудит entry_deleted с прежними кодом и названиями (DATA-04, DATA-01)', async () => {
    const inUse = { status: 409, code: 'entry_in_use' };
    const visible = await manufacturer();
    await db.insert(schema.catalogVisible).values({
      profileId: visible.profileId,
      organizationId: visible.organizationId,
      bin: visible.bin,
      nameEn: 'Maker',
      nameRu: 'Производитель',
      nameNormalized: 'maker',
      region: 'KZ-ATY',
      commodityGroups: ['A'],
      commodityTypes: [],
      tnvedCodes: ['0000000007'],
      kpvedCodes: [],
      okedCodes: [],
      certificateTypes: [],
      certificatesValidUntil: {},
      updateStatus: 'active',
      verifiedAt: new Date(),
      card: {},
    });
    // Сертификат профиля: минимальная цепочка профиль → секция → редакция.
    const owner = await manufacturer();
    const section = await pool.query<{ id: string }>(
      "insert into profile_sections (profile_id, kind) values ($1, 'certificates') returning id",
      [owner.profileId],
    );
    const revision = await pool.query<{ id: string }>(
      'insert into section_revisions (section_id, number) values ($1, 1) returning id',
      [section.rows[0]!.id],
    );
    await pool.query(
      `insert into certificates (revision_id, type_code, number, issuer, issued_on)
        values ($1, 'ASME', 'N-1', 'ASME', '2025-01-01')`,
      [revision.rows[0]!.id],
    );

    const used = await entry('tn_ved', '0000000007');
    const asme = await entry('certificate_type', 'ASME');
    expect(await problem(service.remove(admin, 'tn_ved', used.id, IP))).toEqual(inUse);
    expect(await problem(service.remove(admin, 'certificate_type', asme.id, IP))).toEqual(inUse);
    expect(await entry('tn_ved', '0000000007')).toEqual(used);
    expect(await entry('certificate_type', 'ASME')).toEqual(asme);
    expect(await audits('dictionary.entry_deleted', used.id)).toEqual([]);

    // Совпадение — точное: '0000000070' в массиве не встречается.
    const unused = await entry('tn_ved', '0000000070');
    await expect(service.remove(admin, 'tn_ved', unused.id, IP)).resolves.toBeUndefined();
    expect(await stored(unused.id)).toEqual({ row: undefined, translations: [] });
    expect(await audits('dictionary.entry_deleted', unused.id)).toEqual([
      {
        diff: { code: '0000000070', names: { kk: null, ru: 'Позиция 70', en: null } },
        is_account_event: false,
        ip: IP,
        user_id: admin.id,
        outcome: 'ok',
        object_type: 'dictionary_entry',
      },
    ]);
    expect(await problem(service.remove(admin, 'tn_ved', unused.id, IP))).toEqual({ status: 404, code: 'not_found' });

    // Ссылка внешним ключом (с этапа 3 — dictionary_entry_id в таблицах профиля): 23503 — тоже 409 entry_in_use.
    const referenced = await entry('tn_ved', '0000000009');
    await pool.query('create table test_dictionary_reference (entry_id uuid references dictionary_entry (id))');
    try {
      await pool.query('insert into test_dictionary_reference values ($1)', [referenced.id]);
      expect(await problem(service.remove(admin, 'tn_ved', referenced.id, IP))).toEqual(inUse);
      expect(await entry('tn_ved', '0000000009')).toEqual(referenced);
      expect(await audits('dictionary.entry_deleted', referenced.id)).toEqual([]);
    } finally {
      await pool.query('drop table test_dictionary_reference');
    }
  });

  it('DICTIONARY_USAGES: каждая колонка есть в базе, массив — text[], иначе text; у закрытых справочников ссылок нет', async () => {
    for (const [dictionary, usages] of Object.entries(DICTIONARY_USAGES))
      for (const usage of usages) {
        const { rows } = await pool.query<{ data_type: string; udt_name: string }>(
          `select data_type, udt_name from information_schema.columns
            where table_schema = 'public' and table_name = $1 and column_name = $2`,
          [usage.table, usage.column],
        );
        expect(rows, `${dictionary}: ${usage.table}.${usage.column}`).toEqual([
          usage.array ? { data_type: 'ARRAY', udt_name: '_text' } : { data_type: 'text', udt_name: 'text' },
        ]);
      }
    expect(DICTIONARY_USAGES.commodity_group).toEqual([]);
    expect(DICTIONARY_USAGES.contact_role).toEqual([]);
    expect(Object.keys(DICTIONARY_USAGES)).toEqual([...DICTIONARY_CODES]);
  });

  it('выбор: только действующие; название на языке lang, запасной порядок kk → ru → en → код; неизвестный справочник — 404', async () => {
    const created = await service.create(
      admin,
      'kpved',
      createInput('25.11', { names: { kk: 'Металл құрылымдар', ru: 'Металлоконструкции', en: 'Metal structures' } }),
      IP,
    );
    const name = async (dictionary: DictionaryCode, q: string, lang?: string) =>
      (await service.choices(dictionary, choicesQuery({ q, ...(lang ? { lang } : {}) }))).items.find(
        (i) => i.code === q,
      )?.name;
    expect(await name('kpved', '25.11', 'en')).toBe('Metal structures');
    expect(await name('kpved', '25.11', 'ru')).toBe('Металлоконструкции');
    expect(await name('kpved', '25.11')).toBe('Металл құрылымдар');
    // Только русское название: для en — kk нет, значит ru.
    expect(await name('tn_ved', '0000000003', 'en')).toBe('Позиция 3');
    // Значения загрузки без части переводов и вовсе без них (вставка в обход API).
    const oked = await pool.query<{ id: string }>("select id from dictionary where code = 'oked'");
    const english = await pool.query<{ id: string }>(
      "insert into dictionary_entry (dictionary_id, code) values ($1, '01110') returning id",
      [oked.rows[0]!.id],
    );
    await pool.query(
      "insert into dictionary_entry_translation (dictionary_entry_id, language, name) values ($1, 'en', 'Growing of cereals')",
      [english.rows[0]!.id],
    );
    await pool.query("insert into dictionary_entry (dictionary_id, code) values ($1, '01120')", [oked.rows[0]!.id]);
    expect(await name('oked', '01110', 'ru')).toBe('Growing of cereals');
    expect(await name('oked', '01120', 'kk')).toBe('01120');

    const page = await service.choices('kpved', choicesQuery({ lang: 'en' }));
    expect(page).toEqual({
      items: [{ id: created.entry.id, code: '25.11', name: 'Metal structures', parentCode: null }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    // Родитель типа товара — для фильтра по группе.
    await service.create(admin, 'commodity_type', createInput('compressors', { parentCode: 'D' }), IP);
    expect((await service.choices('commodity_type', choicesQuery({ q: 'compressors' }))).items).toEqual([
      expect.objectContaining({ code: 'compressors', parentCode: 'D' }),
    ]);
    // Выведенное — не выбирается.
    await service.retire(admin, 'kpved', created.entry.id, IP);
    expect(await service.choices('kpved', choicesQuery())).toEqual({ items: [], total: 0, page: 1, pageSize: 50 });

    for (const call of [
      service.choices('country', choicesQuery()),
      service.entries('country', query()),
      service.choices('Region', choicesQuery()),
    ])
      expect(await problem(call)).toEqual({ status: 404, code: 'not_found' });
  });

  it('удаление одного значения дважды параллельно — 204 и 404, одна запись аудита', async () => {
    // Два администратора (их строки не мешают друг другу); оба удаления стартуют, пока строка значения занята.
    const second = await administrator();
    const { entry: created } = await service.create(admin, 'process', createInput('CAST'), IP);
    const results = await lockedDuring(
      created.id,
      300,
      async () => undefined,
      () =>
        Promise.allSettled([
          service.remove(admin, 'process', created.id, IP),
          service.remove(second, 'process', created.id, IP),
        ]),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [rejected] = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected!.reason).toBeInstanceOf(ProblemException);
    expect((rejected!.reason as ProblemException).code).toBe('not_found');
    expect(await audits('dictionary.entry_deleted', created.id)).toHaveLength(1);
    expect(await stored(created.id)).toEqual({ row: undefined, translations: [] });
  });

  it('удаление ждёт блокировку значения и перечитывает его: стало обязательным — 409 entry_mandatory, стало использоваться — 409 entry_in_use; занято дольше 2 с — 503 busy', async () => {
    const { entry: optional } = await service.create(admin, 'certificate_type', createInput('EN 1090'), IP);
    const { entry: region } = await service.create(admin, 'region', createInput('KZ-TST'), IP);

    // Обязательность поставлена, пока удаление ждало блокировку.
    expect(
      await lockedDuring(
        optional.id,
        300,
        (client) => client.query('update dictionary_entry set mandatory = true where id = $1', [optional.id]),
        () => problem(service.remove(admin, 'certificate_type', optional.id, IP)),
      ),
    ).toEqual({ status: 409, code: 'entry_mandatory' });

    // Код региона появился в проекции каталога, пока удаление ждало блокировку.
    const maker = await manufacturer();
    expect(
      await lockedDuring(
        region.id,
        300,
        (client) =>
          client.query(
            `insert into catalog_visible (profile_id, organization_id, bin, name_en, name_ru, name_normalized, region,
              commodity_groups, commodity_types, tnved_codes, kpved_codes, oked_codes, certificate_types,
              certificates_valid_until, update_status, verified_at, card)
              values ($1, $2, $3, 'M', 'M', 'm', 'KZ-TST', '{A}', '{}', '{}', '{}', '{}', '{}', '{}', 'active', now(), '{}')`,
            [maker.profileId, maker.organizationId, maker.bin],
          ),
        () => problem(service.remove(admin, 'region', region.id, IP)),
      ),
    ).toEqual({ status: 409, code: 'entry_in_use' });

    // Строка занята дольше lock_timeout — 503 busy, повтор безопасен.
    expect(
      await lockedDuring(
        optional.id,
        2600,
        async () => undefined,
        () => problem(service.retire(admin, 'certificate_type', optional.id, IP)),
      ),
    ).toEqual({ status: 503, code: 'busy' });
    expect(await audits('dictionary.entry_retired', optional.id)).toEqual([]);
    expect(await audits('dictionary.entry_deleted', optional.id)).toEqual([]);
  });

  it('исполнитель перестал быть администратором до транзакции — 403, запись denied с action reference.manage и путём маршрута', async () => {
    // Сеанс прошёл guard, затем аккаунт заблокировали: сервис вызывается напрямую уже заблокированным.
    const blocked = await administrator();
    await pool.query(`update user_accounts set state = 'blocked' where id = $1`, [blocked.id]);
    const target = await entry('certificate_type', 'Other');
    const forbidden = { status: 403, code: 'forbidden' };
    expect(await problem(service.create(blocked, 'process', createInput('FORGE'), IP))).toEqual(forbidden);
    expect(
      await problem(
        service.update(
          blocked,
          'certificate_type',
          target.id,
          { names: names('x'), sortOrder: 0, parentCode: null },
          IP,
        ),
      ),
    ).toEqual(forbidden);
    expect(await problem(service.setMandatory(blocked, 'certificate_type', target.id, true, IP))).toEqual(forbidden);
    expect(await problem(service.retire(blocked, 'certificate_type', target.id, IP))).toEqual(forbidden);
    expect(await problem(service.restore(blocked, 'certificate_type', target.id, null))).toEqual(forbidden);
    expect(await problem(service.remove(blocked, 'certificate_type', target.id, IP))).toEqual(forbidden);
    // Роль сменилась (директор): права reference.manage нет — тоже отказ.
    const demoted = await administrator();
    await pool.query(`update user_accounts set role = 'director' where id = $1`, [demoted.id]);
    expect(await problem(service.retire(demoted, 'certificate_type', target.id, IP))).toEqual(forbidden);

    expect((await pool.query("select 1 from dictionary_entry where code = 'FORGE'")).rowCount).toBe(0);
    expect(await entry('certificate_type', 'Other')).toEqual(target);
    const { rows } = await pool.query<{
      action: string;
      object_type: string;
      object_id: string;
      outcome: string;
      ip: string | null;
    }>(
      `select action, object_type, object_id, outcome, host(ip) as ip from audit_entries
        where user_id = any($1::uuid[]) order by at, id`,
      [[blocked.id, demoted.id]],
    );
    const denied = (objectId: string, ip: string | null = IP) => ({
      action: 'reference.manage',
      object_type: 'route',
      object_id: objectId,
      outcome: 'denied',
      ip,
    });
    expect(rows).toEqual([
      denied(DICTIONARY_ROUTES.entries),
      denied(DICTIONARY_ROUTES.entry),
      denied(DICTIONARY_ROUTES.mandatory),
      denied(DICTIONARY_ROUTES.retire),
      denied(DICTIONARY_ROUTES.restore, null),
      denied(DICTIONARY_ROUTES.entry),
      denied(DICTIONARY_ROUTES.retire),
    ]);
  });

  it('действия администратора идут под ролью приложения: у неё только SELECT на dictionary', async () => {
    const ROLE = 'imbc_dictionaries_test';
    /** Роль кластера удаляется вместе с правами, даже если тест упал. */
    const dropRole = () =>
      pool.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE};
          REVOKE ALL ON SCHEMA public FROM ${ROLE};
          DROP ROLE ${ROLE};
        END IF;
      END $$`);
    await dropRole();
    await pool.query(`CREATE ROLE ${ROLE} NOLOGIN`);
    let rolePool: pg.Pool | undefined;
    try {
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
      await applyAppRoleGrants(pool, ROLE);
      rolePool = new pg.Pool({ connectionString: databaseUrl, max: 2, options: `-c role=${ROLE}` });
      const roleDb = drizzle(rolePool, { schema, casing: 'snake_case' });
      const asApp = new DictionariesService(roleDb, rolePool, new AuditService(roleDb));

      const { entry: created } = await asApp.create(
        admin,
        'commodity_type',
        createInput('heat exchangers', { parentCode: 'E' }),
        IP,
      );
      await asApp.update(
        admin,
        'commodity_type',
        created.id,
        { names: names('hx'), sortOrder: 5, parentCode: 'A' },
        IP,
      );
      await asApp.retire(admin, 'commodity_type', created.id, IP);
      await asApp.restore(admin, 'commodity_type', created.id, IP);
      const { entry: type } = await asApp.create(admin, 'document_type', createInput('permit'), IP);
      await asApp.setMandatory(admin, 'document_type', type.id, true, IP);
      await asApp.setMandatory(admin, 'document_type', type.id, false, IP);
      await asApp.remove(admin, 'document_type', type.id, IP);
      await asApp.remove(admin, 'commodity_type', created.id, IP);
      expect((await asApp.list()).dictionaries).toHaveLength(12);
      expect((await asApp.entries('commodity_type', query({ q: 'heat' }))).items).toEqual([]);
      expect((await asApp.choices('document_type', choicesQuery({ q: 'permit' }))).items).toEqual([]);
    } finally {
      await rolePool?.end();
      await dropRole();
    }
  });
});
