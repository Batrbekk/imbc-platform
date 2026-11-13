import { can, type Role } from '@imbc/contracts';
import { Logger } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { auditEntries, orgChartSample } from '../../database/schema/index.js';
import type { ScanPassedHook } from '../../worker/file-scan.job.js';
import type { FileReadRule } from './file-access.js';

/*
 * Правила образца оргструктуры без зависимостей API-сервиса: их подключают `FILE_READ_RULES` (чтение файла) и
 * worker (`SCAN_PASSED_HOOKS`), а маршруты образца берут отсюда `orgChartSampleAccess`.
 */

/** Доступ к образцам: `any` — любой образец, `current` — только текущий, `null` — никакой. */
export type OrgChartSampleAccess = 'any' | 'current' | null;

/**
 * Кто читает образцы (ADM-11, MAN-19, расхождение 2 плана этапа 2): роли с `reference.read` (администратор,
 * директор) — любой образец; роль, у которой `profile.edit` равен `own` (производитель), — только текущий; SME,
 * оператор и наблюдатель — никакой. Одна функция для правила чтения файла и маршрутов текущего образца.
 */
export function orgChartSampleAccess(role: Role): OrgChartSampleAccess {
  if (can(role, 'reference.read')) return 'any';
  if (can(role, 'profile.edit') === 'own') return 'current';
  return null;
}

/**
 * Право на файл образца (GEN-09): `any` — да; `current` — только если строка `org_chart_sample` этого файла
 * текущая. Прежний образец, образец на проверке и отклонённый производителю закрыты; состояние скана версии
 * проверяет затем `FilesService` (DATA-07).
 */
export const orgChartSampleReadRule: FileReadRule = async ({ tx, auth, file }) => {
  const access = orgChartSampleAccess(auth.user.role);
  if (access === 'any') return true;
  if (access !== 'current') return false;
  const [sample] = await tx
    .select({ isCurrent: orgChartSample.isCurrent })
    .from(orgChartSample)
    .where(eq(orgChartSample.fileObjectId, file.id));
  return sample?.isCurrent === true;
};

const logger = new Logger('OrgChartSample');

/**
 * Хук скана образца (DATA-07, расхождение 13 плана этапа 2) — в транзакции перехода версии в `passed`. Все строки
 * `org_chart_sample` берутся `for update` в порядке id: хуки двух сканов идут по очереди, второй видит итог
 * первого. Образец этого файла становится текущим, только если он загружен позже текущего — по `uploaded_at`
 * (сравнение в SQL, с микросекундами), при равенстве по id — или если текущего нет; прежний текущий получает
 * `is_current = false` и остаётся строкой истории. Порядок «снять, затем поставить» — частичный уникальный индекс
 * `org_chart_sample_current_uq` не откладывается.
 *
 * Смена текущего — запись аудита `org_chart_sample.current_changed` в той же транзакции (AUD-01, смена
 * состояния): `diff: { from, to }` — id файловых объектов прежнего и нового текущего (`from` — null, если
 * текущего не было), без исполнителя — это действие системы после скана. Без смены записи нет.
 */
export const orgChartSamplePassed: ScanPassedHook = async (tx, version) => {
  const samples = await tx
    .select({ id: orgChartSample.id, fileObjectId: orgChartSample.fileObjectId, isCurrent: orgChartSample.isCurrent })
    .from(orgChartSample)
    .orderBy(asc(orgChartSample.id))
    .for('update');
  const sample = samples.find((s) => s.fileObjectId === version.fileObjectId);
  if (!sample) {
    // Строку образца и файл пишет одна транзакция загрузки; файл без строки текущим не становится.
    logger.warn({ fileVersionId: version.id }, 'Organisation chart sample row not found after scan');
    return;
  }
  if (sample.isCurrent) return;
  // Строки взяты for update: прежний текущий — прочитанный выше, другая транзакция его до фиксации не изменит.
  const previous = samples.find((s) => s.isCurrent) ?? null;
  await tx.execute(sql`
    update org_chart_sample c set is_current = false
      from org_chart_sample s
     where s.id = ${sample.id} and c.is_current and (c.uploaded_at, c.id) < (s.uploaded_at, s.id)`);
  const [changed] = await tx
    .update(orgChartSample)
    .set({ isCurrent: true })
    .where(and(eq(orgChartSample.id, sample.id), sql`not exists (select 1 from org_chart_sample c where c.is_current)`))
    .returning({ id: orgChartSample.id });
  if (!changed) return;
  await tx.insert(auditEntries).values({
    action: 'org_chart_sample.current_changed',
    objectType: 'org_chart_sample',
    objectId: sample.id,
    diff: { from: previous?.fileObjectId ?? null, to: sample.fileObjectId },
    isAccountEvent: false,
  });
};
