import { open, readdir, stat } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_FILE_BYTES } from '@imbc/contracts';
import { cleanFileName, inspectFile } from '../modules/files/upload.js';

/**
 * Проверка папки настоящих файлов теми же правилами, что и загрузка (DATA-06, DATA-07): какие файлы платформа
 * отклонит и почему — до того, как их загрузят производители. Хранилища, базы и сети не трогает: только чтение
 * файлов и `inspectFile`.
 *
 *   node apps/api/dist/tools/check-upload.js <каталог>
 *
 * По строке на файл (рекурсивно, в порядке имён; символические ссылки не раскрываются):
 * `<путь от каталога>\t<accepted|код>\t<причина|->`. Код — как в ответе загрузки (`file_encrypted`,
 * `file_structure_unsupported` …), кроме `too_large` (больше 25 МБ, не читается), `file_empty` и `unreadable`
 * (причина — код ошибки чтения). Причина — `ZipStructureIssue` для DOCX и XLSX. В конце — `accepted N, refused M`.
 * Код выхода 0; без каталога — 2, каталог не читается — 1.
 */

export interface CheckSummary {
  accepted: number;
  refused: number;
}

/** Управляющие символы в имени файла печатаются как `?`: строка вывода остаётся одной строкой с тремя полями. */
const printable = (value: string) => value.replace(/\p{Cc}/gu, '?');

/** Код ошибки файловой системы (`EACCES` …) без текста: в тексте — путь. */
const errorCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'error';
};

/**
 * Обычные файлы каталога рекурсивно, в порядке имён (по кодовым единицам); ссылки и прочее пропускаются.
 * Вложенный каталог, который не читается, — запись с кодом ошибки; корневой — ошибка.
 */
async function* regularFiles(dir: string, root = true): AsyncGenerator<{ path: string; error?: string }> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (root) throw error;
    yield { path: dir, error: errorCode(error) };
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* regularFiles(path, false);
    else if (entry.isFile()) yield { path };
  }
}

/** Вердикт по одному файлу: принят или код отказа и причина. Больше `MAX_FILE_BYTES` — не читается. */
async function checkFile(path: string): Promise<{ verdict: string; reason: string | null }> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size > MAX_FILE_BYTES) return { verdict: 'too_large', reason: null };
    const bytes = await handle.readFile();
    if (bytes.length > MAX_FILE_BYTES) return { verdict: 'too_large', reason: null };
    if (bytes.length === 0) return { verdict: 'file_empty', reason: null };
    const result = await inspectFile(bytes, cleanFileName(basename(path)));
    return result.ok ? { verdict: 'accepted', reason: null } : { verdict: result.code, reason: result.reason };
  } finally {
    await handle.close();
  }
}

/** Проверяет файлы каталога `root` и печатает строку на файл и итог через `print`. */
export async function checkUploads(root: string, print: (line: string) => void): Promise<CheckSummary> {
  const summary: CheckSummary = { accepted: 0, refused: 0 };
  for await (const { path, error } of regularFiles(root)) {
    const name = relative(root, path).split(sep).join('/');
    let verdict: { verdict: string; reason: string | null };
    try {
      verdict = error ? { verdict: 'unreadable', reason: error } : await checkFile(path);
    } catch (failure) {
      verdict = { verdict: 'unreadable', reason: errorCode(failure) };
    }
    if (verdict.verdict === 'accepted') summary.accepted++;
    else summary.refused++;
    print(`${printable(name)}\t${verdict.verdict}\t${verdict.reason ?? '-'}`);
  }
  print(`accepted ${summary.accepted}, refused ${summary.refused}`);
  return summary;
}

/** Разбор аргументов и запуск; возвращает код выхода. */
export async function runCheckUpload(
  args: readonly string[],
  out: (line: string) => void,
  err: (line: string) => void,
): Promise<number> {
  if (args.length !== 1 || !args[0]) {
    err('Использование: node apps/api/dist/tools/check-upload.js <каталог>');
    return 2;
  }
  const root = resolve(args[0]);
  try {
    if (!(await stat(root)).isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    await checkUploads(root, out);
    return 0;
  } catch (error) {
    err(`Каталог не прочитан: ${errorCode(error)}`);
    return 1;
  }
}

// Запуск только при прямом вызове (`node dist/tools/check-upload.js`), не при импорте из тестов.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCheckUpload(
    process.argv.slice(2),
    (line) => process.stdout.write(`${line}\n`),
    (line) => process.stderr.write(`${line}\n`),
  ).then((code) => {
    process.exitCode = code;
  });
}
