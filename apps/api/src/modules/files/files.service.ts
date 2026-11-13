import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { DataClass, FilePurpose } from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { ENV, type Env } from '../../config/env.js';
import { DB, type Database } from '../../database/database.module.js';
import { fileObject, fileVersion } from '../../database/schema/index.js';
import type { QueueDb } from '../../database/transaction.js';
import { QUEUE } from '../../infra/infra.module.js';
import { type FileScanJobData, QUEUES } from '../../jobs/queues.js';
import type { AuthContext } from '../auth/auth.types.js';
import { denyAll, FILE_READ_RULES } from './file-access.js';
import { OBJECT_STORAGE, type ObjectStorage, storageFailureSummary as failureSummary } from './object-storage.js';
import type { AcceptedUpload } from './upload.js';

/** Маршруты файлов, как их пишет в аудит отказ SessionGuard (`req.route.path`). */
export const FILE_ROUTES = {
  content: '/api/v1/files/:id/content',
} as const;

const forbidden = () => new ProblemException(403, 'forbidden', 'Нет прав на этот файл');
const pendingScan = () =>
  new ProblemException(409, 'file_pending_scan', 'Файл ещё проверяется на вредоносное содержимое');
const rejectedByScan = () =>
  new ProblemException(409, 'file_rejected', 'Файл не прошёл проверку на вредоносное содержимое');
const storageUnavailable = () =>
  new ProblemException(503, 'storage_unavailable', 'Хранилище файлов недоступно. Попробуйте позже.');

export interface OpenedFile {
  stream: Readable;
  originalName: string;
  mediaType: string;
  byteSize: number;
  versionNumber: number;
}

/**
 * Единый путь файла платформы (DATA-05, DATA-06, DATA-07, GEN-09, NFR-09). Загрузка: `acceptUpload` (тип по
 * содержимому, 25 МБ) → `withStagedObject` (байты в карантин под случайным UUID) → `recordNew` / `recordVersion`
 * в транзакции действия (строки и задание `file-scan`). Скан и перенос в рабочий бакет — worker (`FileScanJob`).
 * Скачивание — только `open`: право записи-владельца по `FILE_READ_RULES`, только версия `passed`, аудит.
 * Имя файла не попадает ни в журнал, ни в тексты ошибок, ни в аудит, ни в данные заданий.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: PgBoss,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  /**
   * Байты — в карантин под новым UUID (без имени файла, NFR-09), затем `run(storageKey)` — транзакция
   * действия. Исключение `run` (откат, отказ прав, сбой) удаляет объект и выходит наружу; сбой удаления —
   * предупреждение без ключа и имени (объект остаётся в карантине, ни одна строка на него не ссылается).
   * Хранилище не приняло объект — 503 `storage_unavailable`, `run` не вызывается; объект, который хранилище
   * могло записать до сбоя ответа, тоже удаляется.
   */
  async withStagedObject<T>(upload: AcceptedUpload, run: (storageKey: string) => Promise<T>): Promise<T> {
    const storageKey = randomUUID();
    try {
      await this.storage.put(this.env.S3_BUCKET_QUARANTINE, storageKey, upload.bytes, upload.mediaType);
    } catch (error) {
      this.logger.warn(failureSummary(error), 'File upload: quarantine storage unavailable');
      await this.discardStaged(storageKey);
      throw storageUnavailable();
    }
    try {
      return await run(storageKey);
    } catch (error) {
      await this.discardStaged(storageKey);
      throw error;
    }
  }

  /** Удаление объекта карантина после отказа загрузки; сбой — предупреждение без ключа и имени. */
  private async discardStaged(storageKey: string): Promise<void> {
    try {
      await this.storage.remove(this.env.S3_BUCKET_QUARANTINE, storageKey);
    } catch (error) {
      this.logger.warn(failureSummary(error), 'File upload: quarantine object not removed after failure');
    }
  }

  /**
   * Новый файл и его версия 1 (DATA-05): исходное имя, размер, объявленный тип и тип по содержимому, sha256,
   * время загрузки; состояние `pending` до скана (DATA-07). Задание `file-scan` — в той же транзакции.
   */
  async recordNew(
    tx: Database,
    queueDb: QueueDb,
    input: {
      organizationId: string | null;
      purpose: FilePurpose;
      dataClass: DataClass;
      uploadedBy: string;
      upload: AcceptedUpload;
      storageKey: string;
    },
  ): Promise<{ fileObjectId: string; versionId: string; versionNumber: 1 }> {
    const [object] = await tx
      .insert(fileObject)
      .values({ organizationId: input.organizationId, purpose: input.purpose, dataClass: input.dataClass })
      .returning({ id: fileObject.id });
    const versionId = await this.insertVersion(tx, queueDb, object!.id, 1, input);
    return { fileObjectId: object!.id, versionId, versionNumber: 1 };
  }

  /**
   * Следующая версия файла (MAN-36): прежние остаются. Строка `file_object` блокируется `for update` —
   * параллельные версии одного файла получают номера по очереди (`max + 1`). Файла нет — 404.
   */
  async recordVersion(
    tx: Database,
    queueDb: QueueDb,
    fileObjectId: string,
    input: { uploadedBy: string; upload: AcceptedUpload; storageKey: string },
  ): Promise<{ fileObjectId: string; versionId: string; versionNumber: number }> {
    if (!isUuid(fileObjectId)) throw notFound();
    const [object] = await tx
      .select({ id: fileObject.id })
      .from(fileObject)
      .where(eq(fileObject.id, fileObjectId))
      .for('update');
    if (!object) throw notFound();
    const [last] = await tx
      .select({ max: sql<number>`coalesce(max(${fileVersion.versionNumber}), 0)::int` })
      .from(fileVersion)
      .where(eq(fileVersion.fileObjectId, fileObjectId));
    const versionNumber = (last?.max ?? 0) + 1;
    const versionId = await this.insertVersion(tx, queueDb, fileObjectId, versionNumber, input);
    return { fileObjectId, versionId, versionNumber };
  }

  private async insertVersion(
    tx: Database,
    queueDb: QueueDb,
    fileObjectId: string,
    versionNumber: number,
    input: { uploadedBy: string; upload: AcceptedUpload; storageKey: string },
  ): Promise<string> {
    const { upload } = input;
    const [version] = await tx
      .insert(fileVersion)
      .values({
        fileObjectId,
        versionNumber,
        originalName: upload.originalName,
        byteSize: upload.bytes.length,
        declaredMediaType: upload.declaredMediaType,
        detectedMediaType: upload.mediaType,
        checksum: upload.checksum,
        uploadedBy: input.uploadedBy,
        storageKey: input.storageKey,
      })
      .returning({ id: fileVersion.id });
    await this.queue.send(QUEUES.fileScan, { fileVersionId: version!.id } satisfies FileScanJobData, {
      db: queueDb,
      singletonKey: version!.id,
    });
    return version!.id;
  }

  /**
   * Скачивание версии (GEN-09, DATA-07, NFR-09). Порядок: файл есть (иначе 404, и id не-UUID) → правило
   * назначения `FILE_READ_RULES` (иначе аудит `file.read` `denied` и 403) → версия, по умолчанию последняя
   * (нет — 404) → `pending` — 409 `file_pending_scan`, `rejected` — 409 `file_rejected` → поток из рабочего
   * бакета (сбой — 503 `storage_unavailable`) → аудит `file.downloaded`. В карантин чтение не ходит никогда.
   */
  async open(auth: AuthContext, fileObjectId: string, version: number | null, ip: string | null): Promise<OpenedFile> {
    if (!isUuid(fileObjectId)) throw notFound();
    const [file] = await this.db
      .select({ id: fileObject.id, organizationId: fileObject.organizationId, purpose: fileObject.purpose })
      .from(fileObject)
      .where(eq(fileObject.id, fileObjectId));
    if (!file) throw notFound();

    const rule = FILE_READ_RULES[file.purpose] ?? denyAll;
    if (!(await rule({ tx: this.db, auth, file }))) {
      try {
        await this.audit.record({
          userId: auth.user.id,
          organizationId: auth.user.organizationId,
          action: 'file.read',
          objectType: 'file_object',
          objectId: file.id,
          outcome: 'denied',
          ip,
        });
      } catch (error) {
        // Сбой записи не подменяет отказ ошибкой 500: в журнал — сводка, наружу — 403.
        this.logger.error(failureSummary(error), 'Denied file read audit failed');
      }
      throw forbidden();
    }

    const [row] = await this.db
      .select({
        id: fileVersion.id,
        versionNumber: fileVersion.versionNumber,
        originalName: fileVersion.originalName,
        byteSize: fileVersion.byteSize,
        detectedMediaType: fileVersion.detectedMediaType,
        scanState: fileVersion.scanState,
        storageKey: fileVersion.storageKey,
      })
      .from(fileVersion)
      .where(
        and(
          eq(fileVersion.fileObjectId, file.id),
          version === null ? undefined : eq(fileVersion.versionNumber, version),
        ),
      )
      .orderBy(desc(fileVersion.versionNumber))
      .limit(1);
    if (!row) throw notFound();
    if (row.scanState === 'pending') throw pendingScan();
    if (row.scanState !== 'passed') throw rejectedByScan();

    let stream: Readable;
    try {
      stream = await this.storage.get(this.env.S3_BUCKET_FILES, row.storageKey);
    } catch (error) {
      this.logger.warn(failureSummary(error), 'File download: storage unavailable');
      throw storageUnavailable();
    }
    try {
      await this.audit.record({
        userId: auth.user.id,
        organizationId: auth.user.organizationId,
        action: 'file.downloaded',
        objectType: 'file_version',
        objectId: row.id,
        diff: { versionNumber: row.versionNumber },
        ip,
      });
    } catch (error) {
      // Скачивание без записи в аудит не отдаётся (AUD-01).
      stream.destroy();
      throw error;
    }
    return {
      stream,
      originalName: row.originalName,
      mediaType: row.detectedMediaType ?? 'application/octet-stream',
      byteSize: row.byteSize,
      versionNumber: row.versionNumber,
    };
  }
}
