import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILE_REJECTION_REASONS } from '@imbc/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const REJECTION_REASON = '0012_file_rejection_reason';
const statements = (tag: string) =>
  readFileSync(join(MIGRATIONS, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
const journalTags = () =>
  (
    JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  ).entries.map((e) => e.tag);

// 0012 — причина отказа скана у версии файла (DATA-07, расхождение 6 плана этапа 3а). Expand (NFR-06): новый тип и
// колонка, которая может быть пустой; без CHECK «rejected ⇔ причина есть» — worker прежней версии в окне выката и
// после отката пишет rejected без причины, строки этапа 2 с rejected остаются без неё.
describe('0012: текст миграции (NFR-06)', () => {
  it('после 0011; только CREATE TYPE file_rejection_reason со значениями FILE_REJECTION_REASONS и ADD COLUMN без NOT NULL, DEFAULT и CHECK', () => {
    const tags = journalTags();
    expect(tags.indexOf(REJECTION_REASON)).toBe(tags.indexOf('0011_stage2_contract') + 1);
    const values = FILE_REJECTION_REASONS.map((value) => `'${value}'`).join(', ');
    expect(statements(REJECTION_REASON)).toEqual([
      `CREATE TYPE "public"."file_rejection_reason" AS ENUM(${values});`,
      'ALTER TABLE "file_version" ADD COLUMN "rejection_reason" "file_rejection_reason";',
    ]);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('0012 на базе этапа 2 (NFR-06)', () => {
  vi.setConfig({ testTimeout: 60000 });
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool, '0011_stage2_contract');
  }, 120000);

  afterAll(async () => {
    await pool?.end();
  });

  it('версии этапа 2 (pending, passed, rejected) остаются, причина пуста; запись прежней версии worker (rejected без причины) проходит; тип БД — значения FILE_REJECTION_REASONS по порядку', async () => {
    const object = (
      await pool.query<{ id: string }>(
        "insert into file_object (purpose, data_class) values ('organisation_chart_sample', 'e_administration') returning id",
      )
    ).rows[0]!.id;
    const insertVersion = (number: number, state: string) =>
      pool.query(
        `insert into file_version (file_object_id, version_number, original_name, byte_size, declared_media_type,
           checksum, scan_state, storage_key) values ($1, $2, 'a.pdf', 1, 'application/pdf', 'x', $3, gen_random_uuid())`,
        [object, number, state],
      );
    await insertVersion(1, 'passed');
    await insertVersion(2, 'rejected');
    await insertVersion(3, 'pending');

    await migrateThrough(pool);

    const rows = async () =>
      (
        await pool.query<{ version_number: number; scan_state: string; rejection_reason: string | null }>(
          'select version_number, scan_state, rejection_reason from file_version where file_object_id = $1 order by 1',
          [object],
        )
      ).rows;
    expect(await rows()).toEqual([
      { version_number: 1, scan_state: 'passed', rejection_reason: null },
      { version_number: 2, scan_state: 'rejected', rejection_reason: null },
      { version_number: 3, scan_state: 'pending', rejection_reason: null },
    ]);
    // Worker прежней версии: переход в rejected без колонки причины.
    await pool.query(
      "update file_version set scan_state = 'rejected', scanned_at = now() where file_object_id = $1 and version_number = 3",
      [object],
    );
    expect((await rows())[2]).toEqual({ version_number: 3, scan_state: 'rejected', rejection_reason: null });

    const values = await pool.query<{ value: string }>(
      `select e.enumlabel as value from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'file_rejection_reason' order by e.enumsortorder`,
    );
    expect(values.rows.map((r) => r.value)).toEqual([...FILE_REJECTION_REASONS]);
    await expect(
      pool.query("update file_version set rejection_reason = 'virus' where file_object_id = $1", [object]),
    ).rejects.toThrow();
  });
});
