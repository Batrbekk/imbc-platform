import type { FilePurpose } from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { isUuid } from '../common/actor-transaction.js';
import { AuditService } from '../common/audit.service.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../database/database.module.js';
import { fileObject, fileVersion } from '../database/schema/index.js';
import { QUEUE } from '../infra/infra.module.js';
import { type FileScanJobData, QUEUES } from '../jobs/queues.js';
import { ANTIVIRUS, type Antivirus } from '../modules/files/antivirus.js';
import { OBJECT_STORAGE, type ObjectStorage, storageFailureSummary } from '../modules/files/object-storage.js';

/**
 * Действие назначения после прохождения скана — в транзакции перехода версии в `passed` (например, образец
 * оргструктуры становится текущим, задача 5). Сбой — откат перехода и повтор задания.
 */
export type ScanPassedHook = (
  tx: Database,
  version: { id: string; fileObjectId: string; purpose: FilePurpose },
) => Promise<void>;

/** Провайдер `Partial<Record<FilePurpose, ScanPassedHook>>` в WorkerModule. */
export const SCAN_PASSED_HOOKS = Symbol('SCAN_PASSED_HOOKS');

/** Версия ждёт скана дольше этого — зачистка снова ставит её в `file-scan` (DATA-07). */
export const SCAN_STALE_MS = 15 * 60_000;
const SWEEP_BATCH = 500;

/**
 * Проверка файла ClamAV (DATA-07): версия `pending` читается из карантина и передаётся в антивирус.
 * Чистая — копия в рабочий бакет, затем транзакция `passed` (`scanned_at`, хук назначения), затем удаление из
 * карантина. Найдена сигнатура — транзакция `rejected` с аудитом `file.scan_rejected`, затем удаление. Ответ
 * clamd, кроме OK и FOUND, и сбой хранилища — исключение: повтор pg-boss, версия остаётся `pending` и никому не
 * открывается. Переход — только из `pending` (условие UPDATE): повтор и параллельное задание ничего не удваивают.
 */
@Injectable()
export class FileScanJob {
  private readonly logger = new Logger(FileScanJob.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ANTIVIRUS) private readonly antivirus: Antivirus,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    @Inject(QUEUE) private readonly queue: PgBoss,
    @Inject(SCAN_PASSED_HOOKS) private readonly hooks: Partial<Record<FilePurpose, ScanPassedHook>>,
  ) {}

  async run({ fileVersionId }: FileScanJobData): Promise<'passed' | 'rejected' | 'skipped'> {
    if (typeof fileVersionId !== 'string' || !isUuid(fileVersionId)) return 'skipped';
    const [version] = await this.db
      .select({
        id: fileVersion.id,
        fileObjectId: fileVersion.fileObjectId,
        scanState: fileVersion.scanState,
        storageKey: fileVersion.storageKey,
        uploadedBy: fileVersion.uploadedBy,
        purpose: fileObject.purpose,
        organizationId: fileObject.organizationId,
      })
      .from(fileVersion)
      .innerJoin(fileObject, eq(fileObject.id, fileVersion.fileObjectId))
      .where(eq(fileVersion.id, fileVersionId));
    if (!version || version.scanState !== 'pending') return 'skipped';

    const quarantine = this.env.S3_BUCKET_QUARANTINE;
    const body = await this.storage.get(quarantine, version.storageKey);
    let verdict: Awaited<ReturnType<Antivirus['scan']>>;
    try {
      verdict = await this.antivirus.scan(body);
    } finally {
      body.destroy();
    }

    const pendingVersion = and(eq(fileVersion.id, version.id), eq(fileVersion.scanState, 'pending'));
    let result: 'passed' | 'rejected' | 'skipped';
    if (verdict.clean === true) {
      // Копия до перехода: `passed` без байтов в рабочем бакете не бывает. Повтор копирует тот же объект.
      await this.storage.copy(quarantine, version.storageKey, this.env.S3_BUCKET_FILES);
      result = await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(fileVersion)
          .set({ scanState: 'passed', scannedAt: sql`now()` })
          .where(pendingVersion)
          .returning({ id: fileVersion.id });
        if (!updated.length) return 'skipped';
        await this.hooks[version.purpose]?.(tx, {
          id: version.id,
          fileObjectId: version.fileObjectId,
          purpose: version.purpose,
        });
        return 'passed';
      });
    } else {
      result = await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(fileVersion)
          .set({ scanState: 'rejected', scannedAt: sql`now()` })
          .where(pendingVersion)
          .returning({ id: fileVersion.id });
        if (!updated.length) return 'skipped';
        await this.audit.record(
          {
            userId: version.uploadedBy,
            organizationId: version.organizationId,
            action: 'file.scan_rejected',
            objectType: 'file_version',
            objectId: version.id,
            outcome: 'denied',
            diff: { signature: verdict.signature },
          },
          tx,
        );
        return 'rejected';
      });
    }
    // Решение зафиксировано: копия карантина больше не нужна. У отклонённой версии удаляется и копия рабочего
    // бакета, если её оставила прежняя попытка (чистый скан, сбой транзакции, повтор с новыми сигнатурами).
    await this.discard(quarantine, version.id, version.storageKey);
    if (result === 'rejected') await this.discard(this.env.S3_BUCKET_FILES, version.id, version.storageKey);
    return result;
  }

  /**
   * Сбой удаления не отменяет решения — предупреждение без ключа: объект карантина не читает никто (скачивание идёт
   * только из рабочего бакета и только версии `passed`).
   */
  private async discard(bucket: string, fileVersionId: string, storageKey: string): Promise<void> {
    try {
      await this.storage.remove(bucket, storageKey);
    } catch (error) {
      this.logger.warn({ fileVersionId, ...storageFailureSummary(error) }, 'File scan: object not removed');
    }
  }

  /**
   * Зачистка зависших (DATA-07): версии `pending`, загруженные раньше `now − 15 мин`, — снова в `file-scan`
   * (задание потеряно, исчерпало повторы или worker лежал). Очередь `exclusive`: версия, задание которой ещё
   * в очереди или в работе, второго не получает. `now` — параметром (DATA-08).
   */
  async sweep(now: Date = new Date()): Promise<{ requeued: number }> {
    const stale = await this.db
      .select({ id: fileVersion.id })
      .from(fileVersion)
      .where(
        and(eq(fileVersion.scanState, 'pending'), lt(fileVersion.uploadedAt, new Date(now.getTime() - SCAN_STALE_MS))),
      )
      .orderBy(asc(fileVersion.uploadedAt))
      .limit(SWEEP_BATCH);
    let requeued = 0;
    for (const { id } of stale) {
      const job = await this.queue.send(QUEUES.fileScan, { fileVersionId: id } satisfies FileScanJobData, {
        singletonKey: id,
      });
      if (job) requeued++;
    }
    if (requeued) this.logger.log(`file-scan: снова в очереди ${requeued}`);
    return { requeued };
  }
}
