import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_CLASSES, DICTIONARY_CODES, FILE_PURPOSES, FILE_SCAN_STATES, LOCALES } from '@imbc/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const BEFORE = '0008_reference_organizations';
const EXPAND = '0009_stage2_foundation';
const DATA = '0010_stage2_reference_data';
const migrationText = (tag: string) => readFileSync(join(MIGRATIONS, `${tag}.sql`), 'utf8');
const statements = (tag: string) =>
  migrationText(tag)
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
const journalLength = () =>
  (JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length;

/** Семнадцать правил NOT-01…NOT-17 (раздел 8.2): код, событие, получатели — ровно как в SQL 0010. */
const RULES = [
  ['NOT-01', 'password_link', 'person'],
  ['NOT-02', 'sign_in_code', 'person'],
  ['NOT-03', 'account_locked', 'person'],
  ['NOT-04', 'profile_submitted', 'imbc_mailbox'],
  ['NOT-05', 'review_result', 'manufacturer_account+focal_point'],
  ['NOT-06', 'certificate_expiry_threshold', 'manufacturer_account+imbc_mailbox'],
  ['NOT-07', 'imbc_request_received', 'imbc_mailbox'],
  ['NOT-08', 'imbc_request_replied', 'person'],
  ['NOT-09', 'export_file_ready', 'person'],
  ['NOT-10', 'profile_unlocked_in_review', 'assigned_sme_or_imbc_mailbox'],
  ['NOT-11', 'profile_site_surveyed', 'operator_accounts_not_blocked'],
  ['NOT-12', 'quarter_confirmation_request', 'manufacturer_account+focal_point'],
  ['NOT-13', 'operator_request_sent', 'manufacturer_contacts+imbc_mailbox'],
  ['NOT-14', 'operator_request_replied', 'person'],
  ['NOT-15', 'second_missed_quarter', 'manufacturer_account+focal_point'],
  ['NOT-16', 'profile_unresponsive', 'manufacturer_account+focal_point'],
  ['NOT-17', 'subscriptions_pause_warning', 'person'],
].map(([code, event, recipientRule]) => ({ code, event, recipient_rule: recipientRule, enabled: true }));

// Этап 2: модель справочников, файлов и журнала уведомлений по DBML. 0009 — expand (NFR-06),
// 0010 — данные: двенадцать справочников ADM-08, семнадцать правил NOT-01…NOT-17, перенос
// notifications_sent в журнал notification (NOT-18).
describe('0009 и 0010: текст миграций', () => {
  it('в 0009 нет DROP, RENAME, ALTER COLUMN, SET NOT NULL и ALTER TYPE', () => {
    const text = migrationText(EXPAND);
    expect(text).not.toMatch(/\bDROP\s/i);
    expect(text).not.toMatch(/\bRENAME\b/i);
    expect(text).not.toMatch(/ALTER COLUMN/i);
    expect(text).not.toMatch(/SET NOT NULL/i);
    expect(text).not.toMatch(/ALTER TYPE/i);
    // Только CREATE TYPE, CREATE TABLE, CREATE INDEX и ADD CONSTRAINT; ни одного UPDATE, DELETE и ADD COLUMN.
    for (const statement of statements(EXPAND))
      expect(statement).toMatch(
        /^(CREATE TYPE "public"\."\w+" AS ENUM\(|CREATE TABLE "\w+"|ALTER TABLE "\w+" ADD CONSTRAINT "\w+" |CREATE (UNIQUE )?INDEX "\w+" ON )/,
      );
  });

  it('в 0010 — только INSERT … ON CONFLICT DO NOTHING', () => {
    const body = statements(DATA);
    expect(body).toHaveLength(3);
    for (const statement of body) {
      expect(statement).toMatch(/^INSERT INTO \w+ \(/);
      expect(statement).toMatch(/ON CONFLICT \(\w+\) DO NOTHING;?$/);
      expect(statement).not.toMatch(/\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('этап 2: миграции 0009 и 0010', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;

  beforeAll(() => {
    pool = openTestPool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** Код ошибки PostgreSQL и имя ограничения из отказа. */
  const refusal = (code: string, constraint: string) => expect.objectContaining({ code, constraint });

  /** Строка целиком (jsonb). */
  const row = async (table: string, id: string) =>
    (
      await pool.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from ${table} t where id = $1`, [
        id,
      ])
    ).rows[0]!.row;

  const count = async (table: string) =>
    (await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n;

  /**
   * Данные так, как их пишет предыдущая версия приложения (этап 1, `handlers.service.ts`): аккаунт,
   * письмо NOT-03 в notifications_sent (`sendNotification`), скелетные file_objects и file_versions
   * после скана (`scanFile`). Списки колонок — те же, что у предыдущей версии.
   */
  async function previousVersionData() {
    const organization = (
      await pool.query<{ id: string }>(
        "insert into organizations (type, name, bin) values ('manufacturer', 'ТОО «Этап 2»', '240100000501') returning id",
      )
    ).rows[0]!.id;
    const account = (
      await pool.query<{ id: string }>(
        "insert into user_accounts (organization_id, email, role, idp_subject, locale) values ($1, 'locked@stage2.local', 'manufacturer', $2, 'ru') returning id",
        [organization, randomUUID()],
      )
    ).rows[0]!.id;
    const sent = (
      await pool.query<{ id: string }>(
        "insert into notifications_sent (code, dedupe_key, recipient, locale) values ('NOT-03', 'sub-1:1700000000000', 'Locked@Stage2.local', 'ru') on conflict do nothing returning id",
      )
    ).rows[0]!.id;
    const fileObject = (
      await pool.query<{ id: string }>(
        "insert into file_objects (organization_id, data_class) values ($1, 'B') returning id",
        [organization],
      )
    ).rows[0]!.id;
    const fileVersion = (
      await pool.query<{ id: string }>(
        `insert into file_versions (file_id, version, bucket, object_key, original_name, mime_type, size_bytes, sha256, scan_state, scanned_at, uploaded_by)
         values ($1, 1, 'imbc-files', $2, 'scan.pdf', 'application/pdf', 1024, 'abc', 'clean', now(), $3) returning id`,
        [fileObject, randomUUID(), account],
      )
    ).rows[0]!.id;
    return { organization, account, sent, fileObject, fileVersion };
  }

  describe('база 0008 с данными предыдущей версии', () => {
    const before: Record<string, Record<string, unknown>> = {};
    let ids: Awaited<ReturnType<typeof previousVersionData>>;

    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool, BEFORE);
      ids = await previousVersionData();
      before.account = await row('user_accounts', ids.account);
      before.sent = await row('notifications_sent', ids.sent);
      before.fileObject = await row('file_objects', ids.fileObject);
      before.fileVersion = await row('file_versions', ids.fileVersion);
      await migrateThrough(pool);
    }, 60000);

    it('0009 и 0010 — expand: база 0008 с данными предыдущей версии мигрирует; запись предыдущей версии проходит (NFR-06)', async () => {
      const journal = await pool.query('select count(*)::int as n from drizzle.__drizzle_migrations');
      expect(journal.rows).toEqual([{ n: journalLength() }]);
      // Строки предыдущей версии целы.
      expect(await row('user_accounts', ids.account)).toEqual(before.account);
      expect(await row('notifications_sent', ids.sent)).toEqual(before.sent);
      expect(await row('file_objects', ids.fileObject)).toEqual(before.fileObject);
      expect(await row('file_versions', ids.fileVersion)).toEqual(before.fileVersion);
      // Скелетный тип scan_state живёт до contract рядом с новым file_scan_state.
      const types = await pool.query<{ scan: string; file: string }>(
        'select enum_range(null::scan_state)::text as scan, enum_range(null::file_scan_state)::text as file',
      );
      expect(types.rows).toEqual([
        { scan: '{pending,clean,infected,type_mismatch}', file: '{pending,passed,rejected}' },
      ]);

      // Запись предыдущей версии теми же запросами: новое письмо NOT-03, освобождение ключа после сбоя SMTP,
      // новая версия скелетного файла со сканом infected.
      const another = await pool.query<{ id: string }>(
        "insert into notifications_sent (code, dedupe_key, recipient, locale) values ('NOT-03', 'sub-1:1700000000999', 'locked@stage2.local', 'ru') on conflict do nothing returning id",
      );
      expect(another.rows).toHaveLength(1);
      await pool.query('delete from notifications_sent where id = $1', [another.rows[0]!.id]);
      const infected = await pool.query<{ scan_state: string }>(
        `insert into file_versions (file_id, version, bucket, object_key, original_name, mime_type, size_bytes, sha256, scan_state, scanned_at)
         values ($1, 2, 'imbc-quarantine', $2, 'scan-2.pdf', 'application/pdf', 2048, 'def', 'infected', now()) returning scan_state`,
        [ids.fileObject, randomUUID()],
      );
      expect(infected.rows).toEqual([{ scan_state: 'infected' }]);
      await pool.query("update file_versions set scan_state = 'clean', bucket = 'imbc-files' where id = $1", [
        ids.fileVersion,
      ]);
      // Новые таблицы предыдущая версия не трогает: скелетный файл в них не перенесён.
      expect(await count('file_object')).toBe(0);
      expect(await count('file_version')).toBe(0);
    });
  });

  describe('0010 на базе 0008 с письмами предыдущей версии', () => {
    let account: string;
    const journal = async () =>
      (
        await pool.query<{
          rule_code: string;
          recipient_email: string;
          user_account_id: string | null;
          language: string;
          dedup_key: string;
          sent_at: Date;
        }>(
          'select rule_code, recipient_email, user_account_id, language, dedup_key, sent_at from notification order by dedup_key',
        )
      ).rows;

    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool, BEFORE);
      ({ account } = await previousVersionData());
      // Адрес без аккаунта и неожиданный язык; код, которого нет среди правил, не переносится.
      await pool.query(
        "insert into notifications_sent (code, dedupe_key, recipient, locale, sent_at) values ('NOT-02', 'otp-1', 'nobody@stage2.local', 'xx', '2026-11-01T09:00:00+05:00')",
      );
      await pool.query(
        "insert into notifications_sent (code, dedupe_key, recipient, locale) values ('LEGACY-01', 'k-1', 'locked@stage2.local', 'kk')",
      );
      await migrateThrough(pool);
    }, 60000);

    it('0010: двенадцать справочников с кодами DBML в порядке ADM-08, семнадцать правил; повторный прогон SQL 0010 ничего не добавляет', async () => {
      const dictionaries = await pool.query<{ code: string; name: string }>('select code, name from dictionary');
      expect(dictionaries.rows.map((d) => d.code).sort()).toEqual([...DICTIONARY_CODES].sort());
      for (const d of dictionaries.rows) expect(d.name, d.code).toMatch(/^\S.*\S$/);
      const rules = await pool.query(
        'select code, event, recipient_rule, enabled from notification_rule order by code',
      );
      expect(rules.rows).toEqual(RULES);

      const counts = async () => ({
        dictionary: await count('dictionary'),
        rules: await count('notification_rule'),
        notification: await count('notification'),
      });
      const first = await counts();
      expect(first).toEqual({ dictionary: 12, rules: 17, notification: 2 });
      const log = await journal();

      // Тело 0010 ещё раз: ни строк, ни изменений.
      const body = statements(DATA);
      expect(body).toHaveLength(3);
      for (const statement of body) await pool.query(statement);
      expect(await counts()).toEqual(first);
      expect(await journal()).toEqual(log);
      expect(
        (await pool.query('select code, event, recipient_rule, enabled from notification_rule order by code')).rows,
      ).toEqual(RULES);
    });

    it("0010 переносит письма в журнал: dedup_key = 'NOT-03\\nsub-1:1700000000000\\nlocked@stage2.local', user_account_id найден без учёта регистра, язык ru, sent_at тот же (NOT-18)", async () => {
      const sent = await pool.query<{ sent_at: Date }>(
        "select sent_at from notifications_sent where code = 'NOT-03' and dedupe_key = 'sub-1:1700000000000'",
      );
      const log = await journal();
      expect(log).toEqual([
        {
          rule_code: 'NOT-02',
          recipient_email: 'nobody@stage2.local',
          user_account_id: null,
          language: 'kk',
          dedup_key: 'NOT-02\notp-1\nnobody@stage2.local',
          sent_at: new Date('2026-11-01T09:00:00+05:00'),
        },
        {
          rule_code: 'NOT-03',
          recipient_email: 'Locked@Stage2.local',
          user_account_id: account,
          language: 'ru',
          dedup_key: 'NOT-03\nsub-1:1700000000000\nlocked@stage2.local',
          sent_at: sent.rows[0]!.sent_at,
        },
      ]);
      // Код вне семнадцати правил в журнал не попадает: журнал принимает только известные правила.
      expect(log.some((n) => n.rule_code === 'LEGACY-01')).toBe(false);
    });
  });

  describe('чистая база', () => {
    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool);
    }, 60000);

    let n = 0;
    const organization = async () =>
      (
        await pool.query<{ id: string }>(
          "insert into organizations (type, name, bin) values ('manufacturer', 'ТОО «Ограничения»', $1) returning id",
          [`24010000060${++n}`],
        )
      ).rows[0]!.id;
    const administrator = async () =>
      (
        await pool.query<{ id: string }>(
          "insert into user_accounts (organization_id, email, role) select id, $1, 'administrator' from organizations where type = 'imbc' returning id",
          [`${randomUUID()}@imbc.local`],
        )
      ).rows[0]!.id;
    const fileObject = async (
      purpose = 'organisation_chart_sample',
      dataClass = 'e_administration',
      org: string | null = null,
    ) =>
      (
        await pool.query<{ id: string }>(
          'insert into file_object (organization_id, purpose, data_class) values ($1, $2, $3) returning id',
          [org, purpose, dataClass],
        )
      ).rows[0]!.id;
    const fileVersion = (fileObjectId: string, versionNumber: number, byteSize: number) =>
      pool.query(
        `insert into file_version (file_object_id, version_number, original_name, byte_size, declared_media_type, checksum, storage_key)
         values ($1, $2, 'sample.pdf', $3, 'application/pdf', 'sha256', $4)`,
        [fileObjectId, versionNumber, byteSize, randomUUID()],
      );
    const dictionaryId = async (code: string) =>
      (await pool.query<{ id: string }>('select id from dictionary where code = $1', [code])).rows[0]!.id;
    const entry = async (dictionary: string, code: string) =>
      (
        await pool.query<{ id: string }>(
          'insert into dictionary_entry (dictionary_id, code) values ($1, $2) returning id',
          [await dictionaryId(dictionary), code],
        )
      ).rows[0]!.id;

    it('типы 0009 — значения @imbc/contracts (FILE_PURPOSES, DATA_CLASSES, FILE_SCAN_STATES; язык — locale)', async () => {
      const range = async (type: string) =>
        (await pool.query<{ v: string[] }>(`select enum_range(null::${type})::text[] as v`)).rows[0]!.v;
      expect(await range('file_purpose')).toEqual([...FILE_PURPOSES]);
      expect(await range('data_class')).toEqual([...DATA_CLASSES]);
      expect(await range('file_scan_state')).toEqual([...FILE_SCAN_STATES]);
      expect(await range('locale')).toEqual([...LOCALES]);
    });

    it('файл: версия 0 и 26 214 401 байт — 23514; одна и та же версия дважды — 23505; 25 МБ и scan_state pending по умолчанию — можно (DATA-05, DATA-06, DATA-07)', async () => {
      const file = await fileObject('certificate_file', 'b_manufacturer', await organization());
      await expect(fileVersion(file, 0, 10)).rejects.toMatchObject(refusal('23514', 'file_version_number_ck'));
      await expect(fileVersion(file, 1, 26214401)).rejects.toMatchObject(refusal('23514', 'file_version_byte_size_ck'));
      await expect(fileVersion(file, 1, 0)).rejects.toMatchObject(refusal('23514', 'file_version_byte_size_ck'));
      await fileVersion(file, 1, 26214400);
      await expect(fileVersion(file, 1, 10)).rejects.toMatchObject(refusal('23505', 'file_version_number_uq'));
      await fileVersion(file, 2, 1);
      const versions = await pool.query(
        'select version_number, byte_size, scan_state from file_version where file_object_id = $1 order by version_number',
        [file],
      );
      expect(versions.rows).toEqual([
        { version_number: 1, byte_size: '26214400', scan_state: 'pending' },
        { version_number: 2, byte_size: '1', scan_state: 'pending' },
      ]);
    });

    it('образец оргструктуры: второй текущий образец — 23505; прежний — строка истории (ADM-11)', async () => {
      const by = await administrator();
      const sample = async (current: boolean) =>
        pool.query(
          'insert into org_chart_sample (file_object_id, uploaded_by, uploaded_at, is_current) values ($1, $2, now(), $3)',
          [await fileObject(), by, current],
        );
      await sample(true);
      await expect(sample(true)).rejects.toMatchObject(refusal('23505', 'org_chart_sample_current_uq'));
      await sample(false);
      await sample(false);
      const rows = await pool.query(
        'select count(*)::int as n, count(*) filter (where is_current)::int as current from org_chart_sample',
      );
      expect(rows.rows).toEqual([{ n: 3, current: 1 }]);
      // Один файл — один образец.
      const file = (await pool.query<{ id: string }>('select file_object_id as id from org_chart_sample limit 1'))
        .rows[0]!.id;
      await expect(
        pool.query(
          'insert into org_chart_sample (file_object_id, uploaded_by, uploaded_at, is_current) values ($1, $2, now(), false)',
          [file, by],
        ),
      ).rejects.toMatchObject(refusal('23505', 'org_chart_sample_file_uq'));
    });

    it('справочники: код, отличающийся регистром, в том же справочнике — 23505, в другом — можно; код с пробелом по краям — 23514; названия значения — отдельные строки по языку, второй перевод на тот же язык — 23505 (DATA-02)', async () => {
      const iso = await entry('certificate_type', 'ISO 9001');
      await expect(entry('certificate_type', 'iso 9001')).rejects.toMatchObject(
        refusal('23505', 'dictionary_entry_code_uq'),
      );
      await entry('document_type', 'iso 9001');
      await expect(entry('certificate_type', ' ISO 14001')).rejects.toMatchObject(
        refusal('23514', 'dictionary_entry_code_ck'),
      );
      await expect(entry('certificate_type', 'ISO 14001 ')).rejects.toMatchObject(
        refusal('23514', 'dictionary_entry_code_ck'),
      );
      await expect(entry('certificate_type', '')).rejects.toMatchObject(refusal('23514', 'dictionary_entry_code_ck'));
      // Код — текст: ведущие нули остаются (DATA-03).
      const oked = await entry('oked', '01110');
      expect((await pool.query('select code from dictionary_entry where id = $1', [oked])).rows).toEqual([
        { code: '01110' },
      ]);
      // Значение не может быть родителем самого себя.
      await expect(
        pool.query('update dictionary_entry set parent_entry_id = id where id = $1', [iso]),
      ).rejects.toMatchObject(refusal('23514', 'dictionary_entry_parent_ck'));
      const entryRow = await pool.query(
        'select mandatory, custom_name_allowed, sort_order, retired_at, parent_entry_id from dictionary_entry where id = $1',
        [iso],
      );
      expect(entryRow.rows).toEqual([
        { mandatory: null, custom_name_allowed: false, sort_order: 0, retired_at: null, parent_entry_id: null },
      ]);

      const translate = (language: string, name: string) =>
        pool.query(
          'insert into dictionary_entry_translation (dictionary_entry_id, language, name) values ($1, $2, $3)',
          [iso, language, name],
        );
      await translate('kk', 'ISO 9001 сапа менеджменті');
      await translate('ru', 'ISO 9001 менеджмент качества');
      await translate('en', 'ISO 9001 quality management');
      await expect(translate('ru', 'Другое название')).rejects.toMatchObject(
        refusal('23505', 'dictionary_entry_translation_dictionary_entry_id_language_pk'),
      );
      await expect(translate('de', 'Qualität')).rejects.toMatchObject({ code: '22P02' });
      for (const name of ['', ' ISO', 'ISO '])
        await expect(
          pool.query(
            "insert into dictionary_entry_translation (dictionary_entry_id, language, name) values ($1, 'kk', $2)",
            [oked, name],
          ),
          JSON.stringify(name),
        ).rejects.toMatchObject(refusal('23514', 'dictionary_entry_translation_name_ck'));
      const names = await pool.query(
        'select language, name from dictionary_entry_translation where dictionary_entry_id = $1 order by language',
        [iso],
      );
      expect(names.rows).toEqual([
        { language: 'kk', name: 'ISO 9001 сапа менеджменті' },
        { language: 'ru', name: 'ISO 9001 менеджмент качества' },
        { language: 'en', name: 'ISO 9001 quality management' },
      ]);
      // Переводы уходят вместе со значением.
      await pool.query('delete from dictionary_entry where id = $1', [iso]);
      expect(
        (
          await pool.query(
            'select count(*)::int as n from dictionary_entry_translation where dictionary_entry_id = $1',
            [iso],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    });

    it('журнал писем: второе письмо с тем же dedup_key — 23505; правило с неизвестным кодом — 23503 (NOT-18)', async () => {
      const send = (ruleCode: string, dedupKey: string) =>
        pool.query(
          "insert into notification (rule_code, recipient_email, language, dedup_key) values ($1, 'person@stage2.local', 'kk', $2)",
          [ruleCode, dedupKey],
        );
      const key = 'NOT-03\nsub-2:1700000000000\nperson@stage2.local';
      await send('NOT-03', key);
      await expect(send('NOT-03', key)).rejects.toMatchObject(refusal('23505', 'notification_dedup_uq'));
      await expect(send('NOT-99', 'NOT-99\nx\nperson@stage2.local')).rejects.toMatchObject(
        refusal('23503', 'notification_rule_code_notification_rule_code_fk'),
      );
      const sent = await pool.query<{ sent_at: Date | null }>('select sent_at from notification where dedup_key = $1', [
        key,
      ]);
      expect(sent.rows[0]!.sent_at).toBeInstanceOf(Date);
    });

    it('права роли приложения: notification — только SELECT и INSERT; notification_rule и dictionary — только SELECT; dictionary_entry — SELECT, INSERT, UPDATE, DELETE', async () => {
      const ROLE = 'imbc_grants_test';
      /** Роль кластера удаляется вместе с правами, даже если тест упал. */
      const dropRole = () =>
        pool.query(`DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
            REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE};
            DROP ROLE ${ROLE};
          END IF;
        END $$`);
      const TABLES = [
        'notification',
        'notification_rule',
        'dictionary',
        'dictionary_entry',
        'dictionary_entry_translation',
        'file_object',
        'file_version',
        'org_chart_sample',
      ];
      const privileges = async () =>
        (
          await pool.query<{ t: string; p: string; ok: boolean }>(
            `select t, p, has_table_privilege($1, t, p) as ok
             from unnest($2::text[]) t,
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
             order by t, p`,
            [ROLE, TABLES],
          )
        ).rows;
      const allowed = (rows: Awaited<ReturnType<typeof privileges>>, table: string) =>
        rows
          .filter((r) => r.t === table && r.ok)
          .map((r) => r.p)
          .sort();

      await dropRole();
      await pool.query(`CREATE ROLE ${ROLE} NOLOGIN`);
      try {
        await applyAppRoleGrants(pool, ROLE);
        const first = await privileges();
        // Журнал писем — только добавление (NOT-18: запись и отправка в одной транзакции, без удаления).
        expect(allowed(first, 'notification')).toEqual(['INSERT', 'SELECT']);
        // Правила и справочники меняются только релизом (миграцией).
        expect(allowed(first, 'notification_rule')).toEqual(['SELECT']);
        expect(allowed(first, 'dictionary')).toEqual(['SELECT']);
        // Значения, переводы, файлы и образец ведёт приложение.
        for (const table of [
          'dictionary_entry',
          'dictionary_entry_translation',
          'file_object',
          'file_version',
          'org_chart_sample',
        ])
          expect(allowed(first, table), table).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);

        // Повторный вызов (каждый выкат) даёт те же права.
        await applyAppRoleGrants(pool, ROLE);
        expect(await privileges()).toEqual(first);
      } finally {
        await dropRole();
      }
      const left = await pool.query('select count(*)::int as n from pg_roles where rolname = $1', [ROLE]);
      expect(left.rows).toEqual([{ n: 0 }]);
    });
  });
});
