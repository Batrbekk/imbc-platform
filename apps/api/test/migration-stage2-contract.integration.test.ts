import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILE_SCAN_STATES } from '@imbc/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../src/database/schema/index.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const DATA = '0010_stage2_reference_data';
const CONTRACT = '0011_stage2_contract';
const migrationText = (tag: string) => readFileSync(join(MIGRATIONS, `${tag}.sql`), 'utf8');
const statements = (tag: string) =>
  migrationText(tag)
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
const journalTags = () =>
  (
    JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  ).entries.map((e) => e.tag);
/** Число миграций до `tag` включительно — столько строк в журнале базы после неё. */
const journalThrough = (tag: string) => journalTags().indexOf(tag) + 1;

const SKELETON_TABLES = ['notifications_sent', 'dictionaries', 'dictionary_entries', 'file_objects', 'file_versions'];

/**
 * Девять колонок скелета, чьи внешние ключи 0011 переводит со скелетных file_objects / file_versions на таблицы
 * DBML; имена — те, что строит Drizzle (`<таблица>_<колонка>_<таблица ссылки>_<колонка ссылки>_fk`).
 */
const MOVED_KEYS = [
  ['certificates', 'certificates_file_id_file_object_id_fk', 'file_object'],
  ['documents', 'documents_file_id_file_object_id_fk', 'file_object'],
  ['due_diligence_records', 'due_diligence_records_enhanced_report_file_id_file_object_id_fk', 'file_object'],
  ['due_diligence_records', 'due_diligence_records_report_file_id_file_object_id_fk', 'file_object'],
  ['forecast_versions', 'forecast_versions_source_file_id_file_object_id_fk', 'file_object'],
  ['operator_visit_marks', 'operator_visit_marks_file_id_file_object_id_fk', 'file_object'],
  ['review_decisions', 'review_decisions_file_version_id_file_version_id_fk', 'file_version'],
  ['site_survey_records', 'site_survey_records_report_file_id_file_object_id_fk', 'file_object'],
  ['tech_spec_files', 'tech_spec_files_file_id_file_object_id_fk', 'file_object'],
] as const;

/** Те же ключи до 0011 — как их хранит PostgreSQL (имя длиннее 63 байт усечено). */
const OLD_KEYS = [
  ['certificates', 'certificates_file_id_file_objects_id_fk'],
  ['documents', 'documents_file_id_file_objects_id_fk'],
  ['due_diligence_records', 'due_diligence_records_enhanced_report_file_id_file_objects_id_f'],
  ['due_diligence_records', 'due_diligence_records_report_file_id_file_objects_id_fk'],
  ['forecast_versions', 'forecast_versions_source_file_id_file_objects_id_fk'],
  ['operator_visit_marks', 'operator_visit_marks_file_id_file_objects_id_fk'],
  ['review_decisions', 'review_decisions_file_version_id_file_versions_id_fk'],
  ['site_survey_records', 'site_survey_records_report_file_id_file_objects_id_fk'],
  ['tech_spec_files', 'tech_spec_files_file_id_file_objects_id_fk'],
] as const;

// Contract этапа 2 (NFR-06): 0011 удаляет то, что этап 2 оставил для совместимости с этапом 1, — журнал писем
// notifications_sent (NOT-18), скелетные справочники и файлы, скелетный тип scan_state, — и даёт типу состояния
// скана имя DBML (DATA-07). Сначала блокировка удаляемых таблиц, повторный перенос писем и проверка: строка в
// удаляемых таблицах останавливает миграцию до фиксации любой правки (мигратор применяет пачку одной транзакцией).
describe('0011: текст миграции', () => {
  it('первый оператор — исключительная блокировка пяти удаляемых таблиц; второй — тот же перенос notifications_sent → notification, что третий оператор 0010; третий — блок проверки с RAISE EXCEPTION; правки схемы — только после них', () => {
    const body = statements(CONTRACT);
    expect(body[0]).toBe(
      'LOCK TABLE "notifications_sent", "dictionary_entries", "dictionaries", "file_versions", "file_objects" IN ACCESS EXCLUSIVE MODE;',
    );
    expect(body[1]).toBe(statements(DATA)[2]);
    expect(body[2]).toMatch(/^DO \$\$/);
    expect(body[2]).toContain("RAISE EXCEPTION 'stage 2 contract: % notifications_sent rows not in notification'");
    expect(body[2]).toContain(
      'skeleton tables dictionaries, dictionary_entries, file_objects, file_versions are not empty',
    );
    for (const statement of body.slice(0, 3)) expect(statement).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE)\b/);
    for (const statement of body.slice(3))
      expect(statement).toMatch(
        /^(ALTER TABLE "\w+" (DROP|ADD) CONSTRAINT "\w+"|DROP TABLE "notifications_sent", "dictionary_entries", "dictionaries", "file_versions", "file_objects";$|DROP TYPE "public"\."scan_state";$|ALTER TYPE "public"\."file_scan_state" RENAME TO "scan_state";$|ALTER TABLE "org_chart_sample" ALTER COLUMN "is_current" SET DEFAULT false;?$)/,
      );
  });

  it('без CASCADE, DELETE, UPDATE и TRUNCATE: удаляется только перечисленное, зависимость, о которой миграция не знает, останавливает её', () => {
    const text = statements(CONTRACT).join('\n');
    expect(text).not.toMatch(/\bCASCADE\b/i);
    // Действия внешнего ключа (ON DELETE / ON UPDATE no action) — не операторы.
    expect(text.replace(/ ON (DELETE|UPDATE) no action/g, '')).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE)\b/);
    // Девять ключей: прежний снимается по имени, под которым он хранится в базе, новый ставится.
    for (const [table, name] of MOVED_KEYS)
      expect(text).toContain(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY`);
    for (const [table, name] of OLD_KEYS) expect(text).toContain(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}";`);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('contract этапа 2: миграция 0011', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;

  beforeAll(() => {
    pool = openTestPool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  const journal = async () =>
    (await pool.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0]!.n;
  const exists = async (name: string) =>
    (await pool.query<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${name}`])).rows[0]!.t !==
    null;
  const typeExists = async (name: string) =>
    (await pool.query<{ t: string | null }>('select to_regtype($1)::text as t', [`public.${name}`])).rows[0]!.t !==
    null;
  const enumRange = async (type: string) =>
    (await pool.query<{ v: string[] }>(`select enum_range(null::${type})::text[] as v`)).rows[0]!.v;
  /** Строки таблицы целиком (jsonb), по id. */
  const rows = async (table: string) =>
    (
      await pool.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from ${table} t order by id`)
    ).rows.map((r) => r.row);
  /** Отказ блока проверки 0011: Drizzle оборачивает ошибку PostgreSQL (RAISE EXCEPTION — P0001) в cause. */
  const contractRefusal = (message: RegExp) => ({
    cause: expect.objectContaining({ code: 'P0001', message: expect.stringMatching(message) }),
  });

  async function organization(type: 'manufacturer' | 'operator', bin: string | null = null) {
    return (
      await pool.query<{ id: string }>('insert into organizations (type, name, bin) values ($1, $2, $3) returning id', [
        type,
        `Contract ${randomUUID()}`,
        bin,
      ])
    ).rows[0]!.id;
  }

  async function account(organizationId: string, email: string, role = 'manufacturer') {
    return (
      await pool.query<{ id: string }>(
        "insert into user_accounts (organization_id, email, role, idp_subject, locale) values ($1, $2, $3, $4, 'ru') returning id",
        [organizationId, email, role, randomUUID()],
      )
    ).rows[0]!.id;
  }

  /** Письмо, записанное прежней версией в notifications_sent (её колонки). */
  const legacyLetter = (dedupeKey: string, recipient: string) =>
    pool.query<{ sent_at: Date }>(
      "insert into notifications_sent (code, dedupe_key, recipient, locale) values ('NOT-03', $1, $2, 'ru') returning sent_at",
      [dedupeKey, recipient],
    );

  describe('база 0010 с данными этапа 2 и письмом прежней версии', () => {
    let lockedAccount: string;
    let legacySentAt: Date;
    const before: Record<string, Record<string, unknown>[]> = {};
    const KEPT = ['file_object', 'file_version', 'org_chart_sample', 'dictionary_entry', 'notification'];

    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool, DATA);
      const maker = await organization('manufacturer', '240100000701');
      lockedAccount = await account(maker, 'locked@stage3.local');
      const admin = await account(
        (await pool.query<{ id: string }>("select id from organizations where type = 'imbc'")).rows[0]!.id,
        'admin-contract@imbc.local',
        'administrator',
      );
      // Данные этапа 2 в таблицах DBML: образец с версиями passed и rejected, файл производителя на проверке,
      // значение справочника, письмо журнала notification.
      const sample = (
        await pool.query<{ id: string }>(
          "insert into file_object (purpose, data_class) values ('organisation_chart_sample', 'e_administration') returning id",
        )
      ).rows[0]!.id;
      const makerFile = (
        await pool.query<{ id: string }>(
          "insert into file_object (organization_id, purpose, data_class) values ($1, 'certificate_file', 'b_manufacturer') returning id",
          [maker],
        )
      ).rows[0]!.id;
      const version = (fileObjectId: string, n: number, state: string | null) =>
        pool.query(
          `insert into file_version (file_object_id, version_number, original_name, byte_size, declared_media_type, checksum, storage_key, uploaded_by${state ? ', scan_state, scanned_at' : ''})
           values ($1, $2, 'sample.pdf', 1024, 'application/pdf', 'sha256', $3, $4${state ? ', $5, now()' : ''})`,
          state ? [fileObjectId, n, randomUUID(), admin, state] : [fileObjectId, n, randomUUID(), admin],
        );
      await version(sample, 1, 'passed');
      await version(sample, 2, 'rejected');
      await version(makerFile, 1, null);
      await pool.query(
        'insert into org_chart_sample (file_object_id, uploaded_by, uploaded_at, is_current) values ($1, $2, now(), true)',
        [sample, admin],
      );
      await pool.query(
        "insert into dictionary_entry (dictionary_id, code) select id, '01' from dictionary where code = 'region'",
      );
      await pool.query(
        "insert into notification (rule_code, recipient_email, user_account_id, language, dedup_key) values ('NOT-02', 'locked@stage3.local', $1, 'ru', $2)",
        [lockedAccount, 'NOT-02\notp-1\nlocked@stage3.local'],
      );
      for (const table of KEPT) before[table] = await rows(table);
      // Прежняя версия (этап 1) в окне выката этапа 2 записала письмо после 0010: перенос 0010 его не видел.
      legacySentAt = (await legacyLetter('sub-2:1700000000001', 'Locked@Stage3.local')).rows[0]!.sent_at;
      await migrateThrough(pool);
    }, 60000);

    it("0011 переносит письмо, записанное прежней версией после 0010: строка notifications_sent NOT-03 есть в notification с dedup_key 'NOT-03\\nsub-2:1700000000001\\nlocked@stage3.local' (NOT-18)", async () => {
      expect(await journal()).toBe(journalTags().length);
      const moved = await pool.query(
        'select rule_code, recipient_email, user_account_id, language, sent_at from notification where dedup_key = $1',
        ['NOT-03\nsub-2:1700000000001\nlocked@stage3.local'],
      );
      expect(moved.rows).toEqual([
        {
          rule_code: 'NOT-03',
          recipient_email: 'Locked@Stage3.local',
          user_account_id: lockedAccount,
          language: 'ru',
          sent_at: legacySentAt,
        },
      ]);
      expect(await exists('notifications_sent')).toBe(false);
    });

    it('данные этапа 2 целы: file_object, file_version (passed, rejected, pending), текущий образец, значение справочника и письма журнала — те же строки; scan_state — те же значения (DATA-07)', async () => {
      for (const table of KEPT.filter((t) => t !== 'notification'))
        expect(await rows(table), table).toEqual(before[table]);
      // В журнале — прежние строки и одна перенесённая.
      const letters = await rows('notification');
      expect(letters).toHaveLength(before.notification!.length + 1);
      expect(letters).toEqual(expect.arrayContaining(before.notification!));
      // Порядок — порядок значений типа (pending, passed, rejected), как в FILE_SCAN_STATES.
      const states = await pool.query<{ state: string }>(
        'select scan_state::text as state from file_version order by scan_state',
      );
      expect(states.rows.map((r) => r.state)).toEqual([...FILE_SCAN_STATES]);
    });

    it('схема Drizzle этой версии читает и пишет заполненную базу после 0011: версия файла без scan_state — pending, образец без is_current — не текущий', async () => {
      const db = drizzle(pool, { schema, casing: 'snake_case' });
      const versions = await db.select({ scanState: schema.fileVersion.scanState }).from(schema.fileVersion);
      expect(versions.map((v) => v.scanState).sort()).toEqual(['passed', 'pending', 'rejected']);
      const [file] = await db
        .insert(schema.fileObject)
        .values({ purpose: 'organisation_chart_sample', dataClass: 'e_administration' })
        .returning();
      const [created] = await db
        .insert(schema.fileVersion)
        .values({
          fileObjectId: file!.id,
          versionNumber: 1,
          originalName: 'next.pdf',
          byteSize: 10,
          declaredMediaType: 'application/pdf',
          checksum: 'sha256',
          storageKey: randomUUID(),
        })
        .returning();
      expect(created!.scanState).toBe('pending');
      const [admin] = await db
        .select({ id: schema.userAccounts.id })
        .from(schema.userAccounts)
        .where(eq(schema.userAccounts.role, 'administrator'));
      const [sample] = await db
        .insert(schema.orgChartSample)
        .values({ fileObjectId: file!.id, uploadedBy: admin!.id, uploadedAt: new Date() })
        .returning();
      expect(sample!.isCurrent).toBe(false);
      // Ждущие скана находит частичный индекс по scan_state = 'pending' (повторная постановка в очередь).
      const index = await pool.query<{ def: string }>(
        "select pg_get_indexdef('file_version_pending_idx'::regclass) as def",
      );
      expect(index.rows[0]!.def).toContain("'pending'::scan_state");
    });

    it('повторный прогон мигратора ничего не делает: журнал и данные те же', async () => {
      const letters = await rows('notification');
      const n = await journal();
      await migrateThrough(pool);
      expect(await journal()).toBe(n);
      expect(await rows('notification')).toEqual(letters);
    });
  });

  describe('строка в удаляемой таблице — миграция останавливается, база остаётся как после 0010', () => {
    /** После отказа: 0011 не записана, удаляемые таблицы и оба типа на месте, перенос письма откатился. */
    async function expectUntouched() {
      expect(await journal()).toBe(journalThrough(DATA));
      for (const table of SKELETON_TABLES) expect(await exists(table), table).toBe(true);
      expect(await enumRange('scan_state')).toEqual(['pending', 'clean', 'infected', 'type_mismatch']);
      expect(await enumRange('file_scan_state')).toEqual([...FILE_SCAN_STATES]);
      const keys = await pool.query<{ conname: string }>(
        "select conname from pg_constraint where contype = 'f' and confrelid = 'file_object'::regclass and conrelid = 'certificates'::regclass",
      );
      expect(keys.rows).toEqual([]);
      const letters = await pool.query('select count(*)::int as n from notification where rule_code = $1', ['NOT-03']);
      expect(letters.rows).toEqual([{ n: 0 }]);
      const isCurrent = await pool.query<{ d: string }>(
        "select column_default as d from information_schema.columns where table_name = 'org_chart_sample' and column_name = 'is_current'",
      );
      expect(isCurrent.rows).toEqual([{ d: 'true' }]);
    }

    const skeletonRows: [string, string, () => Promise<unknown>][] = [
      [
        'dictionaries',
        'rows: 1, 0, 0, 0',
        () => pool.query("insert into dictionaries (code, title) values ('region', 'Regions')"),
      ],
      [
        'dictionary_entries',
        'rows: 0, 1, 0, 0',
        async () => {
          // Внешний ключ на dictionaries снят в тесте: строка только в dictionary_entries.
          await pool.query(
            'alter table dictionary_entries drop constraint dictionary_entries_dictionary_code_dictionaries_code_fk',
          );
          await pool.query(
            "insert into dictionary_entries (dictionary_code, code, label_kk, label_ru, label_en) values ('region', '01', 'kk', 'ru', 'en')",
          );
        },
      ],
      [
        'file_objects',
        'rows: 0, 0, 1, 0',
        async () =>
          pool.query("insert into file_objects (organization_id, data_class) values ($1, 'B')", [
            await organization('manufacturer', '240100000702'),
          ]),
      ],
      [
        'file_versions',
        'rows: 0, 0, 0, 1',
        async () => {
          // Внешний ключ на file_objects снят в тесте: строка только в file_versions.
          await pool.query('alter table file_versions drop constraint file_versions_file_id_file_objects_id_fk');
          await pool.query(
            `insert into file_versions (file_id, version, bucket, object_key, original_name, mime_type, size_bytes, sha256)
             values ($1, 1, 'imbc-files', $2, 'scan.pdf', 'application/pdf', 1024, 'abc')`,
            [randomUUID(), randomUUID()],
          );
        },
      ],
    ];

    it.each(skeletonRows)(
      "строка в %s — миграция падает с 'stage 2 contract', схема прежняя (таблицы на месте, 0011 не записана в журнал)",
      async (_table, counts, insert) => {
        await resetDatabase(pool);
        await migrateThrough(pool, DATA);
        // Письмо прежней версии: его перенос — первый оператор 0011, он откатывается вместе с отказом.
        await legacyLetter(`sub-3:${randomUUID()}`, 'late@stage3.local');
        await insert();
        await expect(migrateThrough(pool)).rejects.toMatchObject(
          contractRefusal(
            new RegExp(
              `^stage 2 contract: skeleton tables dictionaries, dictionary_entries, file_objects, file_versions are not empty \\(${counts}\\)$`,
            ),
          ),
        );
        await expectUntouched();
      },
    );

    it("перенос не записал письмо прежней версии (в тесте вставку в notification отбрасывает триггер) — миграция падает с 'stage 2 contract: 1 notifications_sent rows not in notification', notifications_sent цела", async () => {
      await resetDatabase(pool);
      await migrateThrough(pool, DATA);
      await legacyLetter(`sub-4:${randomUUID()}`, 'late@stage3.local');
      // Код вне правил 0010 не переносится и в проверку не входит.
      await pool.query(
        "insert into notifications_sent (code, dedupe_key, recipient, locale) values ('LEGACY-01', 'k-1', 'late@stage3.local', 'kk')",
      );
      await pool.query(
        'create function contract_test_skip() returns trigger language plpgsql as $$ begin return null; end $$',
      );
      await pool.query(
        'create trigger contract_test_skip before insert on notification for each row execute function contract_test_skip()',
      );
      await expect(migrateThrough(pool)).rejects.toMatchObject(
        contractRefusal(/^stage 2 contract: 1 notifications_sent rows not in notification$/),
      );
      await expectUntouched();
      expect((await pool.query('select count(*)::int as n from notifications_sent')).rows).toEqual([{ n: 2 }]);
    });

    it('строка прежней версии с кодом вне правил (не переносится и в проверку не входит) миграцию не останавливает: удаляется вместе с notifications_sent', async () => {
      await resetDatabase(pool);
      await migrateThrough(pool, DATA);
      await pool.query(
        "insert into notifications_sent (code, dedupe_key, recipient, locale) values ('LEGACY-01', 'k-1', 'late@stage3.local', 'kk')",
      );
      await migrateThrough(pool);
      expect(await journal()).toBe(journalTags().length);
      expect(await exists('notifications_sent')).toBe(false);
      expect((await pool.query('select count(*)::int as n from notification')).rows).toEqual([{ n: 0 }]);
    });

    it('сбой посреди правок схемы (последний из девяти прежних ключей переименован — DROP CONSTRAINT падает с 42704): восемь уже переведённых ключей, перенос письма и блокировка откатываются, база — как после 0010', async () => {
      await resetDatabase(pool);
      await migrateThrough(pool, DATA);
      await legacyLetter(`sub-5:${randomUUID()}`, 'late@stage3.local');
      await pool.query(
        'alter table tech_spec_files rename constraint tech_spec_files_file_id_file_objects_id_fk to tech_spec_files_file_id_renamed_fk',
      );
      await expect(migrateThrough(pool)).rejects.toMatchObject({ cause: expect.objectContaining({ code: '42704' }) });
      await expectUntouched();
      // Восемь пар DROP/ADD до сбоя не зафиксированы: прежние ключи на месте, новых нет.
      const names = async (list: readonly (readonly [string, string, ...string[]])[]) =>
        (
          await pool.query<{ conname: string }>(
            "select conname from pg_constraint where contype = 'f' and conname = any($1::text[])",
            [list.map(([, name]) => name)],
          )
        ).rows
          .map((r) => r.conname)
          .sort();
      expect(await names(OLD_KEYS)).toEqual(
        OLD_KEYS.map(([, name]) => name)
          .filter((name) => name !== 'tech_spec_files_file_id_file_objects_id_fk')
          .sort(),
      );
      expect(await names(MOVED_KEYS)).toEqual([]);
      expect((await pool.query('select count(*)::int as n from notifications_sent')).rows).toEqual([{ n: 1 }]);
    });
  });

  describe('чистая база после 0011', () => {
    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool);
    }, 60000);

    it('после 0011 нет notifications_sent, dictionaries, dictionary_entries, file_objects, file_versions и типа file_scan_state; enum_range(null::scan_state) = pending, passed, rejected; file_version.scan_state — тип scan_state (DATA-07)', async () => {
      for (const table of SKELETON_TABLES) expect(await exists(table), table).toBe(false);
      expect(await typeExists('file_scan_state')).toBe(false);
      expect(await enumRange('scan_state')).toEqual([...FILE_SCAN_STATES]);
      expect(FILE_SCAN_STATES).toEqual(['pending', 'passed', 'rejected']);
      const column = await pool.query(
        "select udt_name, column_default from information_schema.columns where table_name = 'file_version' and column_name = 'scan_state'",
      );
      expect(column.rows).toEqual([{ udt_name: 'scan_state', column_default: "'pending'::scan_state" }]);
      // Типом scan_state пользуется только file_version.scan_state.
      const users = await pool.query(
        "select table_name, column_name from information_schema.columns where udt_name = 'scan_state' and table_schema = 'public'",
      );
      expect(users.rows).toEqual([{ table_name: 'file_version', column_name: 'scan_state' }]);
      // Таблицы DBML этапа 2 на месте.
      for (const table of ['dictionary', 'dictionary_entry', 'file_object', 'file_version', 'notification'])
        expect(await exists(table), table).toBe(true);
    });

    it('девять внешних ключей ссылаются на file_object и file_version: вставка certificates.file_id с id file_object проходит, с несуществующим — 23503', async () => {
      const keys = await pool.query<{ table: string; name: string; target: string }>(
        `select conrelid::regclass::text as table, conname as name, confrelid::regclass::text as target
           from pg_constraint
          where contype = 'f' and confrelid in ('file_object'::regclass, 'file_version'::regclass)
          order by conname`,
      );
      expect(keys.rows).toEqual(
        [
          ...MOVED_KEYS.map(([table, name, target]) => ({ table, name, target })),
          { table: 'file_version', name: 'file_version_file_object_id_file_object_id_fk', target: 'file_object' },
          {
            table: 'org_chart_sample',
            name: 'org_chart_sample_file_object_id_file_object_id_fk',
            target: 'file_object',
          },
        ].sort((a, b) => a.name.localeCompare(b.name)),
      );

      const maker = await organization('manufacturer', '240100000703');
      const profile = (
        await pool.query<{ id: string }>(
          'insert into manufacturer_profiles (organization_id) values ($1) returning id',
          [maker],
        )
      ).rows[0]!.id;
      const section = (
        await pool.query<{ id: string }>(
          "insert into profile_sections (profile_id, kind) values ($1, 'certificates') returning id",
          [profile],
        )
      ).rows[0]!.id;
      const revision = (
        await pool.query<{ id: string }>(
          'insert into section_revisions (section_id, number) values ($1, 1) returning id',
          [section],
        )
      ).rows[0]!.id;
      const file = (
        await pool.query<{ id: string }>(
          "insert into file_object (organization_id, purpose, data_class) values ($1, 'certificate_file', 'b_manufacturer') returning id",
          [maker],
        )
      ).rows[0]!.id;
      const certificate = (fileId: string) =>
        pool.query(
          "insert into certificates (revision_id, type_code, number, issuer, issued_on, file_id) values ($1, 'ISO 9001', 'N-1', 'Issuer', '2026-01-01', $2)",
          [revision, fileId],
        );
      await certificate(file);
      await expect(certificate(randomUUID())).rejects.toMatchObject({
        code: '23503',
        constraint: 'certificates_file_id_file_object_id_fk',
      });

      // Ключ на версию файла: решение эксперта — на file_version.
      const expert = await account(
        (await pool.query<{ id: string }>("select id from organizations where type = 'imbc'")).rows[0]!.id,
        `expert-${randomUUID()}@imbc.local`,
        'expert',
      );
      const assignment = (
        await pool.query<{ id: string }>('insert into review_assignments (profile_id) values ($1) returning id', [
          profile,
        ])
      ).rows[0]!.id;
      const version = (
        await pool.query<{ id: string }>(
          `insert into file_version (file_object_id, version_number, original_name, byte_size, declared_media_type, checksum, storage_key)
           values ($1, 1, 'cert.pdf', 10, 'application/pdf', 'sha256', $2) returning id`,
          [file, randomUUID()],
        )
      ).rows[0]!.id;
      const decision = (fileVersionId: string) =>
        pool.query(
          "insert into review_decisions (assignment_id, file_version_id, decision, expert_id) values ($1, $2, 'verified', $3)",
          [assignment, fileVersionId, expert],
        );
      await decision(version);
      await expect(decision(randomUUID())).rejects.toMatchObject({
        code: '23503',
        constraint: 'review_decisions_file_version_id_file_version_id_fk',
      });
    });

    it('org_chart_sample.is_current по умолчанию false; вставка без колонки даёт false', async () => {
      const defaults = await pool.query(
        "select column_default from information_schema.columns where table_name = 'org_chart_sample' and column_name = 'is_current'",
      );
      expect(defaults.rows).toEqual([{ column_default: 'false' }]);
      const admin = await account(
        (await pool.query<{ id: string }>("select id from organizations where type = 'imbc'")).rows[0]!.id,
        `admin-${randomUUID()}@imbc.local`,
        'administrator',
      );
      const file = (
        await pool.query<{ id: string }>(
          "insert into file_object (purpose, data_class) values ('organisation_chart_sample', 'e_administration') returning id",
        )
      ).rows[0]!.id;
      const inserted = await pool.query(
        'insert into org_chart_sample (file_object_id, uploaded_by, uploaded_at) values ($1, $2, now()) returning is_current',
        [file, admin],
      );
      expect(inserted.rows).toEqual([{ is_current: false }]);
    });
  });
});
