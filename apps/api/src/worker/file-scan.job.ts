import { createHash } from 'node:crypto';
import { pipeline, type Readable, Transform } from 'node:stream';
import type { FilePurpose } from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { isUuid } from '../common/actor-transaction.js';
import { AuditService } from '../common/audit.service.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../database/database.module.js';
import { boundLockWaits } from '../database/lock-waits.js';
import { fileObject, fileVersion } from '../database/schema/index.js';
import { QUEUE } from '../infra/infra.module.js';
import { type FileScanJobData, QUEUES } from '../jobs/queues.js';
import { ANTIVIRUS, type Antivirus } from '../modules/files/antivirus.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  ObjectStorageError,
  storageFailureSummary,
} from '../modules/files/object-storage.js';
import type { ScanVerdict } from './clamd.js';

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

/** Сигнатура окончательного отказа, когда объекта версии нет в карантине: проверять нечего (DATA-07). */
export const OBJECT_MISSING_SIGNATURE = 'object_missing';
/** Сигнатура окончательного отказа, когда байты карантина не совпадают с sha256 загрузки (DATA-05, DATA-07). */
export const CHECKSUM_MISMATCH_SIGNATURE = 'checksum_mismatch';

type ScanVersion = {
  id: string;
  fileObjectId: string;
  storageKey: string;
  checksum: string;
  uploadedAt: Date;
  uploadedBy: string | null;
  purpose: FilePurpose;
  organizationId: string | null;
};

/**
 * Проверка файла ClamAV (DATA-07): версия `pending` читается из карантина и передаётся в антивирус, по тому же
 * потоку считается sha256 — байты должны совпасть с `file_version.checksum` загрузки. Чистая — копия в рабочий
 * бакет, затем транзакция `passed` (`scanned_at`, хук назначения), затем удаление из карантина. Найдена сигнатура —
 * транзакция `rejected` с аудитом `file.scan_rejected`, затем удаление.
 *
 * Объекта в карантине нет (`NoSuchKey`) или sha256 не совпала — одно правило по возрасту версии: пока она
 * загружена не раньше `now − SCAN_STALE_MS`, это ошибка задания (повтор: временная путаница хранилища не
 * отклоняет файлы разом); старше — окончательный `rejected` с сигнатурой `object_missing` или
 * `checksum_mismatch`, иначе версия ждала бы вечно и занимала место в пачке зачистки. Ответ clamd, кроме OK и
 * FOUND, прочие сбои хранилища и ожидание блокировки сверх `boundLockWaits` — исключение: повтор pg-boss, версия
 * остаётся `pending` и никому не открывается. Переход — только из `pending` (условие UPDATE): повтор и параллельное
 * задание ничего не удваивают.
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

  /** `now` — момент запуска для правила возраста версии; worker вызывает без аргумента, тесты — с датой (DATA-08). */
  async run({ fileVersionId }: FileScanJobData, now: Date = new Date()): Promise<'passed' | 'rejected' | 'skipped'> {
    if (typeof fileVersionId !== 'string' || !isUuid(fileVersionId)) return 'skipped';
    const [row] = await this.db
      .select({
        id: fileVersion.id,
        fileObjectId: fileVersion.fileObjectId,
        scanState: fileVersion.scanState,
        storageKey: fileVersion.storageKey,
        checksum: fileVersion.checksum,
        uploadedAt: fileVersion.uploadedAt,
        uploadedBy: fileVersion.uploadedBy,
        purpose: fileObject.purpose,
        organizationId: fileObject.organizationId,
      })
      .from(fileVersion)
      .innerJoin(fileObject, eq(fileObject.id, fileVersion.fileObjectId))
      .where(eq(fileVersion.id, fileVersionId));
    if (!row || row.scanState !== 'pending') return 'skipped';
    const version: ScanVersion = row;
    const quarantine = this.env.S3_BUCKET_QUARANTINE;
    const files = this.env.S3_BUCKET_FILES;

    let body: Readable;
    try {
      body = await this.storage.get(quarantine, version.storageKey);
    } catch (error) {
      if (!(error instanceof ObjectStorageError && error.missing)) throw error;
      // Строка версии есть только после успешного put: объект потерян, проверять нечего.
      return this.unverifiable(version, OBJECT_MISSING_SIGNATURE, now);
    }

    const { verdict, checksum } = await this.scanCounted(body);
    // Байты карантина не те, что приняла загрузка (подмена или порча): вердикт о них ничего не значит.
    if (checksum !== version.checksum) return this.unverifiable(version, CHECKSUM_MISMATCH_SIGNATURE, now);

    // Копия до перехода: `passed` без байтов в рабочем бакете не бывает. Повтор копирует тот же объект.
    if (verdict.clean === true) await this.storage.copy(quarantine, version.storageKey, files);
    const result = await this.decide(version, verdict);
    // Решение зафиксировано: копия карантина больше не нужна. У отклонённой версии удаляется и копия рабочего
    // бакета, если её оставила прежняя попытка (чистый скан, сбой транзакции, повтор с новыми сигнатурами).
    await this.discard(quarantine, version);
    if (result === 'rejected') await this.discard(files, version);
    // Параллельный запуск с другим вердиктом успел раньше: если он отклонил версию, наша копия в рабочем бакете лишняя.
    else if (result === 'skipped' && verdict.clean === true && (await this.stateOf(version.id)) === 'rejected')
      await this.discard(files, version);
    return result;
  }

  /**
   * Проверить байты версии нельзя (`object_missing`, `checksum_mismatch`). Версия моложе `SCAN_STALE_MS` —
   * предупреждение с id версии и ошибка задания (повтор, зачистка); старше — окончательный `rejected` с аудитом
   * `file.scan_rejected` и этой сигнатурой. Ключа объекта и имени файла нет ни в журнале, ни в ошибке.
   */
  private async unverifiable(
    version: ScanVersion,
    signature: typeof OBJECT_MISSING_SIGNATURE | typeof CHECKSUM_MISMATCH_SIGNATURE,
    now: Date,
  ): Promise<'rejected' | 'skipped'> {
    const final = version.uploadedAt.getTime() < now.getTime() - SCAN_STALE_MS;
    this.logger.warn(
      { fileVersionId: version.id, reason: signature, final },
      final ? 'File scan: version cannot be verified, rejected' : 'File scan: version cannot be verified yet, retry',
    );
    if (!final) throw new Error(`file-scan ${version.id}: ${signature}`);
    const result = await this.decide(version, { clean: false, signature });
    if (result === 'rejected') {
      // Непроверенные байты не остаются ни в карантине, ни в рабочем бакете.
      await this.discard(this.env.S3_BUCKET_QUARANTINE, version);
      await this.discard(this.env.S3_BUCKET_FILES, version);
    }
    return result as 'rejected' | 'skipped';
  }

  /**
   * Переход версии из `pending` одной транзакцией с ограниченным ожиданием блокировок (`boundLockWaits`, как
   * `actorTransaction`): хук назначения берёт строки своей записи `for update`. Превышение — ошибка задания и
   * повтор. Версия уже не `pending` — `skipped`.
   */
  private decide(version: ScanVersion, verdict: ScanVerdict): Promise<'passed' | 'rejected' | 'skipped'> {
    return this.db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const state = verdict.clean === true ? 'passed' : 'rejected';
      const updated = await tx
        .update(fileVersion)
        .set({ scanState: state, scannedAt: sql`now()` })
        .where(and(eq(fileVersion.id, version.id), eq(fileVersion.scanState, 'pending')))
        .returning({ id: fileVersion.id });
      if (!updated.length) return 'skipped';
      if (verdict.clean === true) {
        await this.hooks[version.purpose]?.(tx, {
          id: version.id,
          fileObjectId: version.fileObjectId,
          purpose: version.purpose,
        });
      } else {
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
      }
      return state;
    });
  }

  /**
   * Антивирус читает поток через счётчик sha256: проверяются и сверяются одни и те же байты. Ошибка чтения
   * хранилища доходит до антивируса (pipeline разрушает оба потока). Поток, прочитанный не до конца, даёт другую
   * сумму — сверка не пройдёт.
   */
  private async scanCounted(body: Readable): Promise<{ verdict: ScanVerdict; checksum: string }> {
    const hash = createHash('sha256');
    const counted = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    pipeline(body, counted, () => undefined);
    try {
      const verdict = await this.antivirus.scan(counted);
      return { verdict, checksum: hash.digest('hex') };
    } finally {
      body.destroy();
      counted.destroy();
    }
  }

  private async stateOf(id: string) {
    const [row] = await this.db
      .select({ scanState: fileVersion.scanState })
      .from(fileVersion)
      .where(eq(fileVersion.id, id));
    return row?.scanState;
  }

  /**
   * Сбой удаления не отменяет решения — предупреждение без ключа: объект карантина не читает никто (скачивание идёт
   * только из рабочего бакета и только версии `passed`).
   */
  private async discard(bucket: string, version: ScanVersion): Promise<void> {
    try {
      await this.storage.remove(bucket, version.storageKey);
    } catch (error) {
      this.logger.warn({ fileVersionId: version.id, ...storageFailureSummary(error) }, 'File scan: object not removed');
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
