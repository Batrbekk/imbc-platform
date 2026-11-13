import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMMODITY_GROUPS,
  CONTACT_ROLES,
  DICTIONARY_CODES,
  type DictionaryCode,
  type ReferenceFile,
  referenceFileSchema,
} from '@imbc/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import {
  loadReferenceDirectory,
  loadReferenceFile,
  REFERENCE_DATA_DIR,
  ReferenceFileError,
  referenceLoadSummary,
} from '../src/database/reference-data.js';
import * as schema from '../src/database/schema/index.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { DictionariesService } from '../src/modules/dictionaries/dictionaries.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

const RELEASE = join(REFERENCE_DATA_DIR, 'release');
const PROVISIONAL = join(REFERENCE_DATA_DIR, 'provisional');

/** Файл справочника для теста: значения по умолчанию подставляет схема, как при чтении JSON. */
function fixture(
  dictionary: DictionaryCode,
  entries: unknown[],
  status: ReferenceFile['status'] = 'provisional',
): ReferenceFile {
  return referenceFileSchema.parse({ dictionary, status, source: 'тест', entries });
}

// ADM-08, DATA-03: справочники загружаются из файлов репозитория — списки спецификации при миграции,
// временные значения только в seed. PostgreSQL 18, база после всех миграций.
describe.skipIf(!process.env.TEST_DATABASE_URL)('загрузка справочников из файлов', () => {
  vi.setConfig({ testTimeout: 60000 });
  let pool: pg.Pool;
  let db: Database;
  const tempDirs: string[] = [];

  beforeAll(() => {
    pool = openTestPool();
    db = drizzle(pool, { schema, casing: 'snake_case' });
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    await migrateThrough(pool);
  }, 60000);

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** Временный каталог с файлами `<имя>.json`. */
  function directoryWith(files: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), 'imbc-reference-'));
    tempDirs.push(dir);
    for (const [name, content] of Object.entries(files))
      writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
    return dir;
  }

  interface EntryRow {
    code: string;
    parent: string | null;
    mandatory: boolean | null;
    custom_name_allowed: boolean;
    sort_order: number;
    retired_at: Date | null;
    names: Record<string, string> | null;
  }

  const entries = async (dictionary: string): Promise<EntryRow[]> =>
    (
      await pool.query<EntryRow>(
        `select e.code, p.code as parent, e.mandatory, e.custom_name_allowed, e.sort_order, e.retired_at,
                (select jsonb_object_agg(t.language, t.name) from dictionary_entry_translation t
                  where t.dictionary_entry_id = e.id) as names
         from dictionary_entry e
         join dictionary d on d.id = e.dictionary_id
         left join dictionary_entry p on p.id = e.parent_entry_id
         where d.code = $1 order by e.sort_order, e.code`,
        [dictionary],
      )
    ).rows;

  const counts = async () =>
    (
      await pool.query<{ entries: number; translations: number; audit: number }>(
        `select (select count(*)::int from dictionary_entry) as entries,
                (select count(*)::int from dictionary_entry_translation) as translations,
                (select count(*)::int from audit_entries where action = 'reference.loaded') as audit`,
      )
    ).rows[0]!;

  const audit = async () =>
    (
      await pool.query<{
        action: string;
        object_type: string;
        object_id: string;
        outcome: string;
        diff: unknown;
        is_account_event: boolean;
        user_id: string | null;
        organization_id: string | null;
        ip: string | null;
      }>(
        `select action, object_type, object_id, outcome, diff, is_account_event, user_id, organization_id, ip
         from audit_entries where action = 'reference.loaded' order by at, object_id`,
      )
    ).rows;

  /** Администратор IMBC в базе: действия справочников проверяют исполнителя под блокировкой (actorTransaction). */
  const administrator = async (): Promise<AuthUser> => {
    const imbc = await pool.query<{ id: string }>("select id from organizations where type = 'imbc'");
    const id = randomUUID();
    await pool.query(
      "insert into user_accounts (id, organization_id, email, role, state) values ($1, $2, $3, 'administrator', 'active')",
      [id, imbc.rows[0]!.id, `${id}@imbc.local`],
    );
    return {
      id,
      email: `${id}@imbc.local`,
      fullName: null,
      role: 'administrator',
      organizationId: imbc.rows[0]!.id,
      organizationType: 'imbc',
      locale: 'kk',
    };
  };

  /** API справочников администратора: удаление пишет аудит `dictionary.entry_deleted`, по нему судит загрузчик. */
  const dictionaries = (database: Database = db, connections: pg.Pool = pool) =>
    new DictionariesService(database, connections, new AuditService(database));

  const entryId = async (dictionary: string, code: string) =>
    (
      await pool.query<{ id: string }>(
        'select e.id from dictionary_entry e join dictionary d on d.id = e.dictionary_id where d.code = $1 and e.code = $2',
        [dictionary, code],
      )
    ).rows[0]!.id;

  it('release: правовые формы LLP, LLC, JSC; группы A–E; роли management, technical, commercial; типы сертификатов — ISO 9001, ISO 14001, ISO 45001 обязательные, Other с customNameAllowed; типы документов — registration_certificate, charter, licence обязательные, financial_statements нет (MAN-09, MAN-13, MAN-34, MAN-37, MAN-38)', async () => {
    const results = await loadReferenceDirectory(db, RELEASE, 'release');

    // Родительский справочник раньше дочернего, порядок — как в DICTIONARY_CODES (ADM-08).
    expect(results.map((r) => r.dictionary)).toEqual([
      'legal_form',
      'commodity_group',
      'contact_role',
      'certificate_type',
      'document_type',
    ]);
    expect(results.map((r) => r.inserted)).toEqual([3, 5, 3, 10, 4]);

    // MAN-09: правовые формы — LLP, LLC, JSC (полный перечень — IMBC).
    const legalForms = await entries('legal_form');
    expect(legalForms.map((e) => e.code).sort()).toEqual(['JSC', 'LLC', 'LLP']);
    expect(legalForms.find((e) => e.code === 'LLP')!.names).toEqual({
      kk: 'Жауапкершілігі шектеулі серіктестік (ЖШС)',
      ru: 'Товарищество с ограниченной ответственностью (ТОО)',
      en: 'Limited liability partnership (LLP)',
    });
    expect(legalForms.every((e) => e.mandatory === null && !e.custom_name_allowed)).toBe(true);

    // MAN-23, OPR-02: группы A–E.
    const groups = await entries('commodity_group');
    expect(groups.map((e) => e.code)).toEqual([...COMMODITY_GROUPS]);
    expect(groups.map((e) => e.sort_order)).toEqual([0, 1, 2, 3, 4]);
    expect(groups.find((e) => e.code === 'C')!.names).toEqual({ kk: 'C тобы', ru: 'Группа C', en: 'Group C' });

    // MAN-13: ровно три роли.
    const roles = await entries('contact_role');
    expect(roles.map((e) => e.code).sort()).toEqual([...CONTACT_ROLES].sort());
    expect(roles.find((e) => e.code === 'technical')!.names).toEqual({
      kk: 'Техникалық',
      ru: 'Техническое направление',
      en: 'Technical',
    });

    // MAN-34: ISO 9001, 14001, 45001 — обязательные на старте; остальные — нет; Other — своё название.
    const certificates = await entries('certificate_type');
    expect(certificates.map((e) => e.code)).toEqual([
      'ISO 9001',
      'ISO 14001',
      'ISO 45001',
      'ASME',
      'API',
      'IEC',
      'IECEx',
      'ATEX',
      'Extract from e-Ondiris',
      'Other',
    ]);
    expect(certificates.filter((e) => e.mandatory).map((e) => e.code)).toEqual(['ISO 9001', 'ISO 14001', 'ISO 45001']);
    expect(certificates.filter((e) => e.mandatory === false)).toHaveLength(7);
    expect(certificates.filter((e) => e.custom_name_allowed).map((e) => e.code)).toEqual(['Other']);
    // Названия кодов стандартов — сами коды на трёх языках; CT-KZ среди типов нет (MAN-34).
    expect(certificates.find((e) => e.code === 'ISO 9001')!.names).toEqual({
      kk: 'ISO 9001',
      ru: 'ISO 9001',
      en: 'ISO 9001',
    });
    expect(certificates.find((e) => e.code === 'Extract from e-Ondiris')!.names).toEqual({
      kk: 'e-Ondiris үзінді көшірмесі',
      ru: 'Выписка из e-Ondiris',
      en: 'Extract from e-Ondiris',
    });
    expect(certificates.find((e) => e.code === 'Other')!.names).toEqual({
      kk: 'Басқа (атауын көрсетіңіз)',
      ru: 'Другой (укажите название)',
      en: 'Other (enter the name)',
    });
    expect(certificates.every((e) => e.retired_at === null)).toBe(true);

    // MAN-37, MAN-38: свидетельство, устав, лицензии — обязательные; финансовая отчётность — нет.
    const documents = await entries('document_type');
    expect(documents.map((e) => [e.code, e.mandatory])).toEqual([
      ['registration_certificate', true],
      ['charter', true],
      ['licence', true],
      ['financial_statements', false],
    ]);
    expect(documents.find((e) => e.code === 'licence')!.names).toEqual({
      kk: 'Лицензиялар',
      ru: 'Лицензии',
      en: 'Licences',
    });

    // Спецификация не называет перечней остальных семи справочников: до перечня IMBC они пусты.
    for (const code of ['region', 'oked', 'tn_ved', 'kpved', 'commodity_type', 'process', 'equipment_type'])
      expect(await entries(code), code).toEqual([]);
  });

  it('повторная загрузка ничего не добавляет; название, исправленное администратором, не возвращается; недостающий перевод добавляется', async () => {
    await loadReferenceDirectory(db, RELEASE, 'release');
    const first = await counts();
    expect(first).toEqual({ entries: 25, translations: 75, audit: 5 });

    // Администратор правит названия, порядок, обязательность и выводит значение из оборота.
    await pool.query(
      `update dictionary_entry_translation set name = 'ТОО (исправлено)'
       where language = 'ru' and dictionary_entry_id = (select id from dictionary_entry where code = 'LLP')`,
    );
    await pool.query(`update dictionary_entry set mandatory = false, sort_order = 9 where code = 'ISO 9001'`);
    await pool.query(`update dictionary_entry set retired_at = now() where code = 'ATEX'`);
    await pool.query(`update dictionary_entry set mandatory = true where code = 'financial_statements'`);
    const adjusted = {
      llp: (await entries('legal_form')).find((e) => e.code === 'LLP')!,
      certificates: await entries('certificate_type'),
      documents: await entries('document_type'),
    };

    const second = await loadReferenceDirectory(db, RELEASE, 'release');
    expect(second.every((r) => r.inserted === 0 && r.translationsAdded === 0)).toBe(true);
    // Ни одной новой строки, ни одной записи аудита.
    expect(await counts()).toEqual(first);
    expect({
      llp: (await entries('legal_form')).find((e) => e.code === 'LLP')!,
      certificates: await entries('certificate_type'),
      documents: await entries('document_type'),
    }).toEqual(adjusted);
    expect(adjusted.llp.names!.ru).toBe('ТОО (исправлено)');

    // Недостающий перевод возвращается из файла; существующие названия и поля значения не меняются.
    await pool.query(
      `delete from dictionary_entry_translation
       where language = 'en' and dictionary_entry_id = (select id from dictionary_entry where code = 'LLC')`,
    );
    const third = await loadReferenceDirectory(db, RELEASE, 'release');
    expect(third.find((r) => r.dictionary === 'legal_form')).toEqual({
      dictionary: 'legal_form',
      inserted: 0,
      translationsAdded: 1,
      skippedDeleted: 0,
    });
    expect(third.filter((r) => r.dictionary !== 'legal_form').every((r) => r.translationsAdded === 0)).toBe(true);
    const llc = (await entries('legal_form')).find((e) => e.code === 'LLC')!;
    expect(llc.names).toEqual({
      kk: 'Жауапкершілігі шектеулі қоғам (ЖШҚ)',
      ru: 'Общество с ограниченной ответственностью (ООО)',
      en: 'Limited liability company (LLC)',
    });
    expect((await entries('legal_form')).find((e) => e.code === 'LLP')).toEqual(adjusted.llp);
    expect(await entries('certificate_type')).toEqual(adjusted.certificates);
    expect(await counts()).toEqual({ ...first, audit: 6 });
  });

  it('значение release, удалённое администратором, выкат не возвращает: ISO 45001 снят с обязательных и удалён — загрузка его пропускает, счётчик пропущенных 1, аудита reference.loaded нет (ADM-08, DATA-04)', async () => {
    await loadReferenceDirectory(db, RELEASE, 'release');
    const admin = await administrator();
    const service = dictionaries();
    const iso = await entryId('certificate_type', 'ISO 45001');
    await service.setMandatory(admin, 'certificate_type', iso, false);
    await service.remove(admin, 'certificate_type', iso);
    const before = await counts();

    const results = await loadReferenceDirectory(db, RELEASE, 'release');
    expect(results.find((r) => r.dictionary === 'certificate_type')).toEqual({
      dictionary: 'certificate_type',
      inserted: 0,
      translationsAdded: 0,
      skippedDeleted: 1,
    });
    expect(results.filter((r) => r.dictionary !== 'certificate_type').every((r) => r.skippedDeleted === 0)).toBe(true);
    expect((await entries('certificate_type')).map((e) => e.code)).not.toContain('ISO 45001');
    // Ни строки, ни перевода, ни записи reference.loaded: пропущенное в аудит загрузки не попадает.
    expect(await counts()).toEqual(before);
    expect(referenceLoadSummary(results.find((r) => r.dictionary === 'certificate_type')!)).toBe(
      'certificate_type +0 (+0 переводов), пропущено удалённых: 1',
    );

    // Код в файле в другом регистре — тот же код (уникальность без учёта регистра): тоже пропускается.
    const lower = await loadReferenceFile(
      db,
      fixture(
        'certificate_type',
        [{ code: 'iso 45001', names: { en: 'ISO 45001' }, mandatory: true }],
        'specification',
      ),
      'release',
    );
    expect(lower).toEqual({ dictionary: 'certificate_type', inserted: 0, translationsAdded: 0, skippedDeleted: 1 });
    expect(await counts()).toEqual(before);
  });

  it('удалить и создать заново с тем же кодом: загрузка строку администратора не меняет — ни полей, ни переводов (ADM-08, DATA-04)', async () => {
    await loadReferenceDirectory(db, RELEASE, 'release');
    const admin = await administrator();
    const service = dictionaries();
    await service.remove(admin, 'legal_form', await entryId('legal_form', 'LLC'));
    await service.create(admin, 'legal_form', {
      code: 'LLC',
      parentCode: null,
      names: { kk: 'ЖШҚ (жаңа)', ru: 'ООО (заново)', en: 'LLC (again)' },
    });
    // Перевода на английский у новой строки нет (правка в обход формы): загрузка его из файла не добавляет.
    await pool.query(
      `delete from dictionary_entry_translation
       where language = 'en' and dictionary_entry_id = (select id from dictionary_entry where code = 'LLC')`,
    );
    const recreated = (await entries('legal_form')).find((e) => e.code === 'LLC')!;
    const before = await counts();

    const results = await loadReferenceDirectory(db, RELEASE, 'release');
    expect(results.find((r) => r.dictionary === 'legal_form')).toEqual({
      dictionary: 'legal_form',
      inserted: 0,
      translationsAdded: 0,
      skippedDeleted: 1,
    });
    expect((await entries('legal_form')).find((e) => e.code === 'LLC')).toEqual(recreated);
    expect(recreated.names).toEqual({ kk: 'ЖШҚ (жаңа)', ru: 'ООО (заново)' });
    expect(await counts()).toEqual(before);
  });

  it('удаление в одном справочнике не мешает загрузке того же кода в другом: удалённый process/X-1 пропускается, equipment_type/X-1 загружается (ADM-08)', async () => {
    const admin = await administrator();
    const service = dictionaries();
    const names = { kk: 'X-1 (kk)', ru: 'X-1 (ru)', en: 'X-1 (en)' };
    const created = await service.create(admin, 'process', { code: 'X-1', parentCode: null, names });
    await service.remove(admin, 'process', created.entry.id);

    expect(
      await loadReferenceFile(
        db,
        fixture('equipment_type', [{ code: 'X-1', names: { ru: 'Оборудование X-1' } }]),
        'provisional',
      ),
    ).toEqual({ dictionary: 'equipment_type', inserted: 1, translationsAdded: 1, skippedDeleted: 0 });
    expect(
      await loadReferenceFile(
        db,
        fixture('process', [
          { code: 'x-1', names: { ru: 'Процесс x-1' } },
          { code: 'welding', names: { ru: 'Сварка' } },
        ]),
        'provisional',
      ),
    ).toEqual({ dictionary: 'process', inserted: 1, translationsAdded: 1, skippedDeleted: 1 });
    expect((await entries('process')).map((e) => e.code)).toEqual(['welding']);
    expect((await entries('equipment_type')).map((e) => e.code)).toEqual(['X-1']);
  });

  it('ведущие нули: 0101210000 и 01110 сохраняются текстом и возвращаются как есть (DATA-03)', async () => {
    await loadReferenceFile(
      db,
      fixture('tn_ved', [
        { code: '0101210000', names: { ru: 'Лошади чистопородные племенные' } },
        { code: '7308909809', names: { ru: 'Конструкции из чёрных металлов прочие' } },
      ]),
      'provisional',
    );
    await loadReferenceFile(
      db,
      fixture('oked', [{ code: '01110', names: { ru: 'Выращивание зерновых' } }]),
      'provisional',
    );

    const stored = await pool.query<{ dictionary: string; code: string; type: string; length: number }>(
      `select d.code as dictionary, e.code, pg_typeof(e.code)::text as type, length(e.code) as length
       from dictionary_entry e join dictionary d on d.id = e.dictionary_id order by d.code, e.code`,
    );
    expect(stored.rows).toEqual([
      { dictionary: 'oked', code: '01110', type: 'text', length: 5 },
      { dictionary: 'tn_ved', code: '0101210000', type: 'text', length: 10 },
      { dictionary: 'tn_ved', code: '7308909809', type: 'text', length: 10 },
    ]);
    // Поиск по значению с ведущим нулём находит значение, а число 101210000 — нет.
    const found = await pool.query(`select 1 from dictionary_entry where lower(code) = '0101210000'`);
    expect(found.rowCount).toBe(1);
  });

  it('код не по шаблону, повтор кода другим регистром, mandatory у региона, неизвестный parent — ReferenceFileError, ни одной строки из файла', async () => {
    const good = { code: 'KZ-AKT', names: { ru: 'Актюбинская область' } };
    const bad: [string, ReferenceFile][] = [
      [
        'код не по шаблону',
        fixture('tn_ved', [
          { code: '0101210000', names: { ru: 'x' } },
          { code: 'SECRET-1', names: { ru: 'x' } },
        ]),
      ],
      [
        'код ТН ВЭД без ведущего нуля',
        fixture('tn_ved', [
          { code: '0101210000', names: { ru: 'x' } },
          { code: '101210000', names: { ru: 'x' } },
        ]),
      ],
      ['повтор кода другим регистром', fixture('region', [good, { code: 'kz-akt', names: { ru: 'Другая' } }])],
      ['mandatory у региона', fixture('region', [good, { code: 'KZ-ALA', names: { ru: 'Алматы' }, mandatory: false }])],
      [
        'customNameAllowed вне certificate_type',
        fixture('document_type', [good, { code: 'other', names: { ru: 'x' }, customNameAllowed: true }]),
      ],
      [
        'parent вне DICTIONARY_PARENT',
        fixture('region', [good, { code: 'KZ-ALA', names: { ru: 'Алматы' }, parent: 'A' }]),
      ],
      ['неизвестный parent', fixture('commodity_type', [{ code: 'pumps', names: { en: 'Pumps' }, parent: 'Z' }])],
    ];
    await loadReferenceDirectory(db, RELEASE, 'release');
    const before = await counts();

    for (const [name, file] of bad) {
      const error = await loadReferenceFile(db, file, 'provisional').then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, name).toBeInstanceOf(ReferenceFileError);
      // Сообщение называет файл и правило, но не значения из файла.
      expect((error as Error).message, name).toContain(`${file.dictionary}.json`);
      expect((error as Error).message, name).not.toContain('SECRET-1');
      // Файл не загружен целиком: нет и первой, допустимой строки.
      expect(await counts(), name).toEqual(before);
    }
    expect(await entries('region')).toEqual([]);
    expect(await entries('tn_ved')).toEqual([]);

    // Отсутствие справочника — понятная ошибка, а не вставка строки dictionary (у роли приложения нет INSERT).
    await pool.query('delete from dictionary where code = $1', ['process']);
    await expect(
      loadReferenceFile(db, fixture('process', [{ code: 'welding', names: { ru: 'Сварка' } }]), 'provisional'),
    ).rejects.toBeInstanceOf(ReferenceFileError);
    const left = await pool.query("select 1 from dictionary where code = 'process'");
    expect(left.rowCount).toBe(0);
  });

  it('названия — строки dictionary_entry_translation по языку, не одна строка с разделителем (DATA-02)', async () => {
    await loadReferenceFile(
      db,
      fixture(
        'commodity_group',
        [{ code: 'A', names: { kk: 'A тобы', ru: 'Группа A', en: 'Group A' } }],
        'specification',
      ),
      'release',
    );
    await loadReferenceFile(
      db,
      fixture('region', [{ code: 'KZ-ATY', names: { ru: 'Атырауская область' } }]),
      'provisional',
    );

    const rows = await pool.query<{ code: string; language: string; name: string }>(
      `select e.code, t.language, t.name from dictionary_entry_translation t
       join dictionary_entry e on e.id = t.dictionary_entry_id order by e.code, t.language::text`,
    );
    expect(rows.rows).toEqual([
      { code: 'A', language: 'en', name: 'Group A' },
      { code: 'A', language: 'kk', name: 'A тобы' },
      { code: 'A', language: 'ru', name: 'Группа A' },
      // Нет названия на языке — нет и строки: пустых и придуманных переводов не бывает.
      { code: 'KZ-ATY', language: 'ru', name: 'Атырауская область' },
    ]);
    expect(rows.rows.some((r) => /[|;]/.test(r.name))).toBe(false);
  });

  it('parent: тип товара фикстуры указывает на значение commodity_group B', async () => {
    // Порядок файлов в каталоге не важен: группы загружаются раньше типов товаров.
    const dir = directoryWith({
      '1-types.json': {
        dictionary: 'commodity_type',
        status: 'provisional',
        source: 'тест',
        entries: [
          { code: 'valves', parent: 'B', names: { en: 'Valves' } },
          { code: 'cables', parent: 'b', names: { en: 'Cables' } },
          { code: 'workwear', names: { en: 'Workwear' } },
        ],
      },
    });
    await loadReferenceDirectory(db, RELEASE, 'release');
    await loadReferenceDirectory(db, dir, 'provisional');

    expect((await entries('commodity_type')).map((e) => [e.code, e.parent])).toEqual([
      ['cables', 'B'],
      ['valves', 'B'],
      ['workwear', null],
    ]);
    const link = await pool.query<{ same: boolean }>(
      `select p.id = (select e.id from dictionary_entry e join dictionary d on d.id = e.dictionary_id
                      where d.code = 'commodity_group' and e.code = 'B') as same
       from dictionary_entry v join dictionary_entry p on p.id = v.parent_entry_id where v.code = 'valves'`,
    );
    expect(link.rows).toEqual([{ same: true }]);

    // Группа и её тип в одном каталоге: файл типов лежит первым по имени, но группы загружены раньше.
    await resetDatabase(pool);
    await migrateThrough(pool);
    const both = directoryWith({
      'a-types.json': {
        dictionary: 'commodity_type',
        status: 'provisional',
        source: 'тест',
        entries: [{ code: 'pumps', parent: 'E', names: { en: 'Pumps' } }],
      },
      'b-groups.json': {
        dictionary: 'commodity_group',
        status: 'provisional',
        source: 'тест',
        entries: [{ code: 'E', names: { ru: 'Группа E' } }],
      },
    });
    expect((await loadReferenceDirectory(db, both, 'provisional')).map((r) => r.dictionary)).toEqual([
      'commodity_group',
      'commodity_type',
    ]);
    expect((await entries('commodity_type')).map((e) => [e.code, e.parent])).toEqual([['pumps', 'E']]);

    // Группы нет ни в базе, ни в каталоге: родитель не найден, тип не загружен.
    await resetDatabase(pool);
    await migrateThrough(pool);
    await expect(
      loadReferenceDirectory(
        db,
        directoryWith({
          'types.json': {
            dictionary: 'commodity_type',
            status: 'provisional',
            source: 'тест',
            entries: [{ code: 'pumps', parent: 'E', names: { en: 'Pumps' } }],
          },
        }),
        'provisional',
      ),
    ).rejects.toBeInstanceOf(ReferenceFileError);
    expect(await counts()).toEqual({ entries: 0, translations: 0, audit: 0 });
  });

  it('коды закрытых справочников = enum_range(null::commodity_group) и enum_range(null::contact_role)', async () => {
    await loadReferenceDirectory(db, RELEASE, 'release');
    const range = async (type: string) =>
      (await pool.query<{ v: string }>(`select unnest(enum_range(null::${type}))::text as v`)).rows.map((r) => r.v);

    expect((await entries('commodity_group')).map((e) => e.code).sort()).toEqual(
      (await range('commodity_group')).sort(),
    );
    expect((await entries('contact_role')).map((e) => e.code).sort()).toEqual((await range('contact_role')).sort());
    expect(await range('commodity_group')).toEqual([...COMMODITY_GROUPS]);
    expect(await range('contact_role')).toEqual([...CONTACT_ROLES]);
  });

  it('provisional в release — ReferenceFileError; release в provisional — тоже', async () => {
    // Файлы репозитория: каталог release несёт release, provisional — provisional.
    await expect(loadReferenceDirectory(db, PROVISIONAL, 'release')).rejects.toBeInstanceOf(ReferenceFileError);
    await expect(loadReferenceDirectory(db, RELEASE, 'provisional')).rejects.toBeInstanceOf(ReferenceFileError);
    expect(await counts()).toEqual({ entries: 0, translations: 0, audit: 0 });

    // Статусы specification и imbc годятся для release, imbc — не для provisional.
    for (const status of ['specification', 'imbc'] as const) {
      const entry = { code: `p-${status}`, names: { ru: 'Сварка' } };
      await expect(loadReferenceFile(db, fixture('process', [entry], status), 'release')).resolves.toMatchObject({
        inserted: 1,
      });
      await expect(loadReferenceFile(db, fixture('process', [entry], status), 'provisional')).rejects.toBeInstanceOf(
        ReferenceFileError,
      );
    }
    await expect(
      loadReferenceFile(
        db,
        fixture('equipment_type', [{ code: 'lifting', names: { ru: 'Грузоподъёмное' } }]),
        'release',
      ),
    ).rejects.toBeInstanceOf(ReferenceFileError);

    // Ошибка проверки файла (без базы) не оставляет частичной загрузки: допустимый файл перед недопустимым не загружен.
    await resetDatabase(pool);
    await migrateThrough(pool);
    const dir = directoryWith({
      'a-region.json': {
        dictionary: 'region',
        status: 'provisional',
        source: 'тест',
        entries: [{ code: 'KZ-ATY', names: { ru: 'Атырау' } }],
      },
      'b-process.json': {
        dictionary: 'process',
        status: 'specification',
        source: 'тест',
        entries: [{ code: 'welding', names: { ru: 'Сварка' } }],
      },
    });
    await expect(loadReferenceDirectory(db, dir, 'provisional')).rejects.toBeInstanceOf(ReferenceFileError);
    expect(await counts()).toEqual({ entries: 0, translations: 0, audit: 0 });
  });

  it('ошибки чтения файла: не JSON и не по схеме — ReferenceFileError с именем файла, без значений', async () => {
    const notJson = directoryWith({ 'oked.json': '{ "dictionary": ' });
    const error = await loadReferenceDirectory(db, notJson, 'provisional').then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ReferenceFileError);
    expect((error as Error).message).toContain('oked.json');

    // Код — число: ведущие нули потеряны до загрузчика, файл отклоняется целиком.
    const numeric = directoryWith({
      'tn_ved.json': {
        dictionary: 'tn_ved',
        status: 'provisional',
        source: 'тест',
        entries: [{ code: 101210000, names: { ru: 'x' } }],
      },
    });
    const numericError = await loadReferenceDirectory(db, numeric, 'provisional').then(
      () => null,
      (e: unknown) => e,
    );
    expect(numericError).toBeInstanceOf(ReferenceFileError);
    expect((numericError as Error).message).toContain('tn_ved.json');
    expect((numericError as Error).message).not.toContain('101210000');
    // Прочие файлы каталога (не *.json) пропускаются.
    const other = directoryWith({
      'README.md': 'не справочник',
      'process.json': {
        dictionary: 'process',
        status: 'provisional',
        source: 'тест',
        entries: [{ code: 'welding', names: { ru: 'Сварка' } }],
      },
    });
    expect(await loadReferenceDirectory(db, other, 'provisional')).toEqual([
      { dictionary: 'process', inserted: 1, translationsAdded: 1, skippedDeleted: 0 },
    ]);
  });

  it('аудит reference.loaded только когда что-то добавлено', async () => {
    const file = fixture('process', [
      { code: 'welding', names: { kk: 'Дәнекерлеу', ru: 'Сварка' } },
      { code: 'painting', names: { ru: 'Покраска' } },
    ]);
    expect(await loadReferenceFile(db, file, 'provisional')).toEqual({
      dictionary: 'process',
      inserted: 2,
      translationsAdded: 3,
      skippedDeleted: 0,
    });
    // Загрузчик — система: без исполнителя, организации и IP; не событие аккаунта.
    expect(await audit()).toEqual([
      {
        action: 'reference.loaded',
        object_type: 'dictionary',
        object_id: 'process',
        outcome: 'ok',
        diff: { inserted: 2, translationsAdded: 3 },
        is_account_event: false,
        user_id: null,
        organization_id: null,
        ip: null,
      },
    ]);

    // Повтор без изменений записи не создаёт.
    expect(await loadReferenceFile(db, file, 'provisional')).toEqual({
      dictionary: 'process',
      inserted: 0,
      translationsAdded: 0,
      skippedDeleted: 0,
    });
    expect(await audit()).toHaveLength(1);

    // Добавлен только перевод — запись есть; в diff — число добавленного.
    await pool.query(`delete from dictionary_entry_translation where language = 'kk'`);
    expect(await loadReferenceFile(db, file, 'provisional')).toEqual({
      dictionary: 'process',
      inserted: 0,
      translationsAdded: 1,
      skippedDeleted: 0,
    });
    expect((await audit()).map((a) => a.diff)).toEqual([
      { inserted: 2, translationsAdded: 3 },
      { inserted: 0, translationsAdded: 1 },
    ]);
  });

  it('значения порциями: 2500 значений за один файл, повтор ничего не добавляет', async () => {
    const many = fixture(
      'tn_ved',
      Array.from({ length: 2500 }, (_, i) => ({
        code: String(i).padStart(10, '0'),
        names: { ru: `Позиция ${i}`, en: `Item ${i}` },
      })),
    );
    expect(await loadReferenceFile(db, many, 'provisional')).toEqual({
      dictionary: 'tn_ved',
      inserted: 2500,
      translationsAdded: 5000,
      skippedDeleted: 0,
    });
    expect(await loadReferenceFile(db, many, 'provisional')).toEqual({
      dictionary: 'tn_ved',
      inserted: 0,
      translationsAdded: 0,
      skippedDeleted: 0,
    });
    const first = await pool.query(`select 1 from dictionary_entry where code = '0000000000'`);
    expect(first.rowCount).toBe(1);
  });

  it('загрузка идёт под ролью приложения: пишет только dictionary_entry, переводы и аудит (у роли нет INSERT на dictionary)', async () => {
    const ROLE = 'imbc_reference_loader_test';
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
    let roleDb: pg.Pool | undefined;
    try {
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
      await applyAppRoleGrants(pool, ROLE);
      // Соединения этого пула выполняют SET ROLE при подключении: все запросы — от имени роли приложения.
      roleDb = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2, options: `-c role=${ROLE}` });
      const asApp = drizzle(roleDb, { schema, casing: 'snake_case' });
      await expect(roleDb.query("insert into dictionary (code, name) values ('x', 'x')")).rejects.toThrow(
        /permission denied/,
      );

      const results = await loadReferenceDirectory(asApp, RELEASE, 'release');
      expect(results.reduce((sum, r) => sum + r.inserted, 0)).toBe(25);
      expect(await counts()).toEqual({ entries: 25, translations: 75, audit: 5 });
      // Повтор под той же ролью.
      expect((await loadReferenceDirectory(asApp, RELEASE, 'release')).every((r) => r.inserted === 0)).toBe(true);

      // Удаление администратором и следующая загрузка — тоже от роли приложения: удалённые коды загрузчик читает
      // из audit_entries (у роли приложения на журнал SELECT и INSERT).
      const service = dictionaries(asApp, roleDb);
      await service.remove(await administrator(), 'legal_form', await entryId('legal_form', 'JSC'));
      const after = await loadReferenceDirectory(asApp, RELEASE, 'release');
      expect(after.find((r) => r.dictionary === 'legal_form')).toEqual({
        dictionary: 'legal_form',
        inserted: 0,
        translationsAdded: 0,
        skippedDeleted: 1,
      });
      expect((await entries('legal_form')).map((e) => e.code).sort()).toEqual(['LLC', 'LLP']);
    } finally {
      await roleDb?.end();
      await dropRole();
    }
  });
});

// Файлы лежат в репозитории и едут в образе ("files" в package.json): проверка не требует базы.
describe('файлы справочников в репозитории', () => {
  it('файлы репозитория: схема, источник, статус и состав; коды — строки (ADM-08, DATA-03)', () => {
    const statuses = { release: ['specification', 'imbc'], provisional: ['provisional'] } as const;
    const found = new Map<string, number>();
    for (const [dir, allowed] of Object.entries(statuses))
      for (const name of readdirSync(join(REFERENCE_DATA_DIR, dir)).filter((n) => n.endsWith('.json'))) {
        const parsed = referenceFileSchema.parse(JSON.parse(readFileSync(join(REFERENCE_DATA_DIR, dir, name), 'utf8')));
        expect(allowed as readonly string[], `${dir}/${name}`).toContain(parsed.status);
        expect(name, `${dir}/${name}`).toBe(`${parsed.dictionary}.json`);
        expect(parsed.source.length, `${dir}/${name}`).toBeGreaterThan(0);
        found.set(`${dir}/${parsed.dictionary}`, parsed.entries.length);
        // DATA-03: код — строка в самом файле, а не число, у которого ведущие нули уже потеряны.
        const raw = JSON.parse(readFileSync(join(REFERENCE_DATA_DIR, dir, name), 'utf8')) as {
          entries: { code: unknown }[];
        };
        for (const entry of raw.entries) expect(typeof entry.code, `${dir}/${name}`).toBe('string');
      }
    expect(Object.fromEntries(found)).toEqual({
      'release/legal_form': 3,
      'release/commodity_group': 5,
      'release/contact_role': 3,
      'release/certificate_type': 10,
      'release/document_type': 4,
      'provisional/region': 9,
      'provisional/oked': 4,
      'provisional/tn_ved': 4,
      'provisional/kpved': 2,
      'provisional/commodity_type': 5,
      'provisional/process': 3,
      'provisional/equipment_type': 2,
    });
    // Каждый справочник — не более чем в одном файле; все двенадцать — не обязаны быть (ждут перечня IMBC).
    const dictionaries = [...found.keys()].map((k) => k.split('/')[1]);
    expect(new Set(dictionaries).size).toBe(dictionaries.length);
    for (const code of dictionaries) expect(DICTIONARY_CODES as readonly string[]).toContain(code);
  });

  it('строка журнала migrate и seed: добавлено, переводы и пропущенные удалённые', () => {
    expect(
      referenceLoadSummary({ dictionary: 'legal_form', inserted: 3, translationsAdded: 9, skippedDeleted: 0 }),
    ).toBe('legal_form +3 (+9 переводов), пропущено удалённых: 0');
  });
});
