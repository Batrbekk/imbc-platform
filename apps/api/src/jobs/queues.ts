import type { Queue, QueueOptions } from 'pg-boss';

/**
 * Очереди pg-boss (ADR-06). Ставит задания API, выполняет worker.
 * Время расписаний — Asia/Almaty (GEN-30): в коде нигде не используется часовой пояс сервера.
 */
export const QUEUES = {
  fileScan: 'file-scan',
  fileScanSweep: 'file-scan-sweep',
  sendNotification: 'send-notification',
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
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const PLATFORM_TZ = 'Asia/Almaty';

/** Расписания (раздел 12 спецификации, архитектура §8). */
export const SCHEDULES: ReadonlyArray<{ queue: QueueName; cron: string; note: string }> = [
  { queue: QUEUES.certificateExpiry, cron: '30 0 * * *', note: 'истечение сертификатов (REV-20)' },
  { queue: QUEUES.purgeExportFiles, cron: '0 1 * * *', note: 'удаление файлов выгрузок старше 90 дней (OPR-23)' },
  {
    queue: QUEUES.accountInactivity,
    cron: '0 2 * * *',
    note: 'три месяца без входа → inactive и ссылка сброса (AUTH-07, NOT-26)',
  },
  { queue: QUEUES.updateStatus, cron: '0 9 * * *', note: 'квартальный цикл актуализации (UPD-01…05)' },
  { queue: QUEUES.runSubscriptions, cron: '0 6 * * *', note: 'подписки на выгрузки (OPR-20)' },
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

export interface SendNotificationJob {
  /** Код события из каталога уведомлений (раздел 9), например NOT-11. */
  code: string;
  /** Ключ идемпотентности: одно письмо на событие и адрес (NOT-20). */
  dedupeKey: string;
  to: string;
  locale: string;
  subject: string;
  text: string;
  html?: string;
}

export interface IdentityJob {
  subject: string;
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
