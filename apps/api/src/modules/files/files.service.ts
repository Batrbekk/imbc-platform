import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { DataClass, FilePurpose } from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { ENV, type Env } from '../../config/env.js';
import { DB, type Database } from '../../database/database.module.js';
import { fileObject, fileVersion } from '../../database/schema/index.js';
import { type QueueDb, transactionWasRolledBack } from '../../database/transaction.js';
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
/** Internal signal: unwind the read transaction before writing denial audit using the pool (GEN-09, AUD-01). */
class FileReadDenied extends Error {
  constructor(readonly fileObjectId: string) {
    super('File read denied');
  }
}
const pendingScan = () =>
  new ProblemException(409, 'file_pending_scan', 'Файл ещё проверяется на вредоносное содержимое');
const rejectedByScan = () =>
  new ProblemException(409, 'file_rejected', 'Файл не прошёл проверку на вредоносное содержимое');
const storageUnavailable = () =>
  new ProblemException(503, 'storage_unavailable', 'Хранилище файлов недоступно. Попробуйте позже.');

/** Версия, которую пользователь вправе получить: заголовки ответа скачивания (и HEAD) без байтов. */
export interface FileDescription {
  originalName: string;
  mediaType: string;
  byteSize: number;
  versionNumber: number;
}

export interface OpenedFile extends FileDescription {
  stream: Readable;
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
   * действия. Подтверждённый rollback и отсутствие зарегистрированной версии позволяют удалить объект.
   * Неизвестный исход COMMIT/ROLLBACK сохраняет байты до reconciliation. Сбой удаления — предупреждение
   * без ключа и имени. `run` должен дождаться единственной регистрирующей транзакции действия.
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
      // A rejected COMMIT acknowledgement does not prove a rollback. Keep the bytes until
      // later reconciliation; only a confirmed rollback and an authoritative absence permit cleanup.
      if (transactionWasRolledBack(error)) {
        try {
          const exists = await this.db
            .select({ id: fileVersion.id })
            .from(fileVersion)
            .where(eq(fileVersion.storageKey, storageKey))
            .limit(1);
          if (exists.length === 0) await this.discardStaged(storageKey);
        } catch {
          this.logger.warn('File upload: quarantine bytes retained while registration is unknown');
        }
      } else this.logger.warn('File upload: quarantine bytes retained while transaction outcome is unknown');
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
      .where(and(eq(fileObject.id, fileObjectId), isNull(fileObject.purgeRequestedAt)))
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
   * Скачивание версии (GEN-09, DATA-07, NFR-09): проверки `authorize` → поток из рабочего бакета (сбой — 503
   * `storage_unavailable`) → аудит `file.downloaded`. В карантин чтение не ходит никогда.
   */
  async open(auth: AuthContext, fileObjectId: string, version: number | null, ip: string | null): Promise<OpenedFile> {
    const row = await this.authorize(auth, fileObjectId, version, ip);
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
    return { stream, ...description(row) };
  }

  /**
   * Те же проверки, что у `open`, без чтения объекта и без записи «скачано» — для HEAD: заголовки ответа
   * скачивания без тела. Отказ правила пишется как у `open` (`file.read` `denied`).
   */
  async describe(
    auth: AuthContext,
    fileObjectId: string,
    version: number | null,
    ip: string | null,
  ): Promise<FileDescription> {
    return description(await this.authorize(auth, fileObjectId, version, ip));
  }

  /**
   * Право и состояние версии (GEN-09, DATA-07). Порядок: файл есть (иначе 404, и id не-UUID) → правило назначения
   * `FILE_READ_RULES` (иначе аудит `file.read` `denied` и 403) → разрешённая версия (нет — 404) →
   * `pending` — 409 `file_pending_scan`, всё, что не `passed`, — 409 `file_rejected`.
   */
  private async authorize(auth: AuthContext, fileObjectId: string, version: number | null, ip: string | null) {
    if (!isUuid(fileObjectId)) throw notFound();
    // GEN-09: owner state and selected version share one read snapshot. Otherwise a freeze/replacement between
    // the owner check and version query could turn a working-owner permission into a post-submission latest read.
    try {
      return await this.db.transaction(
        (tx) => this.authorizeInTransaction(tx as unknown as Database, auth, fileObjectId, version),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (error) {
      if (!(error instanceof FileReadDenied)) throw error;
      // The transaction has rolled back and returned its checkout before audit requests a connection.
      // Keeping both at once would deadlock a one-connection pool or a full pool of simultaneous denials.
      try {
        await this.audit.record({
          userId: auth.user.id,
          organizationId: auth.user.organizationId,
          action: 'file.read',
          objectType: 'file_object',
          objectId: error.fileObjectId,
          outcome: 'denied',
          ip,
        });
      } catch (auditError) {
        // Сбой записи не подменяет отказ ошибкой 500: в журнал — сводка, наружу — 403.
        this.logger.error(failureSummary(auditError), 'Denied file read audit failed');
      }
      throw forbidden();
    }
  }

  private async authorizeInTransaction(tx: Database, auth: AuthContext, fileObjectId: string, version: number | null) {
    const [file] = await tx
      .select({
        id: fileObject.id,
        organizationId: fileObject.organizationId,
        purpose: fileObject.purpose,
        dataClass: fileObject.dataClass,
      })
      .from(fileObject)
      .where(and(eq(fileObject.id, fileObjectId), isNull(fileObject.purgeRequestedAt)));
    if (!file) throw notFound();

    const rule = FILE_READ_RULES[file.purpose] ?? denyAll;
    const decision = await rule({ tx, auth, file });
    if (!decision.allowed) throw new FileReadDenied(file.id);

    const [row] = await tx
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
          decision.versions === 'latest' ? undefined : inArray(fileVersion.id, [...decision.versions]),
          version === null ? undefined : eq(fileVersion.versionNumber, version),
        ),
      )
      .orderBy(desc(fileVersion.versionNumber))
      .limit(1);
    if (!row) throw notFound();
    if (row.scanState === 'pending') throw pendingScan();
    if (row.scanState !== 'passed') throw rejectedByScan();
    return row;
  }
}

const description = (row: {
  originalName: string;
  detectedMediaType: string | null;
  byteSize: number;
  versionNumber: number;
}): FileDescription => ({
  originalName: row.originalName,
  mediaType: row.detectedMediaType ?? 'application/octet-stream',
  byteSize: row.byteSize,
  versionNumber: row.versionNumber,
});
