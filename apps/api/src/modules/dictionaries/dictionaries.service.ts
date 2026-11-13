import {
  CLOSED_DICTIONARIES,
  type CreateDictionaryEntryInput,
  createDictionaryEntrySchema,
  DICTIONARY_CODE_PATTERNS,
  DICTIONARY_CODES,
  DICTIONARY_PARENT,
  DICTIONARY_SORT_ORDER_MAX,
  type DictionaryChoicesPage,
  dictionaryChoicesPageSchema,
  type DictionaryChoicesQuery,
  dictionaryChoicesQuerySchema,
  type DictionaryCode,
  type DictionaryEntriesPage,
  dictionaryEntriesPageSchema,
  type DictionaryEntriesQuery,
  dictionaryEntriesQuerySchema,
  type DictionaryEntry,
  type DictionaryEntryResult,
  dictionaryEntryResultSchema,
  type DictionaryList,
  dictionaryListSchema,
  type DictionarySummary,
  entryDisplayName,
  LOCALES,
  type Locale,
  MANDATORY_DICTIONARIES,
  type UpdateDictionaryEntryInput,
  updateDictionaryEntrySchema,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { actorTransaction, isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { DB, type Database, PG_POOL } from '../../database/database.module.js';
import { sqlState } from '../../database/lock-waits.js';
import { dictionary, dictionaryEntry, dictionaryEntryTranslation } from '../../database/schema/index.js';
import type { AuthUser } from '../auth/auth.types.js';
import { entryInUse } from './usage.js';

/** Маршруты справочников, как их пишет в аудит отказ SessionGuard (`req.route.path`) и `actorTransaction`. */
export const DICTIONARY_ROUTES = {
  list: '/api/v1/dictionaries',
  /** GET — список администратора, POST — новое значение. */
  entries: '/api/v1/dictionaries/:code/entries',
  choices: '/api/v1/dictionaries/:code/choices',
  /** PUT — правка, DELETE — удаление. */
  entry: '/api/v1/dictionaries/:code/entries/:id',
  mandatory: '/api/v1/dictionaries/:code/entries/:id/mandatory',
  retire: '/api/v1/dictionaries/:code/entries/:id/retire',
  restore: '/api/v1/dictionaries/:code/entries/:id/restore',
} as const;

const entryExists = () => new ProblemException(409, 'entry_exists', 'Значение с таким кодом уже есть в справочнике');
const codeFormat = () => new ProblemException(400, 'code_format', 'Код не соответствует формату справочника');
const parentInvalid = () =>
  new ProblemException(400, 'parent_invalid', 'Родительское значение не найдено или выведено из оборота');
const dictionaryClosed = () =>
  new ProblemException(
    409,
    'dictionary_closed',
    'Значения этого справочника задаёт спецификация: меняются только названия и порядок',
  );
const mandatoryNotApplicable = () =>
  new ProblemException(409, 'mandatory_not_applicable', 'Обязательность есть только у типов сертификатов и документов');
const entryMandatory = () =>
  new ProblemException(409, 'entry_mandatory', 'Обязательное значение нельзя вывести из оборота или удалить');
const entryRetired = () =>
  new ProblemException(409, 'entry_retired', 'Выведенное из оборота значение нельзя сделать обязательным');
const entryUsed = () =>
  new ProblemException(409, 'entry_in_use', 'Значение используется: его можно только вывести из оборота');

const isClosed = (code: DictionaryCode) => (CLOSED_DICTIONARIES as readonly DictionaryCode[]).includes(code);
const isMandatoryApplicable = (code: DictionaryCode) =>
  (MANDATORY_DICTIONARIES as readonly DictionaryCode[]).includes(code);

/** Код справочника из пути; неизвестный — 404, как у отсутствующей записи. */
function known(code: string): DictionaryCode {
  if (!(DICTIONARY_CODES as readonly string[]).includes(code)) throw notFound();
  return code as DictionaryCode;
}

/** `%`, `_` и `\` запроса ищутся буквально: `\` — символ экранирования LIKE по умолчанию. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Условие поиска и порядок совпадений: начало кода без учёта регистра (индекс `dictionary_entry_code_uq` с
 * `text_pattern_ops`) или часть названия на любом языке (`ilike`, триграммный индекс). Сначала точное
 * совпадение кода, затем начало кода, затем совпадение только по названию.
 */
function search(q: string): { where?: SQL; rank: SQL[] } {
  if (q === '') return { rank: [] };
  const like = escapeLike(q);
  const prefix = sql`lower(${dictionaryEntry.code}) like lower(${like}::text) || '%'`;
  return {
    where: sql`(${prefix} or exists (select 1 from ${dictionaryEntryTranslation} t
      where t.dictionary_entry_id = ${dictionaryEntry.id} and t.name ilike '%' || ${like}::text || '%'))`,
    rank: [sql`case when lower(${dictionaryEntry.code}) = lower(${q}::text) then 0 when ${prefix} then 1 else 2 end`],
  };
}

const STATUS: Record<DictionaryEntriesQuery['status'], SQL | undefined> = {
  active: isNull(dictionaryEntry.retiredAt),
  retired: isNotNull(dictionaryEntry.retiredAt),
  all: undefined,
};

const parent = alias(dictionaryEntry, 'parent');

/** Колонки значения для ответа: код родителя и названия по языкам одним jsonb (перевода нет — ключа нет). */
const ENTRY_COLUMNS = {
  id: dictionaryEntry.id,
  code: dictionaryEntry.code,
  parentCode: parent.code,
  mandatory: dictionaryEntry.mandatory,
  customNameAllowed: dictionaryEntry.customNameAllowed,
  sortOrder: dictionaryEntry.sortOrder,
  retiredAt: dictionaryEntry.retiredAt,
  names: sql<Partial<Record<Locale, string>> | null>`(select jsonb_object_agg(t.language, t.name)
    from ${dictionaryEntryTranslation} t where t.dictionary_entry_id = ${dictionaryEntry.id})`,
};

type Names = DictionaryEntry['names'];

const toNames = (stored: Partial<Record<Locale, string>> | null): Names => ({
  kk: stored?.kk ?? null,
  ru: stored?.ru ?? null,
  en: stored?.en ?? null,
});

const sameNames = (a: Names, b: Names) => LOCALES.every((locale) => a[locale] === b[locale]);

type Executor = Pick<Database, 'select'>;

/**
 * Справочники ADM-08: список и поиск с выведенными значениями для `reference.read`, изменения для
 * `reference.manage`, выбор действующих значений для любого вошедшего пользователя. Каждое изменение —
 * `actorTransaction`: исполнитель под блокировкой, строка значения `for no key update`, запись аудита в той
 * же транзакции (AUD-01); повтор без изменения записи не создаёт. IP запроса — только колонка `ip` аудита.
 */
@Injectable()
export class DictionariesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
  ) {}

  /** Двенадцать справочников в порядке ADM-08 со счётчиками действующих и выведенных значений. */
  async list(): Promise<DictionaryList> {
    return parseResponse(dictionaryListSchema, { dictionaries: await this.summaries() }, 'справочники');
  }

  /** Страница значений для администратора и директора: поиск, состояние, порядок — на сервере. */
  async entries(code: string, input: DictionaryEntriesQuery): Promise<DictionaryEntriesPage> {
    const dict = known(code);
    const query = parseOrThrow(dictionaryEntriesQuerySchema, input);
    const { where, rank } = search(query.q);
    const condition = and(
      eq(dictionaryEntry.dictionaryId, await this.dictionaryId(this.db, dict)),
      STATUS[query.status],
      where,
    );
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(dictionaryEntry)
      .leftJoin(parent, eq(parent.id, dictionaryEntry.parentEntryId))
      .where(condition)
      .orderBy(...rank, asc(dictionaryEntry.sortOrder), asc(dictionaryEntry.code))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [summary] = await this.summaries(dict);
    return parseResponse(
      dictionaryEntriesPageSchema,
      {
        dictionary: summary,
        items: rows.map((row) => this.toEntry(row)),
        total: await this.count(condition),
        page: query.page,
        pageSize: query.pageSize,
      },
      'значения справочника',
    );
  }

  /**
   * Выбор значения в формах и фильтрах (MAN-10, MAN-11, MAN-23, OPR-02): только действующие (DATA-04),
   * одно название на языке `lang` с запасным порядком `entryDisplayName`.
   */
  async choices(code: string, input: DictionaryChoicesQuery): Promise<DictionaryChoicesPage> {
    const dict = known(code);
    const query = parseOrThrow(dictionaryChoicesQuerySchema, input);
    const { where, rank } = search(query.q);
    const condition = and(
      eq(dictionaryEntry.dictionaryId, await this.dictionaryId(this.db, dict)),
      isNull(dictionaryEntry.retiredAt),
      where,
    );
    const rows = await this.db
      .select({
        id: ENTRY_COLUMNS.id,
        code: ENTRY_COLUMNS.code,
        parentCode: ENTRY_COLUMNS.parentCode,
        names: ENTRY_COLUMNS.names,
      })
      .from(dictionaryEntry)
      .leftJoin(parent, eq(parent.id, dictionaryEntry.parentEntryId))
      .where(condition)
      .orderBy(...rank, asc(dictionaryEntry.sortOrder), asc(dictionaryEntry.code))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return parseResponse(
      dictionaryChoicesPageSchema,
      {
        items: rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: entryDisplayName(row.names ?? {}, query.lang, row.code),
          parentCode: row.parentCode,
        })),
        total: await this.count(condition),
        page: query.page,
        pageSize: query.pageSize,
      },
      'выбор значения справочника',
    );
  }

  /**
   * Новое значение (ADM-08): код по шаблону справочника (DATA-03), уникален без учёта регистра
   * (`dictionary_entry_code_uq`); названия — три строки перевода (DATA-02); порядок — в конец списка.
   */
  async create(
    actor: AuthUser,
    code: string,
    input: CreateDictionaryEntryInput,
    ip: string | null = null,
  ): Promise<DictionaryEntryResult> {
    const dict = known(code);
    const value = parseOrThrow(createDictionaryEntrySchema, input);
    const entry = await this.mutate(actor, DICTIONARY_ROUTES.entries, ip, async (tx) => {
      if (isClosed(dict)) throw dictionaryClosed();
      if (!DICTIONARY_CODE_PATTERNS[dict].test(value.code)) throw codeFormat();
      if (value.mandatory !== undefined && !isMandatoryApplicable(dict)) throw mandatoryNotApplicable();
      const dictionaryId = await this.dictionaryId(tx, dict);
      const parentEntry = await this.lockParent(tx, dict, value.parentCode);
      const mandatory = isMandatoryApplicable(dict) ? (value.mandatory ?? false) : null;
      // Новое значение — после загруженных (их порядок — с нуля по записи файла); одновременное создание
      // может дать одинаковый порядок — его разводит код.
      const [max] = await tx
        .select({ last: sql<number | null>`max(${dictionaryEntry.sortOrder})` })
        .from(dictionaryEntry)
        .where(eq(dictionaryEntry.dictionaryId, dictionaryId));
      const last = max?.last ?? null;
      const sortOrder = last === null ? 0 : Math.min(last + 1, DICTIONARY_SORT_ORDER_MAX);
      // Тот же код без учёта регистра — ON CONFLICT: параллельный запрос ждёт первый и получает 409.
      const [row] = await tx
        .insert(dictionaryEntry)
        .values({ dictionaryId, code: value.code, parentEntryId: parentEntry?.id ?? null, mandatory, sortOrder })
        .onConflictDoNothing()
        .returning({ id: dictionaryEntry.id });
      if (!row) throw entryExists();
      await tx
        .insert(dictionaryEntryTranslation)
        .values(LOCALES.map((language) => ({ dictionaryEntryId: row.id, language, name: value.names[language] })));
      await this.record(tx, actor, ip, 'dictionary.entry_created', row.id, {
        dictionary: dict,
        code: value.code,
        parentCode: parentEntry?.code ?? null,
        names: value.names,
        mandatory,
      });
      return this.readEntry(tx, row.id);
    });
    return parseResponse(dictionaryEntryResultSchema, { entry }, 'значение справочника');
  }

  /** Названия, порядок и родитель (ADM-08); код неизменяем. Закрытым справочникам — тоже. */
  async update(
    actor: AuthUser,
    code: string,
    id: string,
    input: UpdateDictionaryEntryInput,
    ip: string | null = null,
  ): Promise<DictionaryEntryResult> {
    const dict = known(code);
    if (!isUuid(id)) throw notFound();
    const value = parseOrThrow(updateDictionaryEntrySchema, input);
    const entry = await this.mutate(actor, DICTIONARY_ROUTES.entry, ip, async (tx) => {
      const row = await this.lockEntry(tx, dict, id);
      const before = await this.readEntry(tx, id);
      const parentEntry = await this.lockParent(tx, dict, value.parentCode, row.parentEntryId);
      const from = { names: before.names, sortOrder: before.sortOrder, parentCode: before.parentCode };
      const to = { names: value.names, sortOrder: value.sortOrder, parentCode: parentEntry?.code ?? null };
      if (sameNames(from.names, to.names) && from.sortOrder === to.sortOrder && from.parentCode === to.parentCode)
        return before;
      await tx
        .update(dictionaryEntry)
        .set({ sortOrder: to.sortOrder, parentEntryId: parentEntry?.id ?? null })
        .where(eq(dictionaryEntry.id, id));
      await tx
        .insert(dictionaryEntryTranslation)
        .values(LOCALES.map((language) => ({ dictionaryEntryId: id, language, name: value.names[language] })))
        .onConflictDoUpdate({
          target: [dictionaryEntryTranslation.dictionaryEntryId, dictionaryEntryTranslation.language],
          set: { name: sql`excluded.name` },
        });
      await this.record(tx, actor, ip, 'dictionary.entry_updated', id, { from, to });
      return this.readEntry(tx, id);
    });
    return parseResponse(dictionaryEntryResultSchema, { entry }, 'значение справочника');
  }

  /**
   * Обязательность типа сертификата или документа (ADM-09): меняется только `dictionary_entry.mandatory`;
   * снимок для отправленных профилей — этап 3 (расхождение 9 плана этапа 2). Выведенное — не обязательное.
   */
  async setMandatory(
    actor: AuthUser,
    code: string,
    id: string,
    mandatory: boolean,
    ip: string | null = null,
  ): Promise<DictionaryEntryResult> {
    const dict = known(code);
    if (!isUuid(id)) throw notFound();
    const entry = await this.mutate(actor, DICTIONARY_ROUTES.mandatory, ip, async (tx) => {
      if (!isMandatoryApplicable(dict)) throw mandatoryNotApplicable();
      const row = await this.lockEntry(tx, dict, id);
      if (mandatory && row.retiredAt !== null) throw entryRetired();
      if (row.mandatory !== mandatory) {
        await tx.update(dictionaryEntry).set({ mandatory }).where(eq(dictionaryEntry.id, id));
        await this.record(tx, actor, ip, 'dictionary.entry_mandatory_changed', id, {
          from: row.mandatory,
          to: mandatory,
        });
      }
      return this.readEntry(tx, id);
    });
    return parseResponse(dictionaryEntryResultSchema, { entry }, 'значение справочника');
  }

  /** Вывод из оборота (DATA-04): значение не предлагается для новых записей, но остаётся в данных. */
  async retire(actor: AuthUser, code: string, id: string, ip: string | null = null): Promise<DictionaryEntryResult> {
    const dict = known(code);
    if (!isUuid(id)) throw notFound();
    const entry = await this.mutate(actor, DICTIONARY_ROUTES.retire, ip, async (tx) => {
      if (isClosed(dict)) throw dictionaryClosed();
      const row = await this.lockEntry(tx, dict, id);
      if (row.mandatory === true) throw entryMandatory();
      if (row.retiredAt === null) {
        await tx
          .update(dictionaryEntry)
          .set({ retiredAt: sql`now()` })
          .where(eq(dictionaryEntry.id, id));
        await this.record(tx, actor, ip, 'dictionary.entry_retired', id);
      }
      return this.readEntry(tx, id);
    });
    return parseResponse(dictionaryEntryResultSchema, { entry }, 'значение справочника');
  }

  /** Возврат в оборот (DATA-04). */
  async restore(actor: AuthUser, code: string, id: string, ip: string | null = null): Promise<DictionaryEntryResult> {
    const dict = known(code);
    if (!isUuid(id)) throw notFound();
    const entry = await this.mutate(actor, DICTIONARY_ROUTES.restore, ip, async (tx) => {
      if (isClosed(dict)) throw dictionaryClosed();
      const row = await this.lockEntry(tx, dict, id);
      if (row.retiredAt !== null) {
        await tx.update(dictionaryEntry).set({ retiredAt: null }).where(eq(dictionaryEntry.id, id));
        await this.record(tx, actor, ip, 'dictionary.entry_restored', id);
      }
      return this.readEntry(tx, id);
    });
    return parseResponse(dictionaryEntryResultSchema, { entry }, 'значение справочника');
  }

  /**
   * Удаление (DATA-04): только неиспользуемое и не обязательное значение. Проверки — под блокировкой строки
   * значения, поэтому параллельные обязательность, вывод и второе удаление ждут и перечитывают её. Ссылка
   * внешним ключом (`23503`) — тоже 409. Аудит хранит прежние код и названия (DATA-01); переводы удаляет
   * `ON DELETE CASCADE`.
   */
  async remove(actor: AuthUser, code: string, id: string, ip: string | null = null): Promise<void> {
    const dict = known(code);
    if (!isUuid(id)) throw notFound();
    try {
      await this.mutate(actor, DICTIONARY_ROUTES.entry, ip, async (tx) => {
        if (isClosed(dict)) throw dictionaryClosed();
        const row = await this.lockEntry(tx, dict, id);
        if (row.mandatory === true) throw entryMandatory();
        if (await entryInUse(tx, dict, row.code)) throw entryUsed();
        const { names } = await this.readEntry(tx, id);
        await tx.delete(dictionaryEntry).where(eq(dictionaryEntry.id, id));
        await this.record(tx, actor, ip, 'dictionary.entry_deleted', id, { code: row.code, names });
      });
    } catch (error) {
      if (sqlState(error) === '23503') throw entryUsed();
      throw error;
    }
  }

  /** Изменяющее действие: `actorTransaction` с правом `reference.manage` и путём маршрута для отказа. */
  private mutate<T>(actor: AuthUser, route: string, ip: string | null, run: (tx: Database) => Promise<T>): Promise<T> {
    return actorTransaction(this.pool, this.audit, actor, { route, ip, action: 'reference.manage' }, (tx) => run(tx));
  }

  /** Запись аудита в транзакции действия (AUD-01): не событие аккаунта; IP — только колонка `ip`. */
  private record(tx: Database, actor: AuthUser, ip: string | null, action: string, id: string, diff?: unknown) {
    return this.audit.record(
      {
        userId: actor.id,
        organizationId: actor.organizationId,
        action,
        objectType: 'dictionary_entry',
        objectId: id,
        diff: diff ?? null,
        isAccountEvent: false,
        ip,
      },
      tx,
    );
  }

  /** Строка `dictionary` — данные миграции 0010; её нет только в непромигрированной базе (500). */
  private async dictionaryId(executor: Executor, code: DictionaryCode): Promise<string> {
    const [row] = await executor.select({ id: dictionary.id }).from(dictionary).where(eq(dictionary.code, code));
    if (!row) throw new Error(`Справочника ${code} нет в базе: миграция 0010 не применена`);
    return row.id;
  }

  /**
   * Строка значения этого справочника под `for no key update`; значение другого справочника — 404. Строку
   * `dictionary` не блокирует: у роли приложения на неё только SELECT.
   */
  private async lockEntry(tx: Database, dict: DictionaryCode, id: string) {
    const dictionaryId = await this.dictionaryId(tx, dict);
    const [row] = await tx
      .select({
        id: dictionaryEntry.id,
        code: dictionaryEntry.code,
        parentEntryId: dictionaryEntry.parentEntryId,
        mandatory: dictionaryEntry.mandatory,
        retiredAt: dictionaryEntry.retiredAt,
      })
      .from(dictionaryEntry)
      .where(and(eq(dictionaryEntry.id, id), eq(dictionaryEntry.dictionaryId, dictionaryId)))
      .for('no key update');
    if (!row) throw notFound();
    return row;
  }

  /**
   * Родитель по коду без учёта регистра (расхождение 22 плана этапа 2): только у справочника с
   * `DICTIONARY_PARENT`, действующее значение — иначе 400. `for share` держит его в обороте до конца
   * транзакции. Выведенный родитель допустим, если он уже указан у значения (`current`).
   */
  private async lockParent(
    tx: Database,
    dict: DictionaryCode,
    parentCode: string | null,
    current: string | null = null,
  ) {
    if (parentCode === null) return null;
    const parentDictionary = DICTIONARY_PARENT[dict];
    if (parentDictionary === undefined) throw parentInvalid();
    const parentDictionaryId = await this.dictionaryId(tx, parentDictionary);
    const [row] = await tx
      .select({ id: dictionaryEntry.id, code: dictionaryEntry.code, retiredAt: dictionaryEntry.retiredAt })
      .from(dictionaryEntry)
      .where(
        and(
          eq(dictionaryEntry.dictionaryId, parentDictionaryId),
          sql`lower(${dictionaryEntry.code}) = lower(${parentCode}::text)`,
        ),
      )
      .for('share');
    if (!row || (row.retiredAt !== null && row.id !== current)) throw parentInvalid();
    return { id: row.id, code: row.code };
  }

  private async readEntry(executor: Executor, id: string): Promise<DictionaryEntry> {
    const [row] = await executor
      .select(ENTRY_COLUMNS)
      .from(dictionaryEntry)
      .leftJoin(parent, eq(parent.id, dictionaryEntry.parentEntryId))
      .where(eq(dictionaryEntry.id, id));
    if (!row) throw notFound();
    return this.toEntry(row);
  }

  private toEntry(row: {
    id: string;
    code: string;
    parentCode: string | null;
    mandatory: boolean | null;
    customNameAllowed: boolean;
    sortOrder: number;
    retiredAt: Date | null;
    names: Partial<Record<Locale, string>> | null;
  }): DictionaryEntry {
    return { ...row, names: toNames(row.names), retiredAt: row.retiredAt?.toISOString() ?? null };
  }

  private async count(condition: SQL | undefined): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(dictionaryEntry)
      .where(condition);
    return row!.total;
  }

  /** Справочник с признаками и счётчиками; без кода — все двенадцать в порядке `DICTIONARY_CODES`. */
  private async summaries(code?: DictionaryCode): Promise<DictionarySummary[]> {
    const rows = await this.db
      .select({
        code: dictionary.code,
        active: sql<number>`cast(count(${dictionaryEntry.id}) filter (where ${dictionaryEntry.retiredAt} is null) as int)`,
        retired: sql<number>`cast(count(${dictionaryEntry.id}) filter (where ${dictionaryEntry.retiredAt} is not null) as int)`,
      })
      .from(dictionary)
      .leftJoin(dictionaryEntry, eq(dictionaryEntry.dictionaryId, dictionary.id))
      .where(code === undefined ? undefined : eq(dictionary.code, code))
      .groupBy(dictionary.code);
    const counts = new Map(rows.map((r) => [r.code, r]));
    return (code === undefined ? DICTIONARY_CODES : [code]).map((c) => ({
      code: c,
      closed: isClosed(c),
      mandatoryApplicable: isMandatoryApplicable(c),
      parentDictionary: DICTIONARY_PARENT[c] ?? null,
      active: counts.get(c)?.active ?? 0,
      retired: counts.get(c)?.retired ?? 0,
    }));
  }
}
