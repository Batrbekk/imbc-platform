import type { QueueOptions } from 'pg-boss';

/**
 * Очереди pg-boss (ADR-06). Ставит задания API, выполняет worker.
 * Время расписаний — Asia/Almaty (GEN-30): в коде нигде не используется часовой пояс сервера.
 */
export const QUEUES = {
  scanFile: 'scan-file',
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
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const PLATFORM_TZ = 'Asia/Almaty';

/** Расписания (раздел 12 спецификации, архитектура §8). */
export const SCHEDULES: ReadonlyArray<{ queue: QueueName; cron: string; note: string }> = [
  { queue: QUEUES.certificateExpiry, cron: '30 0 * * *', note: 'истечение сертификатов (REV-20)' },
  { queue: QUEUES.purgeExportFiles, cron: '0 1 * * *', note: 'удаление файлов выгрузок старше 90 дней (OPR-23)' },
  { queue: QUEUES.accountInactivity, cron: '0 2 * * *', note: 'неактивные учётные записи (AUTH-30)' },
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
];

export interface ScanFileJob {
  fileVersionId: string;
}

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
