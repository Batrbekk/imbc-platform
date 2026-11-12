/**
 * Общее состояние прототипа кабинетов ролей (`apps/web/src/prototype`): одна строка `default` с
 * документом целиком. Таблицу создаёт задание `migrate` только при `PROTOTYPE_CABINETS=true` — вне
 * журнала миграций Drizzle и схемы `schema/`: слой одноразовый и номер миграции не занимает.
 * Сервер документ не разбирает; любой вошедший пользователь стенда читает и перезаписывает его.
 */
import type pg from 'pg';

type Queryable = Pick<pg.Pool, 'query'>;

const ID = 'default';

/** До выдачи прав роли приложения (`migrate.ts`): GRANT ON ALL TABLES захватывает и эту таблицу. */
export async function createPrototypeTable(db: Queryable): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS prototype_state (
    id text PRIMARY KEY,
    version bigint NOT NULL,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL
  )`);
}

export interface PrototypeStored {
  /** 0 — документа ещё нет. */
  version: number;
  state: object | null;
}

export type PrototypeWriteResult = { ok: true; version: number } | ({ ok: false } & PrototypeStored);

export async function readPrototypeState(db: Queryable): Promise<PrototypeStored> {
  const { rows } = await db.query<{ version: string; state: object }>(
    'SELECT version, state FROM prototype_state WHERE id = $1',
    [ID],
  );
  const row = rows[0];
  return row ? { version: Number(row.version), state: row.state } : { version: 0, state: null };
}

/**
 * Запись поверх `baseVersion`: сравнение и запись одной командой, поэтому из двух записей с одной
 * версией проходит ровно одна. Отказ — текущие версия и документ.
 */
export async function writePrototypeState(
  db: Queryable,
  baseVersion: number,
  state: object,
): Promise<PrototypeWriteResult> {
  const json = JSON.stringify(state);
  const { rows } =
    baseVersion === 0
      ? await db.query<{ version: string }>(
          `INSERT INTO prototype_state (id, version, state, updated_at) VALUES ($1, 1, $2::jsonb, now())
           ON CONFLICT (id) DO NOTHING RETURNING version`,
          [ID, json],
        )
      : await db.query<{ version: string }>(
          `UPDATE prototype_state SET version = version + 1, state = $2::jsonb, updated_at = now()
            WHERE id = $1 AND version = $3 RETURNING version`,
          [ID, json, baseVersion],
        );
  const written = rows[0];
  if (written) return { ok: true, version: Number(written.version) };
  return { ok: false, ...(await readPrototypeState(db)) };
}
