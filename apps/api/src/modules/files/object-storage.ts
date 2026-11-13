import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { databaseErrorSummary } from '../../database/pg-errors.js';

/**
 * Объектное хранилище файлов (DATA-05): байты лежат отдельно от записи. Бакеты — `S3_BUCKET_QUARANTINE`
 * (до скана) и `S3_BUCKET_FILES` (после); ключ — случайный UUID без имени файла; наружу бакеты не
 * опубликованы, без presigned URL — байты отдаёт только API после проверки прав (NFR-09, GEN-09).
 */
export interface ObjectStorage {
  put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  /** Объекта нет — `ObjectStorageError` с `missing: true` (S3 `NoSuchKey`); прочие сбои — `missing: false`. */
  get(bucket: string, key: string): Promise<Readable>;
  copy(fromBucket: string, key: string, toBucket: string): Promise<void>;
  /** Удаление отсутствующего объекта — не ошибка (S3 DeleteObject). */
  remove(bucket: string, key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Класс ошибки клиента S3, означающий «объекта с таким ключом нет» (не «нет бакета» и не сбой). */
export const MISSING_OBJECT_REASON = 'NoSuchKey';

/**
 * Сбой хранилища без бакета и ключа в тексте: ошибка клиента S3 может нести их (`Key`, `BucketName`, текст
 * ответа), а ошибка задания pg-boss и журнал их хранить не должны. Остаётся операция и класс ошибки клиента;
 * исходная ошибка не сохраняется и в `cause`. `missing` — объекта с таким ключом нет (`NoSuchKey`).
 */
export class ObjectStorageError extends Error {
  readonly missing: boolean;

  constructor(
    readonly operation: 'put' | 'get' | 'copy' | 'remove',
    readonly reason: string,
  ) {
    super(`object storage ${operation} failed: ${reason}`);
    this.name = 'ObjectStorageError';
    this.missing = reason === MISSING_OBJECT_REASON;
  }
}

/**
 * Класс ошибки клиента (`NoSuchKey`, `TimeoutError`, `AccessDenied`…) без текста. Класс сервисной ошибки S3 —
 * код из ответа сервера: всё, что не похоже на идентификатор, — `unknown`.
 */
const reasonOf = (error: unknown) =>
  error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : 'unknown';

/**
 * Сводка сбоя пути файла для журнала (NFR-11): у ошибки базы — SQLSTATE и ограничение, у хранилища — операция
 * и класс ошибки клиента, у прочих — класс. Ни текста ошибки, ни ключа объекта, ни имени файла.
 */
export function storageFailureSummary(error: unknown): Record<string, unknown> {
  const database = databaseErrorSummary(error);
  if (database) return database;
  if (error instanceof ObjectStorageError)
    return { error: error.name, operation: error.operation, reason: error.reason };
  return { error: reasonOf(error) };
}

/** RustFS и любой S3-совместимый сервер (path-style, клиент `S3` из InfraModule). */
export class S3ObjectStorage implements ObjectStorage {
  constructor(private readonly s3: S3Client) {}

  async put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.call('put', () =>
      this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        }),
      ),
    );
  }

  async get(bucket: string, key: string): Promise<Readable> {
    const output = await this.call('get', () => this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })));
    if (!(output.Body instanceof Readable)) throw new ObjectStorageError('get', 'NoStream');
    return output.Body;
  }

  async copy(fromBucket: string, key: string, toBucket: string): Promise<void> {
    await this.call('copy', () =>
      this.s3.send(
        new CopyObjectCommand({ Bucket: toBucket, Key: key, CopySource: `${fromBucket}/${encodeURIComponent(key)}` }),
      ),
    );
  }

  async remove(bucket: string, key: string): Promise<void> {
    await this.call('remove', () => this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })));
  }

  private async call<T>(operation: ObjectStorageError['operation'], run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw new ObjectStorageError(operation, reasonOf(error));
    }
  }
}
