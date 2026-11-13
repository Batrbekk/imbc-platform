/**
 * Наполнение справочников из файлов репозитория (ADM-08, DATA-03). Файлы — `apps/api/reference-data`,
 * в образе — рядом с `dist`: `release` — списки, которые фиксирует спецификация (и перечни IMBC), их грузит
 * `migrate` при каждом выкате; `provisional` — временные значения прототипа, их грузит только `seed`.
 *
 * Загрузка идемпотентна и ничего не затирает: нет значения (без учёта регистра кода) — оно вставляется; у
 * существующего добавляются только недостающие переводы. Названия, `mandatory`, `sort_order` и `retired_at`
 * ведёт администратор (ADM-08, ADM-09, DATA-04) — загрузка их не меняет. Значение, которое администратор
 * удалил (аудит `dictionary.entry_deleted` этого справочника с этим кодом), загрузка не возвращает: код
 * пропускается целиком — и вставка, и переводы, даже если администратор потом создал значение с тем же кодом.
 *
 * Строки `dictionary` кладёт миграция 0010, а у роли приложения нет INSERT на `dictionary`: загрузчик пишет
 * только `dictionary_entry`, `dictionary_entry_translation` и аудит.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DICTIONARY_CODE_PATTERNS,
  DICTIONARY_CODES,
  DICTIONARY_PARENT,
  type DictionaryCode,
  LOCALES,
  MANDATORY_DICTIONARIES,
  type ReferenceDataStatus,
  type ReferenceFile,
  referenceFileSchema,
} from '@imbc/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './database.module.js';
import { auditEntries, dictionary, dictionaryEntry, dictionaryEntryTranslation } from './schema/index.js';

/** `apps/api/reference-data`: от `src/database` и от `dist/database` — два уровня вверх. */
export const REFERENCE_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../reference-data');

/** Какие файлы принимает вызов: `release` — списки спецификации и перечни IMBC, `provisional` — временные. */
export type ReferenceExpect = 'release' | 'provisional';

const ACCEPTED_STATUSES: Record<ReferenceExpect, readonly ReferenceDataStatus[]> = {
  release: ['specification', 'imbc'],
  provisional: ['provisional'],
};

/** Значение «Other» (MAN-34): только у типов сертификатов. */
const CUSTOM_NAME_DICTIONARY: DictionaryCode = 'certificate_type';

/** Строк в одном INSERT: у значения 6 параметров, у перевода 3 — до 6000, предел PostgreSQL 65535. */
const BATCH_SIZE = 1000;

/** Файл справочника не принят. Текст называет файл и правило, но не значения из файла. */
export class ReferenceFileError extends Error {
  constructor(
    readonly fileName: string,
    readonly rule: string,
  ) {
    super(`Файл справочника ${fileName}: ${rule}`);
    this.name = 'ReferenceFileError';
  }
}

export interface ReferenceLoadResult {
  dictionary: DictionaryCode;
  /** Значений вставлено. */
  inserted: number;
  /** Строк перевода вставлено — у новых значений и у существующих, которым не хватало языка. */
  translationsAdded: number;
  /** Значений файла пропущено: администратор удалил значение с этим кодом (DATA-04). В аудит загрузки не идёт. */
  skippedDeleted: number;
}

/** Строка журнала `migrate` и `seed` об одном файле. */
export function referenceLoadSummary(r: ReferenceLoadResult): string {
  return `${r.dictionary} +${r.inserted} (+${r.translationsAdded} переводов), пропущено удалённых: ${r.skippedDeleted}`;
}

type Executor = Pick<Database, 'select' | 'insert'>;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** Разбор JSON по схеме; ошибка называет путь и вид нарушения, но не значение. */
function parseReferenceFile(raw: unknown, fileName: string): ReferenceFile {
  const result = referenceFileSchema.safeParse(raw);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(файл)'} — ${i.code}`);
  const more = result.error.issues.length > issues.length ? '; …' : '';
  throw new ReferenceFileError(fileName, `не соответствует схеме: ${issues.join('; ')}${more}`);
}

/** Правила, которые видны без базы. Номер записи — её место в файле, значения в текст не попадают. */
function checkReferenceFile(file: ReferenceFile, expect: ReferenceExpect, fileName: string): void {
  if (!ACCEPTED_STATUSES[expect].includes(file.status))
    throw new ReferenceFileError(fileName, `статус файла не допускается при загрузке ${expect}`);

  const pattern = DICTIONARY_CODE_PATTERNS[file.dictionary];
  const mandatoryAllowed = (MANDATORY_DICTIONARIES as readonly DictionaryCode[]).includes(file.dictionary);
  const parentDictionary = DICTIONARY_PARENT[file.dictionary];
  const seen = new Map<string, number>();
  for (const [i, entry] of file.entries.entries()) {
    const at = `запись ${i + 1}`;
    if (!pattern.test(entry.code))
      throw new ReferenceFileError(fileName, `${at}: код не соответствует шаблону справочника`);
    // Уникальность кода без учёта регистра — как в индексе dictionary_entry_code_uq.
    const key = entry.code.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined)
      throw new ReferenceFileError(fileName, `${at}: код повторяет запись ${first} без учёта регистра`);
    seen.set(key, i + 1);
    if (entry.mandatory !== undefined && !mandatoryAllowed)
      throw new ReferenceFileError(fileName, `${at}: признак mandatory есть только у типов сертификатов и документов`);
    if (entry.customNameAllowed && file.dictionary !== CUSTOM_NAME_DICTIONARY)
      throw new ReferenceFileError(fileName, `${at}: customNameAllowed есть только у типов сертификатов`);
    if (entry.parent !== null && parentDictionary === undefined)
      throw new ReferenceFileError(fileName, `${at}: у значений этого справочника нет родителя`);
  }
}

/**
 * Загружает один файл в одной транзакции: любое нарушение откатывает файл целиком. `fileName` — для текста
 * ошибки; по умолчанию код справочника. Повторный вызов ничего не добавляет.
 */
export async function loadReferenceFile(
  db: Database,
  file: ReferenceFile,
  expect: ReferenceExpect,
  fileName: string = `${file.dictionary}.json`,
): Promise<ReferenceLoadResult> {
  // Проход через схему подставляет значения по умолчанию и защищает от файла, собранного не через неё.
  const parsed = parseReferenceFile(file, fileName);
  checkReferenceFile(parsed, expect, fileName);
  const mandatoryAllowed = (MANDATORY_DICTIONARIES as readonly DictionaryCode[]).includes(parsed.dictionary);

  return db.transaction(async (tx) => {
    const dictionaryId = await findDictionaryId(tx, parsed.dictionary, fileName);
    const deleted = await deletedCodes(tx, parsed.dictionary);
    const loaded = parsed.entries.filter((e) => !deleted.has(e.code.toLowerCase()));
    const skippedDeleted = parsed.entries.length - loaded.length;
    const parentIds = await findParentIds(tx, parsed, deleted, fileName);

    let inserted = 0;
    for (const batch of chunks(loaded, BATCH_SIZE)) {
      const rows = batch.map((e) => ({
        dictionaryId,
        code: e.code,
        parentEntryId: e.parent === null ? null : (parentIds.get(e.parent.toLowerCase()) ?? null),
        // «Обязательное» — признак типов сертификатов и документов (ADM-09); у остальных он пуст.
        mandatory: mandatoryAllowed ? (e.mandatory ?? false) : null,
        customNameAllowed: e.customNameAllowed,
        sortOrder: e.sortOrder,
      }));
      const added = await tx
        .insert(dictionaryEntry)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: dictionaryEntry.id });
      inserted += added.length;
    }

    // Идентификаторы всех значений файла — и вставленных сейчас, и существовавших (код без учёта регистра).
    const stored = await tx
      .select({ id: dictionaryEntry.id, code: dictionaryEntry.code })
      .from(dictionaryEntry)
      .where(eq(dictionaryEntry.dictionaryId, dictionaryId));
    const idByCode = new Map(stored.map((r) => [r.code.toLowerCase(), r.id]));

    const translations = loaded.flatMap((e) => {
      const id = idByCode.get(e.code.toLowerCase());
      if (id === undefined) throw new Error(`Значение справочника ${parsed.dictionary} не найдено после вставки`);
      return LOCALES.flatMap((language) => {
        const name = e.names[language];
        return name === undefined ? [] : [{ dictionaryEntryId: id, language, name }];
      });
    });
    let translationsAdded = 0;
    for (const batch of chunks(translations, BATCH_SIZE)) {
      const added = await tx
        .insert(dictionaryEntryTranslation)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: dictionaryEntryTranslation.dictionaryEntryId });
      translationsAdded += added.length;
    }

    // Повтор без изменений записи в журнале не оставляет (AUD-01); пропущенные удалённые — только в итоге.
    if (inserted + translationsAdded > 0)
      await tx.insert(auditEntries).values({
        action: 'reference.loaded',
        objectType: 'dictionary',
        objectId: parsed.dictionary,
        diff: { inserted, translationsAdded },
        isAccountEvent: false,
      });
    return { dictionary: parsed.dictionary, inserted, translationsAdded, skippedDeleted };
  });
}

/**
 * Коды значений справочника, которые удалял администратор (DATA-04), в нижнем регистре: запись аудита
 * `dictionary.entry_deleted` хранит справочник и прежний код (`diff: { dictionary, code, names }`). Одно чтение
 * на файл; у роли приложения на журнал аудита есть SELECT. Фильтр `object_type` идёт по индексу
 * `audit_entries_object_idx`.
 */
async function deletedCodes(tx: Executor, code: DictionaryCode): Promise<Set<string>> {
  const rows = await tx
    .select({ code: sql<string | null>`${auditEntries.diff} ->> 'code'` })
    .from(auditEntries)
    .where(
      and(
        eq(auditEntries.objectType, 'dictionary_entry'),
        eq(auditEntries.action, 'dictionary.entry_deleted'),
        sql`${auditEntries.diff} ->> 'dictionary' = ${code}`,
      ),
    );
  return new Set(rows.flatMap((r) => (r.code === null ? [] : [r.code.toLowerCase()])));
}

/** Строка справочника — данные миграции 0010; загрузчик её не создаёт. */
async function findDictionaryId(tx: Executor, code: DictionaryCode, fileName: string): Promise<string> {
  const [row] = await tx.select({ id: dictionary.id }).from(dictionary).where(eq(dictionary.code, code));
  if (!row) throw new ReferenceFileError(fileName, 'справочника нет в базе: миграция 0010 не применена');
  return row.id;
}

/**
 * Идентификаторы родительских значений по коду без учёта регистра; ненайденный родитель загружаемого значения —
 * ошибка файла. Значения с удалёнными кодами (`deleted`) не загружаются, их родитель не проверяется.
 */
async function findParentIds(
  tx: Executor,
  file: ReferenceFile,
  deleted: ReadonlySet<string>,
  fileName: string,
): Promise<Map<string, string>> {
  const parentCode = DICTIONARY_PARENT[file.dictionary];
  const ids = new Map<string, string>();
  const needsParent = (e: ReferenceFile['entries'][number]) => e.parent !== null && !deleted.has(e.code.toLowerCase());
  if (parentCode === undefined || !file.entries.some(needsParent)) return ids;
  const rows = await tx
    .select({ id: dictionaryEntry.id, code: dictionaryEntry.code })
    .from(dictionaryEntry)
    .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
    .where(eq(dictionary.code, parentCode));
  for (const r of rows) ids.set(r.code.toLowerCase(), r.id);
  for (const [i, entry] of file.entries.entries())
    if (needsParent(entry) && !ids.has(entry.parent!.toLowerCase()))
      throw new ReferenceFileError(fileName, `запись ${i + 1}: родитель не найден в справочнике ${parentCode}`);
  return ids;
}

/**
 * Загружает все `*.json` каталога в порядке `DICTIONARY_CODES` (родительский справочник раньше дочернего,
 * затем по имени файла). Сначала все файлы читаются, разбираются и проверяются без базы: ошибка этих проверок
 * в любом файле останавливает загрузку до первой записи в базу. Каждый файл грузится в своей транзакции,
 * поэтому ошибка базы на втором файле (родитель не найден, справочника нет, сбой соединения) оставляет первый
 * загруженным; загрузка идемпотентна, и следующий запуск `migrate` или `seed` догрузит остальное.
 */
export async function loadReferenceDirectory(
  db: Database,
  dir: string,
  expect: ReferenceExpect,
): Promise<ReferenceLoadResult[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const files: { name: string; file: ReferenceFile }[] = [];
  for (const name of names) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new ReferenceFileError(name, 'не JSON');
    }
    const file = parseReferenceFile(raw, name);
    checkReferenceFile(file, expect, name);
    files.push({ name, file });
  }
  files.sort((a, b) => DICTIONARY_CODES.indexOf(a.file.dictionary) - DICTIONARY_CODES.indexOf(b.file.dictionary));

  const results: ReferenceLoadResult[] = [];
  for (const { name, file } of files) results.push(await loadReferenceFile(db, file, expect, name));
  return results;
}
