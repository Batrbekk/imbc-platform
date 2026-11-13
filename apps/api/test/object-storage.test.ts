import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';
import { Readable } from 'node:stream';
import { inspect } from 'node:util';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createS3Client,
  ObjectStorageError,
  S3_TIMEOUTS,
  S3ObjectStorage,
  storageFailureSummary,
} from '../src/modules/files/object-storage.js';

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

/** Читает поток до конца; ошибка потока — отказ промиса. */
const drain = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

/** Промис не дольше `ms`: зависание — ошибка теста, а не вечное ожидание. */
const within = <T>(ms: number, promise: Promise<T>) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`не завершилось за ${ms} мс`)), ms)),
  ]);

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
    // Поток объекта — те же байты (сбой чтения тела приходит как ObjectStorageError — см. сроки ниже).
    expect(await drain(await storage.get(BUCKET, KEY))).toEqual(Buffer.from('%PDF-1.7'));
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

  it('get: сбой чтения тела после заголовков — ObjectStorageError с классом ошибки, без ключа и бакета; закрытие потока потребителем закрывает тело', async () => {
    const broken = new Readable({
      read() {
        this.destroy(Object.assign(new Error(`socket hang up ${BUCKET}/${KEY}`), { name: 'TimeoutError', Key: KEY }));
      },
    });
    const { storage } = fakeClient(async () => ({ Body: broken }));
    const error = await failure(() => storage.get(BUCKET, KEY).then(drain));
    expect(error).toMatchObject({ operation: 'get', reason: 'TimeoutError', missing: false });
    expect(error.cause).toBeUndefined();
    expect(inspect(error, { depth: 10, showHidden: true })).not.toContain(KEY);

    const idle = new Readable({ read() {} });
    const { storage: held } = fakeClient(async () => ({ Body: idle }));
    (await held.get(BUCKET, KEY)).destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(idle.destroyed).toBe(true);
  });
});

// Хранилище на горячем пути (загрузка, скан, скачивание): зависший сервер S3 не держит запрос API и обработчик
// очереди file-scan дольше сроков клиента. Сервер — локальный, без сети наружу; сроки в тесте уменьшены через
// параметр фабрики (в работе — S3_TIMEOUTS).
describe('S3ObjectStorage: сроки клиента S3 против зависшего сервера (DATA-07, NFR-11)', () => {
  // Клиент повторяет таймаут сам (три попытки): тест ограничен своим сроком `within`, а не 5 с vitest.
  vi.setConfig({ testTimeout: 15_000 });
  const TEST_TIMEOUTS = { connectionTimeout: 300, socketTimeout: 300, requestTimeout: 900 };
  let server: Server | undefined;
  let sockets: Socket[] = [];

  /** Сервер на 127.0.0.1: `onConnection` решает, что отвечать (или молчать). */
  async function listen(onConnection: (socket: Socket) => void): Promise<S3ObjectStorage> {
    const opened = createServer((socket) => {
      sockets.push(socket);
      socket.on('error', () => undefined);
      onConnection(socket);
    });
    server = opened;
    await new Promise<void>((resolve) => opened.listen(0, '127.0.0.1', resolve));
    const { port } = opened.address() as AddressInfo;
    const client = createS3Client(
      { endpoint: `http://127.0.0.1:${port}`, region: 'us-east-1', accessKeyId: 'test', secretAccessKey: 'test' },
      TEST_TIMEOUTS,
    );
    return new S3ObjectStorage(client);
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    const closing = server;
    server = undefined;
    if (closing) await new Promise((resolve) => closing.close(resolve));
  });

  /** Ошибка — ObjectStorageError с причиной таймаута, без бакета и ключа. */
  const timedOut = (error: unknown, operation: ObjectStorageError['operation']) => {
    expect(error).toBeInstanceOf(ObjectStorageError);
    expect(error).toMatchObject({ operation, reason: 'TimeoutError', missing: false });
    const text = `${inspect(error, { depth: 10, showHidden: true })}\n${JSON.stringify(storageFailureSummary(error))}`;
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(BUCKET);
  };

  it('сроки в работе: соединение 5 с, простой сокета 30 с, запрос до заголовков ответа 120 с', () => {
    expect(S3_TIMEOUTS).toEqual({ connectionTimeout: 5_000, socketTimeout: 30_000, requestTimeout: 120_000 });
  });

  it('сервер принял соединение и молчит: get и put — ObjectStorageError TimeoutError за ограниченное время', async () => {
    const storage = await listen(() => undefined);
    const started = Date.now();
    timedOut(
      await within(
        8_000,
        storage.get(BUCKET, KEY).catch((e: unknown) => e),
      ),
      'get',
    );
    timedOut(
      await within(
        8_000,
        storage.put(BUCKET, KEY, Buffer.from('%PDF-1.7'), 'application/pdf').catch((e: unknown) => e),
      ),
      'put',
    );
    expect(Date.now() - started).toBeLessThan(12_000);
  });

  it('сервер отдал заголовки GetObject и замолчал на теле: чтение потока — ObjectStorageError TimeoutError', async () => {
    const storage = await listen((socket) =>
      socket.once('data', () =>
        socket.write(
          'HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 1000\r\nConnection: keep-alive\r\n\r\n%PDF-1.7',
        ),
      ),
    );
    const body = await within(8_000, storage.get(BUCKET, KEY));
    const error = await within(
      8_000,
      drain(body).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    timedOut(error, 'get');
  });

  it('сервер шлёт заголовки по байту и не заканчивает: простоя сокета нет — срабатывает срок запроса (throwOnRequestTimeout), ObjectStorageError TimeoutError', async () => {
    const storage = await listen((socket) =>
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 OK\r\n');
        const timer = setInterval(() => {
          if (socket.destroyed) clearInterval(timer);
          else socket.write('X-Wait: 1\r\n');
        }, 100);
        socket.on('close', () => clearInterval(timer));
      }),
    );
    timedOut(
      await within(
        10_000,
        storage.get(BUCKET, KEY).catch((e: unknown) => e),
      ),
      'get',
    );
  });
});
