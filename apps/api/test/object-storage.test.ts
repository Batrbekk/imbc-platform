import { Readable } from 'node:stream';
import { inspect } from 'node:util';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { ObjectStorageError, S3ObjectStorage, storageFailureSummary } from '../src/modules/files/object-storage.js';

// Хранилище файлов поверх клиента S3 (DATA-05, NFR-09, NFR-11): клиент — подделка без сети. Ошибка клиента несёт
// бакет и ключ (текст, поля `Key`, `BucketName`, тело ответа) — наружу она выходит только как ObjectStorageError
// с операцией и классом ошибки.
const BUCKET = 'imbc-quarantine';
const KEY = '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d';

/** Ошибка, как её бросает @aws-sdk/client-s3: класс — код сервера, в тексте и полях — бакет и ключ. */
const clientError = (name: string, status: number) =>
  Object.assign(new Error(`${name}: The specified key does not exist. Bucket: ${BUCKET}, Key: ${KEY}`), {
    name,
    Key: KEY,
    BucketName: BUCKET,
    $fault: 'client',
    $metadata: { httpStatusCode: status, requestId: 'request-1' },
    $response: { body: `<Error><Code>${name}</Code><Key>${KEY}</Key><BucketName>${BUCKET}</BucketName></Error>` },
  });

const fakeClient = (send: (command: unknown) => Promise<unknown>) => {
  const client = { send: vi.fn(send) };
  return { client, storage: new S3ObjectStorage(client as unknown as S3Client) };
};

const OPERATIONS = [
  ['put', (s: S3ObjectStorage) => s.put(BUCKET, KEY, Buffer.from('%PDF-1.7'), 'application/pdf')],
  ['get', (s: S3ObjectStorage) => s.get(BUCKET, KEY)],
  ['copy', (s: S3ObjectStorage) => s.copy(BUCKET, KEY, 'imbc-files')],
  ['remove', (s: S3ObjectStorage) => s.remove(BUCKET, KEY)],
] as const;

const failure = async (run: () => Promise<unknown>) => {
  const error = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ObjectStorageError);
  return error as ObjectStorageError;
};

describe('S3ObjectStorage: ошибки клиента без бакета и ключа (NFR-11)', () => {
  it.each(OPERATIONS)(
    '%s: сырая ошибка клиента — только ObjectStorageError с классом ошибки, без ключа, бакета и cause',
    async (operation, call) => {
      const { storage } = fakeClient(async () => {
        throw clientError('AccessDenied', 403);
      });
      const error = await failure(() => call(storage));
      expect(error).toMatchObject({
        operation,
        reason: 'AccessDenied',
        missing: false,
        message: `object storage ${operation} failed: AccessDenied`,
      });
      expect(error.cause).toBeUndefined();
      const text = `${inspect(error, { depth: 10, showHidden: true })}\n${JSON.stringify(storageFailureSummary(error))}`;
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(BUCKET);
      expect(storageFailureSummary(error)).toEqual({ error: 'ObjectStorageError', operation, reason: 'AccessDenied' });
    },
  );

  it('NoSuchKey — missing: true; NoSuchBucket, 404 без NoSuchKey и сетевой сбой — missing: false; класс не идентификатор — unknown', async () => {
    const cases: [unknown, string, boolean][] = [
      [clientError('NoSuchKey', 404), 'NoSuchKey', true],
      [clientError('NoSuchBucket', 404), 'NoSuchBucket', false],
      [clientError('NotFound', 404), 'NotFound', false],
      [
        Object.assign(new Error(`connect ECONNREFUSED rustfs:9000 ${KEY}`), { name: 'TimeoutError' }),
        'TimeoutError',
        false,
      ],
      [clientError(`Bad name ${KEY}`, 500), 'unknown', false],
      [`строка ${KEY}`, 'unknown', false],
    ];
    for (const [thrown, reason, missing] of cases) {
      const { storage } = fakeClient(async () => {
        throw thrown;
      });
      const error = await failure(() => storage.get(BUCKET, KEY));
      expect({ reason: error.reason, missing: error.missing }, reason).toEqual({ reason, missing });
      expect(inspect(error, { depth: 10, showHidden: true })).not.toContain(KEY);
    }
  });

  it('команды клиента: put с типом и длиной, get — поток Node (иначе NoStream), copy — CopySource бакет/ключ, remove', async () => {
    const body = Readable.from([Buffer.from('%PDF-1.7')]);
    const { client, storage } = fakeClient(async (command) =>
      command instanceof GetObjectCommand ? { Body: body } : {},
    );

    await storage.put(BUCKET, KEY, Buffer.from('%PDF-1.7'), 'application/pdf');
    expect(await storage.get(BUCKET, KEY)).toBe(body);
    await storage.copy(BUCKET, KEY, 'imbc-files');
    await storage.remove(BUCKET, KEY);
    const [put, get, copy, remove] = client.send.mock.calls.map(([command]) => command);
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect((put as PutObjectCommand).input).toMatchObject({
      Bucket: BUCKET,
      Key: KEY,
      ContentType: 'application/pdf',
      ContentLength: 8,
    });
    expect(get).toBeInstanceOf(GetObjectCommand);
    expect((get as GetObjectCommand).input).toEqual({ Bucket: BUCKET, Key: KEY });
    expect(copy).toBeInstanceOf(CopyObjectCommand);
    expect((copy as CopyObjectCommand).input).toEqual({
      Bucket: 'imbc-files',
      Key: KEY,
      CopySource: `${BUCKET}/${KEY}`,
    });
    expect(remove).toBeInstanceOf(DeleteObjectCommand);
    expect((remove as DeleteObjectCommand).input).toEqual({ Bucket: BUCKET, Key: KEY });

    const { storage: webStream } = fakeClient(async () => ({ Body: new Blob(['x']) }));
    expect(await failure(() => webStream.get(BUCKET, KEY))).toMatchObject({ operation: 'get', reason: 'NoStream' });
  });
});
