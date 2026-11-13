import { Readable } from 'node:stream';
import {
  MISSING_OBJECT_REASON,
  type ObjectStorage,
  ObjectStorageError,
} from '../../src/modules/files/object-storage.js';

type Operation = 'put' | 'get' | 'copy' | 'remove';

/**
 * Хранилище объектов в памяти для тестов (без сети): ключ карты — `${bucket}/${key}`. `failNext(op)` — следующая
 * операция `op` падает ошибкой, в тексте которой есть бакет и ключ, как у настоящего клиента S3: тест проверяет,
 * что ни ключ, ни имя файла не уходят в журнал и в ответ. Отсутствующий объект в `get` и `copy` —
 * `ObjectStorageError` с `missing: true`, как у `S3ObjectStorage` на `NoSuchKey`; удаление отсутствующего объекта —
 * не ошибка (как в S3).
 */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, Buffer>();
  private readonly failures: Operation[] = [];

  failNext(op: Operation): void {
    this.failures.push(op);
  }

  /** Ключи объектов бакета. */
  keys(bucket: string): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${bucket}/`)).map((k) => k.slice(bucket.length + 1));
  }

  async put(bucket: string, key: string, body: Buffer, _contentType: string): Promise<void> {
    this.fail('put', bucket, key);
    this.objects.set(`${bucket}/${key}`, Buffer.from(body));
  }

  async get(bucket: string, key: string): Promise<Readable> {
    this.fail('get', bucket, key);
    const body = this.objects.get(`${bucket}/${key}`);
    if (!body) throw new ObjectStorageError('get', MISSING_OBJECT_REASON);
    return Readable.from([body]);
  }

  async copy(fromBucket: string, key: string, toBucket: string): Promise<void> {
    this.fail('copy', fromBucket, key);
    const body = this.objects.get(`${fromBucket}/${key}`);
    if (!body) throw new ObjectStorageError('copy', MISSING_OBJECT_REASON);
    this.objects.set(`${toBucket}/${key}`, Buffer.from(body));
  }

  async remove(bucket: string, key: string): Promise<void> {
    this.fail('remove', bucket, key);
    this.objects.delete(`${bucket}/${key}`);
  }

  private fail(op: Operation, bucket: string, key: string): void {
    const index = this.failures.indexOf(op);
    if (index === -1) return;
    this.failures.splice(index, 1);
    throw new Error(`memory storage: ${op} ${bucket}/${key} failed`);
  }
}
