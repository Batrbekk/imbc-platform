import { copyFile, mkdir, mkdtemp, open, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_FILE_BYTES } from '@imbc/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkUploads, runCheckUpload } from '../src/tools/check-upload.js';

// Проверка папки настоящих файлов (DATA-06, DATA-07): те же правила, что у загрузки, без хранилища, базы и сети.
// По строке на файл — путь от каталога, принят или код отказа, причина; в конце итог.
const FIXTURES = fileURLToPath(new URL('./fixtures/files/', import.meta.url));

const run = async (root: string) => {
  const lines: string[] = [];
  const summary = await checkUploads(root, (line) => lines.push(line));
  return { lines, summary };
};

describe('check-upload: проверка каталога файлов', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'imbc-check-upload-'));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('check-upload по каталогу фикстур печатает по строке на файл с кодом и причиной и итог', async () => {
    const { lines, summary } = await run(FIXTURES);
    expect(lines).toEqual(
      expect.arrayContaining([
        'descriptor.xlsx\taccepted\t-',
        'encrypted.docx\tfile_encrypted\t-',
        'gap.docx\tfile_structure_unsupported\tentries_gap',
        'legacy.doc\tfile_type_not_allowed\t-',
        'nested-deep.docx\tfile_too_complex\tnested_too_deep',
        'nested-zip64.docx\tfile_structure_unsupported\tzip64_local_values',
        'nested.docx\taccepted\t-',
        'plain.zip\tfile_type_not_allowed\t-',
        'program.exe\tfile_type_not_allowed\t-',
        'sample-deflated.docx\taccepted\t-',
        'sample.docx\taccepted\t-',
        'sample.jpg\taccepted\t-',
        'sample.pdf\taccepted\t-',
        'sample.png\taccepted\t-',
        'sample.xlsx\taccepted\t-',
        'truncated.docx\tfile_structure_unsupported\tend_record_missing',
        'zip64-directory.docx\tfile_structure_unsupported\tzip64_locator',
        'zip64-local.docx\tfile_structure_unsupported\tzip64_local_values',
        'zip64-local.xlsx\tfile_structure_unsupported\tzip64_local_values',
      ]),
    );
    // Ровно строка на каждый файл каталога, в порядке имён, и итог.
    const files = (await readdir(FIXTURES)).sort();
    expect(lines.slice(0, -1).map((line) => line.split('\t')[0])).toEqual(files);
    const accepted = lines.filter((line) => line.split('\t')[1] === 'accepted').length;
    expect(summary).toEqual({ accepted, refused: files.length - accepted });
    expect(lines.at(-1)).toBe(`accepted ${accepted}, refused ${files.length - accepted}`);
  });

  it('файл больше 25 МБ — too_large; вложенные каталоги обходятся, ссылки — нет; пустой — file_empty; код выхода 0', async () => {
    await mkdir(join(dir, 'Отчёты', '2026'), { recursive: true });
    await copyFile(join(FIXTURES, 'nested.docx'), join(dir, 'Отчёты', '2026', 'Диаграмма.docx'));
    await copyFile(join(FIXTURES, 'encrypted.docx'), join(dir, 'Отчёты', 'Пароль.xlsx'));
    await copyFile(join(FIXTURES, 'sample.pdf'), join(dir, 'a.pdf'));
    await writeFile(join(dir, 'empty.docx'), Buffer.alloc(0));
    // Разреженный файл: размер больше предела, содержимое не читается.
    const big = await open(join(dir, 'big.pdf'), 'w');
    await big.truncate(MAX_FILE_BYTES + 1);
    await big.close();
    await symlink(join(FIXTURES, 'sample.docx'), join(dir, 'link.docx'));
    await symlink(FIXTURES, join(dir, 'linked-dir'));

    const { lines, summary } = await run(dir);
    expect(lines).toEqual([
      'a.pdf\taccepted\t-',
      'big.pdf\ttoo_large\t-',
      'empty.docx\tfile_empty\t-',
      'Отчёты/2026/Диаграмма.docx\taccepted\t-',
      'Отчёты/Пароль.xlsx\tfile_encrypted\t-',
      'accepted 2, refused 3',
    ]);
    expect(summary).toEqual({ accepted: 2, refused: 3 });

    const out: string[] = [];
    const err: string[] = [];
    expect(
      await runCheckUpload(
        [dir],
        (line) => out.push(line),
        (line) => err.push(line),
      ),
    ).toBe(0);
    expect(out).toEqual(lines);
    expect(err).toEqual([]);
  });

  it('без каталога или с лишним аргументом — подсказка и код 2; не каталог — сообщение и код 1', async () => {
    const err: string[] = [];
    expect(
      await runCheckUpload(
        [],
        () => undefined,
        (line) => err.push(line),
      ),
    ).toBe(2);
    expect(
      await runCheckUpload(
        ['a', 'b'],
        () => undefined,
        (line) => err.push(line),
      ),
    ).toBe(2);
    expect(err[0]).toMatch(/check-upload\.js <каталог>/);
    err.length = 0;
    expect(
      await runCheckUpload(
        [join(FIXTURES, 'sample.pdf')],
        () => undefined,
        (line) => err.push(line),
      ),
    ).toBe(1);
    expect(err).toHaveLength(1);
  });
});
