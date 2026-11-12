/**
 * Квота Adata (IMBC-07): один БИН — один запрос из 3 000 в месяц. Счётчик периода — наша защита,
 * не остаток Adata: token-info не читается.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { PLATFORM_TZ } from '../../jobs/queues.js';

/** IMBC-07: «resets on 4 December 2026». Допущение: сброс ежемесячно 4-го числа. */
export const ADATA_ALLOWANCE_RESET_DAY = 4;

const almatyDate = new Intl.DateTimeFormat('en-US', {
  timeZone: PLATFORM_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** Начало периода `YYYY-MM-DD` по Asia/Almaty (DATA-08): 4-е этого месяца с 4-го числа, иначе 4-е предыдущего. */
export function allowancePeriodStart(at: Date): string {
  const part = (type: 'year' | 'month' | 'day') =>
    Number(almatyDate.formatToParts(at).find((p) => p.type === type)!.value);
  let year = part('year');
  let month = part('month');
  if (part('day') < ADATA_ALLOWANCE_RESET_DAY) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(ADATA_ALLOWANCE_RESET_DAY).padStart(2, '0')}`;
}

/** Атомарный резерв единицы квоты периода: true — единица взята. При limit <= 0 — false без записи. */
export async function reserveAllowance(tx: Pick<Database, 'execute'>, period: string, limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const result = await tx.execute(sql`
    insert into adata_allowance (period_start, used) values (${period}, 1)
    on conflict (period_start) do update set used = adata_allowance.used + 1, updated_at = now()
    where adata_allowance.used < ${limit}
    returning used`);
  return result.rows.length > 0;
}
