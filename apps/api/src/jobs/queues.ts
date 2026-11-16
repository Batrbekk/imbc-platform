import { Logger } from '@nestjs/common';
import type { JobWithMetadata, PgBoss, Queue, QueueOptions } from 'pg-boss';

/**
 * Очереди pg-boss (ADR-06). Ставит задания API, выполняет worker.
 * Время расписаний — Asia/Almaty (GEN-30): в коде нигде не используется часовой пояс сервера.
 */
export const QUEUES = {
  fileScan: 'file-scan',
  fileScanSweep: 'file-scan-sweep',
  fileCleanup: 'file-cleanup',
  fileCleanupSweep: 'file-cleanup-sweep',
  notify: 'notify',
  sendPasswordEmail: 'send-password-email',
  cleanupIdentity: 'cleanup-identity',
  refreshCatalog: 'refresh-catalog',
  buildExport: 'build-export',
  certificateExpiry: 'certificate-expiry',
  updateStatus: 'update-status',
  accountInactivity: 'account-inactivity',
  purgeExportFiles: 'purge-export-files',
  purgeSessions: 'purge-sessions',
  keycloakEvents: 'keycloak-events',
  activitySnapshotWeekly: 'activity-snapshot-weekly',
  activitySnapshotMonthly: 'activity-snapshot-monthly',
  runSubscriptions: 'run-subscriptions',
  adataPrefill: 'adata-prefill',
  identitySync: 'identity-sync',
  inactivityReset: 'inactivity-reset',
  eOndirisDaily: 'eondiris-daily-copy',
  eOndirisProfileRefresh: 'eondiris-profile-refresh',
  mainSourceRefresh: 'main-source-refresh',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Очереди этапа 1, которые этап 2 заменил на `file-scan` и `notify`: обработчиков у них нет, строки остались в
 * `pgboss.queue`. Убирает их worker при старте (`retireQueues`, contract этапа 2, NFR-06).
 */
export const RETIRED_QUEUES = ['scan-file', 'send-notification'] as const;

/** Задание, которое ещё может выполниться: такое не удаляется вместе с очередью. */
const LIVE_JOB_STATES: ReadonlySet<JobWithMetadata['state']> = new Set(['created', 'retry', 'active']);
const FIND_PAGE = 1000;
const queuesLogger = new Logger('Queues');

async function liveJobCount(boss: PgBoss, name: string): Promise<number> {
  let live = 0;
  let after: string | undefined;
  for (;;) {
    const page = await boss.findJobs(name, { limit: FIND_PAGE, ...(after === undefined ? {} : { after }) });
    live += page.filter((job) => LIVE_JOB_STATES.has(job.state)).length;
    if (page.length < FIND_PAGE) return live;
    after = page.at(-1)!.id;
  }
}

/**
 * Удаляет очереди `RETIRED_QUEUES` (`boss.deleteQueue` — вместе с завершёнными и упавшими заданиями), но только
 * существующую (`getQueue`) и без заданий `created`, `retry`, `active`. Очередь с таким заданием остаётся в `kept`
 * с предупреждением: имя очереди и число заданий, без их данных. Нет очереди — ничего не делается, поэтому повтор
 * при каждом старте безопасен. В эти очереди не ставит задания ни одна версия начиная с этапа 2.
 *
 * В `deleted` — только очередь, которая была в базе непосредственно перед `deleteQueue` и которой нет после неё:
 * `deleteQueue` исчезнувшей очереди — пустая операция без ошибки (например, её удалил другой процесс), и в журнал
 * такая очередь не попадает. Вызывает один процесс — worker (`InfraModule`); остаётся окно между последней
 * проверкой и удалением, в котором два worker, стартующих одновременно, оба назовут очередь удалённой.
 */
export async function retireQueues(boss: PgBoss): Promise<{ deleted: string[]; kept: string[] }> {
  const deleted: string[] = [];
  const kept: string[] = [];
  for (const name of RETIRED_QUEUES) {
    if (!(await boss.getQueue(name))) continue;
    const live = await liveJobCount(boss, name);
    if (live > 0) {
      kept.push(name);
      queuesLogger.warn(`retired queue kept: ${name} has ${live} jobs in created, retry or active`);
      continue;
    }
    // Счёт заданий кэширует очередь в pg-boss; существование перед удалением — заново из базы.
    if (!(await boss.getQueue(name))) continue;
    await boss.deleteQueue(name);
    if (!(await boss.getQueue(name))) deleted.push(name);
  }
  if (deleted.length > 0) queuesLogger.log(`retired queues: ${deleted.join(', ')}`);
  return { deleted, kept };
}

export const PLATFORM_TZ = 'Asia/Almaty';

/** Расписания (раздел 12 спецификации, архитектура §8). */
export const SCHEDULES: ReadonlyArray<{ queue: QueueName; cron: string; note: string }> = [
  { queue: QUEUES.fileCleanupSweep, cron: '0 3 * * *', note: 'unused manufacturer uploads older than 30 days' },
  { queue: QUEUES.certificateExpiry, cron: '30 0 * * *', note: 'истечение сертификатов (REV-20)' },
  { queue: QUEUES.purgeExportFiles, cron: '0 1 * * *', note: 'удаление файлов выгрузок старше 90 дней (OPR-23)' },
  {
    queue: QUEUES.accountInactivity,
    cron: '0 2 * * *',
    note: 'три месяца без входа → inactive и ссылка сброса (AUTH-07, NOT-26)',
  },
  { queue: QUEUES.updateStatus, cron: '0 9 * * *', note: 'квартальный цикл актуализации (UPD-01…05)' },
  {
    queue: QUEUES.eOndirisDaily,
    cron: '0 4 * * *',
    note: 'суточная локальная копия e-Ondiris; при неподтверждённом транспорте explicit disabled (EXT-02)',
  },
  {
    queue: QUEUES.eOndirisProfileRefresh,
    cron: '* * * * *',
    note: 'атомарный outbox source-COW и повтор после завершения активного рассмотрения (MAN-25)',
  },
  { queue: QUEUES.runSubscriptions, cron: '0 6 * * *', note: 'подписки на выгрузки (OPR-20)' },
  {
    queue: QUEUES.mainSourceRefresh,
    cron: '* * * * *',
    note: 'локальная source-COW ревизия Main после Adata результата, с сохранением правок производителя (MAN-06–08)',
  },
  { queue: QUEUES.purgeSessions, cron: '15 * * * *', note: 'просроченные сеансы, коды и доверенные устройства' },
  {
    queue: QUEUES.keycloakEvents,
    cron: '* * * * *',
    note: 'блокировки входа из Keycloak → письмо NOT-03 и аудит (AUTH-04)',
  },
  { queue: QUEUES.activitySnapshotWeekly, cron: '0 3 * * 1', note: 'снимок активности за неделю (OPR-74)' },
  { queue: QUEUES.activitySnapshotMonthly, cron: '0 3 1 * *', note: 'снимок активности за месяц (OPR-74)' },
  {
    queue: QUEUES.fileScanSweep,
    cron: '*/15 * * * *',
    note: 'файлы, ждущие скана дольше 15 минут, — снова в file-scan (DATA-07)',
  },
];

/**
 * Проверка версии файла ClamAV и перенос из карантина (DATA-07). Ни имени, ни ключа объекта в задании — только
 * id версии: строка задания хранится в pg-boss (NFR-11).
 */
export interface FileScanJobData {
  fileVersionId: string;
}

export interface FileCleanupJobData {
  fileObjectId: string;
}
export const FILE_CLEANUP_QUEUE_OPTIONS = {
  policy: 'exclusive',
  retryLimit: 10,
  retryDelay: 60,
  retryBackoff: true,
} satisfies Omit<Queue, 'name'>;

/**
 * Очередь `file-scan` создают API (ставит задание в транзакции загрузки) и worker — с одними параметрами.
 * `exclusive` с ключом — id версии: одно задание версии в очереди или в работе, зачистка не плодит повторов.
 */
export const FILE_SCAN_QUEUE_OPTIONS = {
  policy: 'exclusive',
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
} satisfies Omit<Queue, 'name'>;

/**
 * Письма событий (раздел 8.2): задание — `NotifyJob` (`notifications/enqueue.ts`), без адресов. Очередь
 * создают API (ставит задание в транзакции события) и worker — с одними параметрами. Повтор после сбоя SMTP
 * отправляет только неотправленное: журнал `notification` держит одно письмо на событие и адрес (NOT-18).
 */
export const NOTIFY_QUEUE_OPTIONS = {
  retryLimit: 10,
  retryDelay: 30,
  retryBackoff: true,
} satisfies Omit<Queue, 'name'>;

export interface IdentityJob {
  subject: string;
  /** MAN-02 retry: re-check unfinished initial password setup at delivery, never turn it into a reset. */
  initialOnly?: boolean;
}

/**
 * Keycloak догоняет строку аккаунта после действия администратора (ADM-02, ADM-05, AUTH-06): включён,
 * если не blocked, почта — из БД, `logout` завершает сеансы IdP. Почты в задании нет — только id.
 */
export interface IdentitySyncJob {
  accountId: string;
  logout: boolean;
}

/** Аккаунт, ставший inactive (AUTH-07): письмо NOT-01 ссылкой сброса. Почты в задании нет — только id. */
export interface AccountJob {
  accountId: string;
}

export interface RefreshCatalogJob {
  profileId: string;
}

/** Одно чтение Adata для попытки (IMBC-07). Ни БИН, ни токена в задании: строка задания хранится в pg-boss. */
export interface AdataPrefillJob {
  attemptId: string;
}

/** Срок задания больше срока опроса (120 с + запрос): живое задание не повторяется параллельно. */
export const ADATA_QUEUE_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 300,
} satisfies QueueOptions;
