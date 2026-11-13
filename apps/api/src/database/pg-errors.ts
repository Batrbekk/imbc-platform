/** Звенья ошибки по цепочке `cause` (обёртка Drizzle → ошибка pg), не глубже шести. */
function chain(error: unknown): object[] {
  const links: object[] = [];
  let cause: unknown = error;
  for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
    links.push(cause);
    cause = (cause as { cause?: unknown }).cause;
  }
  return links;
}

type PgFields = { code?: unknown; severity?: unknown; routine?: unknown; constraint?: unknown; table?: unknown };

const isPostgresError = (link: object) => {
  const { code, severity, routine } = link as PgFields;
  return typeof code === 'string' && code.length === 5 && (typeof severity === 'string' || typeof routine === 'string');
};
const isDrizzleQueryError = (link: object) => 'query' in link && 'params' in link;

/** Имя ограничения при нарушении уникальности (23505 pg или его обёртка Drizzle), иначе null. */
export function uniqueViolation(error: unknown): string | null {
  for (const link of chain(error)) {
    const { code, constraint } = link as PgFields;
    if (code === '23505') return typeof constraint === 'string' ? constraint : null;
  }
  return null;
}

/**
 * Сводка ошибки базы для журнала и output задания (NFR-11): SQLSTATE, ограничение, таблица, функция
 * PostgreSQL и классы звеньев. Текст, стек, параметры и текст запроса Drizzle, `detail`, `where` и `hint`
 * PostgreSQL несут значения строк (почта, ФИО, БИН, IP) и в сводку не попадают. Не ошибка базы — null.
 */
export function databaseErrorSummary(error: unknown): {
  sqlState: string | null;
  constraint: string | null;
  table: string | null;
  routine: string | null;
  errors: string[];
} | null {
  const links = chain(error);
  if (!links.some((link) => isPostgresError(link) || isDrizzleQueryError(link))) return null;
  const pg = (links.find(isPostgresError) ?? {}) as PgFields;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    sqlState: text(pg.code),
    constraint: text(pg.constraint),
    table: text(pg.table),
    routine: text(pg.routine),
    errors: links.map((link) => link.constructor?.name ?? 'Object'),
  };
}

/**
 * Ошибка базы без данных строк — для того, что сохраняется вне процесса (output задания pg-boss).
 * Другая ошибка возвращается как есть.
 */
export function redactDatabaseError(error: unknown): unknown {
  const summary = databaseErrorSummary(error);
  return summary ? Object.assign(new Error('Unexpected database error'), summary) : error;
}
