import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { inspect } from 'node:util';
import { deflateSync } from 'node:zlib';
import { FILE_PROBLEM_CODES, MAX_FILE_BYTES } from '@imbc/contracts';
import {
  BadRequestException,
  type CallHandler,
  Controller,
  type ExecutionContext,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  PayloadTooLargeException,
  Post,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MulterError } from 'multer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProblemException } from '../src/common/problem.js';
import { acceptUpload, uploadFailure, uploadInterceptor } from '../src/modules/files/upload.js';
import { UPLOAD_SLOTS, UploadSlots } from '../src/modules/files/upload-slots.js';
import { MAX_INFLATED_BYTES } from '../src/modules/files/zip-structure.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница загрузки (DATA-06): multer с пределами, тип по содержимому, расширение имени, имя файла UTF-8.
// Хранилища и БД здесь нет: отказ происходит до них (файлы с базой — files.integration.test.ts).
const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));

const SECRET_NAME = 'Секретный-план.pdf';

/**
 * Ломает чтение тела до multer: `req.pipe` бросает ошибку с именем файла в тексте и коде — так выглядит сбой,
 * который не означает ошибку клиента (не код MulterError и не разметка busboy).
 */
@Injectable()
class BrokenStreamInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    req.pipe = (() => {
      throw Object.assign(new Error(`pipe failed for C:\\docs\\${SECRET_NAME}`), {
        code: 'ESTREAMTEST',
        filename: SECRET_NAME,
      });
    }) as never;
    return next.handle();
  }
}

/** Тестовый маршрут: тот же перехватчик и та же проверка, что у маршрутов загрузки платформы. */
@Controller('test')
class UploadTestController {
  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(uploadInterceptor())
  async upload(@UploadedFile() file: Express.Multer.File | undefined) {
    const accepted = await acceptUpload(file);
    return { mediaType: accepted.mediaType, originalName: accepted.originalName, byteSize: accepted.bytes.length };
  }

  @Post('upload-broken')
  @HttpCode(200)
  @UseInterceptors(BrokenStreamInterceptor, uploadInterceptor())
  async broken(@UploadedFile() file: Express.Multer.File | undefined) {
    await acceptUpload(file);
    return {};
  }
}

const UPLOAD_REPLY_GATE = Symbol('UPLOAD_REPLY_GATE');
interface UploadReplyGate {
  entered(): void;
  closed?(): void;
  pending: Promise<void>;
}

/** Тело уже прочитано, но запись файла или другой обработчик ещё не завершился. */
@Controller('test')
class DelayedUploadTestController {
  constructor(@Inject(UPLOAD_REPLY_GATE) private readonly gate: UploadReplyGate) {}

  @Post('upload-held-reply')
  @HttpCode(200)
  @UseInterceptors(uploadInterceptor())
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Res({ passthrough: true }) res: Response) {
    res.once('close', () => this.gate.closed?.());
    this.gate.entered();
    await this.gate.pending;
    const accepted = await acceptUpload(file);
    return { byteSize: accepted.bytes.length };
  }
}

/** MulterError с полями, которые multer 2.5 передаёт в конструктор (тип @types/multer знает только два). */
const multerError = (code: string, field?: string, filename?: string) =>
  new (MulterError as unknown as new (code: string, field?: string, filename?: string) => Error)(code, field, filename);

/** PDF заданного размера: заголовок `%PDF-` и нули — тип определяется по началу. */
const pdfOfSize = (size: number) => {
  const bytes = Buffer.alloc(size);
  bytes.write('%PDF-1.7\n');
  return bytes;
};

const form = (...files: [field: string, bytes: Buffer, name: string, type?: string][]) => {
  const body = new FormData();
  for (const [field, bytes, name, type] of files)
    body.append(field, new Blob([new Uint8Array(bytes)], { type: type ?? 'application/octet-stream' }), name);
  return body;
};

describe('загрузка файла: предел, тип по содержимому, имя (DATA-06)', () => {
  vi.setConfig({ testTimeout: 60000 });
  let http: HttpStand;

  const upload = async (body: FormData) => {
    const res = await http.upload('/api/test/upload', 'manufacturer', body);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    http = await startHttp({ controllers: [UploadTestController] });
  });

  afterAll(async () => {
    await http?.close();
  });

  it('граница 25 МБ и подделанный тип: PDF ровно 26 214 400 байт — принят; 26 214 401 — 413 file_too_large; пустой — 400 file_empty; без поля file — 400 file_missing; два файла — 400 validation; program.exe с именем .pdf и plain.zip с именем .docx — 415 file_type_not_allowed; sample.png с именем .pdf — 415 file_type_mismatch (DATA-06)', async () => {
    expect(MAX_FILE_BYTES).toBe(26_214_400);

    const exact = await upload(form(['file', pdfOfSize(MAX_FILE_BYTES), 'ровно.pdf', 'application/pdf']));
    expect(exact).toEqual({
      status: 200,
      body: { mediaType: 'application/pdf', originalName: 'ровно.pdf', byteSize: 26_214_400 },
    });

    const over = await upload(form(['file', pdfOfSize(MAX_FILE_BYTES + 1), 'Секретный план.pdf', 'application/pdf']));
    expect(over.status).toBe(413);
    expect(over.body).toMatchObject({ status: 413, code: 'file_too_large' });
    // MulterError несёт имя файла — в ответ оно не попадает.
    expect(JSON.stringify(over.body)).not.toContain('Секретный');

    const empty = await upload(form(['file', Buffer.alloc(0), 'пустой.pdf', 'application/pdf']));
    expect(empty).toMatchObject({ status: 400, body: { code: 'file_empty' } });

    const noFile = new FormData();
    noFile.append('note', 'без файла');
    expect(await upload(noFile)).toMatchObject({ status: 400, body: { code: 'file_missing' } });
    // Тело не multipart — файла нет.
    const json = await http.send('POST', '/api/test/upload', 'manufacturer', { file: 'x' });
    expect(json.status).toBe(400);
    expect(await json.json()).toMatchObject({ code: 'file_missing' });

    const twoFiles = form(['file', fixture('sample.pdf'), 'a.pdf'], ['file', fixture('sample.pdf'), 'b.pdf']);
    expect(await upload(twoFiles)).toMatchObject({ status: 400, body: { code: 'validation' } });
    const otherField = form(['document', fixture('sample.pdf'), 'a.pdf']);
    expect(await upload(otherField)).toMatchObject({ status: 400, body: { code: 'validation' } });
    const manyFields = form(['file', fixture('sample.pdf'), 'a.pdf']);
    for (let i = 0; i < 5; i++) manyFields.append(`field${i}`, 'x');
    expect(await upload(manyFields)).toMatchObject({ status: 400, body: { code: 'validation' } });

    // Объявленный тип клиента не спасает: решает содержимое.
    const exe = await upload(form(['file', fixture('program.exe'), 'устав.pdf', 'application/pdf']));
    expect(exe).toMatchObject({ status: 415, body: { code: 'file_type_not_allowed' } });
    const zip = await upload(
      form([
        'file',
        fixture('plain.zip'),
        'устав.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ]),
    );
    expect(zip).toMatchObject({ status: 415, body: { code: 'file_type_not_allowed' } });
    const png = await upload(form(['file', fixture('sample.png'), 'схема.pdf', 'application/pdf']));
    expect(png).toMatchObject({ status: 415, body: { code: 'file_type_mismatch' } });

    for (const [name, mediaType] of [
      ['sample.pdf', 'application/pdf'],
      ['sample.jpg', 'image/jpeg'],
      ['sample.png', 'image/png'],
      ['sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['sample.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ] as const)
      expect(await upload(form(['file', fixture(name), name.toUpperCase()]))).toMatchObject({
        status: 200,
        body: { mediaType, originalName: name.toUpperCase() },
      });
    expect(await upload(form(['file', fixture('sample.jpg'), 'фото.jpeg']))).toMatchObject({
      status: 200,
      body: { mediaType: 'image/jpeg' },
    });
  });

  it('имя файла: `C:\\docs\\Құрылым "IMBC"; v1.pdf` с переводом строки приходит базовым именем `Құрылым "IMBC"; v1.pdf` без управляющих символов и без порчи кириллицы', async () => {
    const accepted = await upload(form(['file', fixture('sample.pdf'), 'C:\\docs\\Құрылым "IMBC";\n v1.pdf\r\n']));
    expect(accepted).toEqual({
      status: 200,
      body: {
        mediaType: 'application/pdf',
        originalName: 'Құрылым "IMBC"; v1.pdf',
        byteSize: fixture('sample.pdf').length,
      },
    });

    // Путь через «/», табуляция и управляющие символы направления текста — тоже не часть имени.
    const posix = await upload(form(['file', fixture('sample.pdf'), '/home/user/Схема\tорг\u202e.pdf']));
    expect(posix.body).toMatchObject({ originalName: 'Схемаорг.pdf' });
    // Имя длиннее 255 символов укорачивается, расширение сохраняется.
    const long = await upload(form(['file', fixture('sample.pdf'), `${'Құрылым'.repeat(50)}.pdf`]));
    expect(long.status).toBe(200);
    expect(Array.from(long.body.originalName as string)).toHaveLength(255);
    expect(long.body.originalName).toMatch(/^Құрылым.*\.pdf$/);
  });

  it('DOCX и XLSX с ZIP64 (запись с force_zip64, каталог ZIP64) и усечённый DOCX — 415 file_structure_unsupported; обычные DOCX и XLSX принимаются (DATA-07)', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    for (const [name, reason] of [
      ['zip64-local.docx', 'zip64_local_values'],
      ['zip64-local.xlsx', 'zip64_local_values'],
      ['zip64-directory.docx', 'zip64_locator'],
      ['truncated.docx', 'end_record_missing'],
    ] as const) {
      log.mockClear();
      const res = await upload(form(['file', fixture(name), name]));
      expect(res, name).toMatchObject({ status: 415, body: { status: 415, code: 'file_structure_unsupported' } });
      expect(JSON.stringify(res.body), name).not.toContain(name);
      // Причина различима в журнале, имени файла там нет.
      expect(log).toHaveBeenCalledWith({ reason }, 'File upload: ZIP structure not accepted');
      expect(inspect(log.mock.calls)).not.toContain(name);
    }
    log.mockRestore();
    for (const name of ['sample.docx', 'sample.xlsx', 'sample-deflated.docx'])
      expect(await upload(form(['file', fixture(name), name])), name).toMatchObject({ status: 200 });
  });

  it('encrypted.docx — 415 file_encrypted; legacy.doc с именем .docx — 415 file_type_not_allowed; nested-deep.docx — 415 file_too_complex; nested-zip64.docx — 415 file_structure_unsupported; в журнале причина без имени файла (DATA-06, DATA-07)', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    for (const [file, name, code, reason] of [
      // Под паролем: контейнер CFB с потоками EncryptionInfo и EncryptedPackage — под именем DOCX или XLSX.
      ['encrypted.docx', 'Секретный план.docx', 'file_encrypted', null],
      ['encrypted.docx', 'Секретный план.XLSX', 'file_encrypted', null],
      // Тот же контейнер под другим именем и старый .doc — тип не допускается.
      ['encrypted.docx', 'Секретный план.pdf', 'file_type_not_allowed', null],
      ['legacy.doc', 'Секретный план.docx', 'file_type_not_allowed', null],
      ['legacy.doc', 'Секретный план.doc', 'file_type_not_allowed', null],
      ['nested-deep.docx', 'Секретный план.docx', 'file_too_complex', 'nested_too_deep'],
      ['nested-zip64.docx', 'Секретный план.docx', 'file_structure_unsupported', 'zip64_local_values'],
      ['gap.docx', 'Секретный план.docx', 'file_structure_unsupported', 'entries_gap'],
    ] as const) {
      log.mockClear();
      const res = await upload(form(['file', fixture(file), name, DOCX]));
      expect(res, `${file} как ${name}`).toMatchObject({ status: 415, body: { status: 415, code } });
      expect(JSON.stringify(res.body)).not.toContain('Секретный');
      if (reason === null)
        expect(log).not.toHaveBeenCalledWith(expect.anything(), 'File upload: ZIP structure not accepted');
      else expect(log).toHaveBeenCalledWith({ reason }, 'File upload: ZIP structure not accepted');
      expect(inspect(log.mock.calls, { depth: 10 })).not.toContain('Секретный');
    }
    log.mockRestore();
    // Законный вложенный XLSX и описатели данных (как пишет Java) принимаются.
    for (const name of ['nested.docx', 'descriptor.xlsx'])
      expect(await upload(form(['file', fixture(name), name])), name).toMatchObject({ status: 200 });
  });

  it('DOCX с объектом OLE: внедрённый файл — 415 file_has_attachments, внедрённый документ под паролем — 415 file_encrypted, формула — 200; имени файла нет ни в ответе, ни в журнале (DATA-06, DATA-07)', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    for (const [file, code, reason] of [
      ['ole-native.docx', 'file_has_attachments', 'embedded_file'],
      ['ole-package-zip64.docx', 'file_has_attachments', 'embedded_file'],
      // Поток с произвольным именем (Contents1), данные которого — архив ZIP.
      ['ole-zip-stream.docx', 'file_has_attachments', 'embedded_file'],
      ['ole-encrypted.docx', 'file_encrypted', 'encrypted'],
    ] as const) {
      log.mockClear();
      const res = await upload(form(['file', fixture(file), 'Секретный план.docx']));
      expect(res, file).toMatchObject({ status: 415, body: { status: 415, code } });
      expect(JSON.stringify(res.body)).not.toContain('Секретный');
      expect(log).toHaveBeenCalledWith({ reason }, 'File upload: ZIP structure not accepted');
      expect(inspect(log.mock.calls, { depth: 10 })).not.toContain('Секретный');
    }
    log.mockRestore();
    expect(await upload(form(['file', fixture('ole-equation.docx'), 'Формула.docx']))).toMatchObject({ status: 200 });
  });

  it('PDF с защитой — 415 file_encrypted; с вложением — 415 file_has_attachments; поток объектов больше бюджета — 415 file_too_complex; в журнале причина без имени файла; обычный PDF — 200 (DATA-06, DATA-07)', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    // Поток объектов, который распаковывается больше чем в 64 МиБ.
    const oversized = Buffer.concat([
      Buffer.from('%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>\nstream\n'),
      deflateSync(Buffer.alloc(MAX_INFLATED_BYTES + 1, 0x20)),
      Buffer.from('\nendstream\nendobj\n%%EOF\n'),
    ]);
    for (const [label, bytes, code, reason] of [
      ['owner-password.pdf', fixture('owner-password.pdf'), 'file_encrypted', 'encrypted'],
      ['attachment.pdf', fixture('attachment.pdf'), 'file_has_attachments', 'attachments'],
      ['attachment-annotation.pdf', fixture('attachment-annotation.pdf'), 'file_has_attachments', 'attachments'],
      ['attachment-escaped.pdf', fixture('attachment-escaped.pdf'), 'file_has_attachments', 'attachments'],
      ['attachment-objstm.pdf', fixture('attachment-objstm.pdf'), 'file_has_attachments', 'attachments'],
      ['поток объектов сверх бюджета', oversized, 'file_too_complex', 'inflate_limit'],
    ] as const) {
      log.mockClear();
      const res = await upload(form(['file', bytes, 'Секретный план.pdf', 'application/pdf']));
      expect(res, label).toMatchObject({ status: 415, body: { status: 415, code } });
      if (code === 'file_encrypted')
        expect(res.body).toMatchObject({
          title: 'Документ защищён паролем или ограничениями',
          detail: expect.stringContaining('запретом правки или печати'),
        });
      expect(JSON.stringify(res.body)).not.toContain('Секретный');
      expect(log).toHaveBeenCalledWith({ reason }, 'File upload: PDF not accepted');
      expect(log).not.toHaveBeenCalledWith(expect.anything(), 'File upload: ZIP structure not accepted');
      expect(inspect(log.mock.calls, { depth: 10 })).not.toContain('Секретный');
    }
    log.mockClear();
    expect(await upload(form(['file', fixture('sample.pdf'), 'sample.pdf']))).toMatchObject({
      status: 200,
      body: { mediaType: 'application/pdf' },
    });
    expect(log).not.toHaveBeenCalledWith(expect.anything(), 'File upload: PDF not accepted');
    log.mockRestore();
  });

  it('без сеанса — 401, файл не разбирается', async () => {
    const res = await http.upload('/api/test/upload', undefined, form(['file', fixture('sample.pdf'), 'a.pdf']));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('сбой разбора, который не ошибка клиента, — 500 internal и строка журнала { code, name } без имени файла', async () => {
    const error = vi.spyOn(Logger.prototype, 'error');
    const res = await http.upload(
      '/api/test/upload-broken',
      'manufacturer',
      form(['file', fixture('sample.pdf'), SECRET_NAME]),
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ status: 500, code: 'internal' });
    expect(body).not.toContain('Секретный');
    expect(error).toHaveBeenCalledWith({ code: 'ESTREAMTEST', name: 'Error' }, 'File upload: multipart parsing failed');
    expect(inspect(error.mock.calls, { depth: 10 })).not.toContain('Секретный');
    // Ошибка клиента (лишний файл) в журнал ошибок не пишется.
    error.mockClear();
    const twoFiles = form(['file', fixture('sample.pdf'), SECRET_NAME], ['file', fixture('sample.pdf'), SECRET_NAME]);
    expect((await http.upload('/api/test/upload', 'manufacturer', twoFiles)).status).toBe(400);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('uploadFailure: ошибка клиента — 413/400 без журнала, прочее — 500 с { code, name }', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const problem = (error: Error) => {
    expect(error).toBeInstanceOf(ProblemException);
    return { status: (error as ProblemException).getStatus(), code: (error as ProblemException).code };
  };

  it('коды MulterError и busboy, переведённые FileInterceptor в 4xx, — 413 file_too_large или 400 validation', () => {
    const log = vi.spyOn(Logger.prototype, 'error');
    expect(
      problem(
        uploadFailure(
          new PayloadTooLargeException('File too large', {
            cause: multerError('LIMIT_FILE_SIZE', 'file', SECRET_NAME),
          }),
        ),
      ),
    ).toEqual({ status: 413, code: 'file_too_large' });
    for (const code of ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_FIELD_COUNT', 'MISSING_FIELD_NAME'])
      expect(
        problem(uploadFailure(new BadRequestException('x', { cause: multerError(code, 'file', SECRET_NAME) }))),
        code,
      ).toEqual({ status: 400, code: 'validation' });
    expect(problem(uploadFailure(new BadRequestException('Multipart: Boundary not found')))).toEqual({
      status: 400,
      code: 'validation',
    });
    expect(problem(uploadFailure(new UnsupportedMediaTypeException('Unsupported content type')))).toEqual({
      status: 400,
      code: 'validation',
    });
    // Клиент оборвал запрос: ответ ему не нужен, сбоем сервера это не считается.
    expect(problem(uploadFailure(new Error('Request aborted'), true))).toEqual({ status: 400, code: 'validation' });
    expect(log).not.toHaveBeenCalled();
  });

  it('прочее (STREAM_DESTROYED, сбой хранилища multer, неизвестная ошибка) — Error без данных и журнал { code, name }', () => {
    const log = vi.spyOn(Logger.prototype, 'error');
    const failure = uploadFailure(multerError('STREAM_DESTROYED', 'file', SECRET_NAME));
    expect(failure).not.toBeInstanceOf(ProblemException);
    expect(failure.message).toBe('File upload failed');
    expect(log).toHaveBeenCalledWith(
      { code: 'STREAM_DESTROYED', name: 'MulterError' },
      'File upload: multipart parsing failed',
    );
    uploadFailure('строка');
    expect(log).toHaveBeenLastCalledWith({ code: undefined, name: 'string' }, 'File upload: multipart parsing failed');
    expect(inspect(log.mock.calls, { depth: 10 })).not.toContain('Секретный');
  });
});

interface HeldReply {
  status: number;
  retryAfter: string | undefined;
  body: Record<string, unknown>;
}

/** Настоящее chunked multipart-тело: файл начат, но закрывающая граница ждёт команды теста. */
function holdUpload(base: string, role: 'manufacturer' | 'administrator', path = '/api/test/upload') {
  const abort = new AbortController();
  const boundary = 'imbc-held-upload';
  let settle!: (reply: HeldReply | Error) => void;
  const reply = new Promise<HeldReply | Error>((resolve) => {
    settle = resolve;
  });
  const req = request(
    `${base}${path}`,
    {
      method: 'POST',
      signal: abort.signal,
      headers: {
        origin: 'https://imbc.example.kz',
        cookie: `imbc-session=${role}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'transfer-encoding': 'chunked',
      },
    },
    (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', (error) => settle(error));
      res.on('end', () => {
        try {
          settle({
            status: res.statusCode ?? 0,
            retryAfter: res.headers['retry-after'],
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
          });
        } catch (error) {
          settle(error instanceof Error ? error : new Error('Ответ загрузки не разобран'));
        }
      });
    },
  );
  req.on('error', (error) => settle(error));
  req.write(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${SECRET_NAME}"\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  req.write(fixture('sample.pdf'));
  return {
    abort: () => abort.abort(),
    finish: () => req.end(`\r\n--${boundary}--\r\n`),
    async response(): Promise<HeldReply> {
      const result = await reply;
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('место загрузки до multer и до завершения обработки (DATA-06, NFR-09)', () => {
  let http: HttpStand;
  let slots: UploadSlots;
  const held: ReturnType<typeof holdUpload>[] = [];

  const start = async (process: number, account: number, gate?: UploadReplyGate) => {
    slots = new UploadSlots({ process, account });
    http = await startHttp({
      controllers: [UploadTestController, ...(gate ? [DelayedUploadTestController] : [])],
      providers: [
        { provide: UPLOAD_SLOTS, useValue: slots },
        ...(gate ? [{ provide: UPLOAD_REPLY_GATE, useValue: gate }] : []),
      ],
      accountIds: { administrator: '00000000-0000-4000-8000-0000000000a3' },
    });
  };
  const hold = (role: 'manufacturer' | 'administrator' = 'manufacturer', path?: string) => {
    const pending = holdUpload(http.base, role, path);
    held.push(pending);
    return pending;
  };

  afterEach(async () => {
    for (const pending of held.splice(0)) pending.abort();
    if (slots) await vi.waitFor(() => expect(slots.inUse).toBe(0));
    await http?.close();
    vi.restoreAllMocks();
  });

  it('занят общий предел: 503 upload_busy и Retry-After 5, незавершённое тело не читается', async () => {
    await start(1, 2);
    const first = hold();
    await vi.waitFor(() => expect(slots.inUse).toBe(1));
    // Этот маршрут ломает req.pipe: если multer начнёт читать тело, получим 500 вместо немедленного 503.
    const refused = hold('manufacturer', '/api/test/upload-broken');
    expect(await refused.response()).toMatchObject({
      status: 503,
      retryAfter: '5',
      body: { code: 'upload_busy' },
    });
    expect(slots.inUse).toBe(1);
    first.finish();
    expect((await first.response()).status).toBe(200);
    await vi.waitFor(() => expect(slots.inUse).toBe(0));
  });

  it('AbortController отменяет незавершённую загрузку и освобождает оба предела', async () => {
    await start(1, 1);
    const first = hold();
    await vi.waitFor(() => expect(slots.inUse).toBe(1));
    first.abort();
    await vi.waitFor(() => expect(slots.inUse).toBe(0));
    const next = await http.upload(
      '/api/test/upload',
      'manufacturer',
      form(['file', fixture('sample.pdf'), 'next.pdf']),
    );
    expect(next.status).toBe(200);
    await vi.waitFor(() => expect(slots.inUse).toBe(0));
  });

  it('полностью прочитанный файл занимает место, пока обработчик не завершился', async () => {
    let finish!: () => void;
    const gate = {
      entered: vi.fn(),
      pending: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    await start(1, 2, gate);
    const first = hold('manufacturer', '/api/test/upload-held-reply');
    first.finish();
    try {
      await vi.waitFor(() => expect(gate.entered).toHaveBeenCalledOnce());
      expect(slots.inUse).toBe(1);
      const refused = await http.upload(
        '/api/test/upload',
        'manufacturer',
        form(['file', fixture('sample.pdf'), 'next.pdf']),
      );
      expect(refused.status).toBe(503);
      expect(refused.headers.get('retry-after')).toBe('5');
      expect(await refused.json()).toMatchObject({ code: 'upload_busy' });
    } finally {
      finish();
    }
    expect((await first.response()).status).toBe(200);
    await vi.waitFor(() => expect(slots.inUse).toBe(0));
  });

  it('отмена после чтения тела не освобождает место, пока обработчик удерживает файл', async () => {
    let finish!: () => void;
    const gate = {
      entered: vi.fn(),
      closed: vi.fn(),
      pending: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    await start(1, 2, gate);
    const first = hold('manufacturer', '/api/test/upload-held-reply');
    first.finish();
    try {
      await vi.waitFor(() => expect(gate.entered).toHaveBeenCalledOnce());
      first.abort();
      // Ждём server-side close, чтобы тест не прошёл до обработки отмены соединения.
      await vi.waitFor(() => expect(gate.closed).toHaveBeenCalledOnce());
      expect(slots.inUse).toBe(1);
      const refused = await http.upload(
        '/api/test/upload',
        'manufacturer',
        form(['file', fixture('sample.pdf'), 'next.pdf']),
      );
      expect(refused.status).toBe(503);
      expect(refused.headers.get('retry-after')).toBe('5');
      expect(await refused.json()).toMatchObject({ code: 'upload_busy' });
    } finally {
      finish();
    }
    await vi.waitFor(() => expect(slots.inUse).toBe(0));
    const next = await http.upload(
      '/api/test/upload',
      'manufacturer',
      form(['file', fixture('sample.pdf'), 'next.pdf']),
    );
    expect(next.status).toBe(200);
  });

  it('ошибка обработчика после чтения файла освобождает место', async () => {
    let fail!: (error: Error) => void;
    const gate = {
      entered: vi.fn(),
      pending: new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    };
    await start(1, 1, gate);
    const first = hold('manufacturer', '/api/test/upload-held-reply');
    first.finish();
    try {
      await vi.waitFor(() => expect(gate.entered).toHaveBeenCalledOnce());
      expect(slots.inUse).toBe(1);
    } finally {
      fail(new ProblemException(503, 'storage_unavailable', 'Хранилище недоступно'));
    }
    expect(await first.response()).toMatchObject({ status: 503, body: { code: 'storage_unavailable' } });
    await vi.waitFor(() => expect(slots.inUse).toBe(0));
    const next = await http.upload(
      '/api/test/upload',
      'manufacturer',
      form(['file', fixture('sample.pdf'), 'next.pdf']),
    );
    expect(next.status).toBe(200);
  });

  it('третья загрузка аккаунта получает 429; другой аккаунт загружает через тот же ограничитель', async () => {
    await start(4, 2);
    const first = hold();
    const second = hold();
    await vi.waitFor(() => expect(slots.inUse).toBe(2));
    const refused = hold('manufacturer', '/api/test/upload-broken');
    expect(await refused.response()).toMatchObject({
      status: 429,
      retryAfter: '5',
      body: { code: 'upload_parallel_limit' },
    });
    const other = hold('administrator');
    await vi.waitFor(() => expect(slots.inUse).toBe(3));
    other.finish();
    expect((await other.response()).status).toBe(200);
    first.finish();
    second.finish();
    expect((await first.response()).status).toBe(200);
    expect((await second.response()).status).toBe(200);
    await vi.waitFor(() => expect(slots.inUse).toBe(0));
  });

  it('ошибка multipart освобождает место, следующий файл принимается', async () => {
    await start(1, 1);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const broken = await http.upload(
      '/api/test/upload-broken',
      'manufacturer',
      form(['file', fixture('sample.pdf'), SECRET_NAME]),
    );
    expect(broken.status).toBe(500);
    await vi.waitFor(() => expect(slots.inUse).toBe(0));
    const next = await http.upload(
      '/api/test/upload',
      'manufacturer',
      form(['file', fixture('sample.pdf'), 'next.pdf']),
    );
    expect(next.status).toBe(200);
  });
});

describe('соединение закрыто до перехватчика загрузки (DATA-06, NFR-09)', () => {
  it.each([
    { readableAborted: true, destroyed: false },
    { readableAborted: false, destroyed: true },
  ])('клиент ушёл во время проверки сеанса: место не занимается %#', async (closed) => {
    const slots = new UploadSlots({ process: 1, account: 1 });
    const interceptor = new (uploadInterceptor())(slots);
    const req = { auth: { user: { id: 'account-a' } }, readableAborted: closed.readableAborted, pipe: vi.fn() };
    const context = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ destroyed: closed.destroyed }) }),
    } as unknown as ExecutionContext;
    await expect(interceptor.intercept(context, { handle: vi.fn() })).rejects.toMatchObject({ code: 'validation' });
    expect(req.pipe).not.toHaveBeenCalled();
    expect(slots.inUse).toBe(0);
  });
});

describe('коды ошибок маршрутов файлов — контракт (FILE_PROBLEM_CODES)', () => {
  // Сервис, контроллер, загрузка, правила чтения, хранилище, транзакция исполнителя и guard, через которые
  // проходят маршруты файлов (скачивание этапа 2, загрузки этапов 2 и 3).
  const SOURCES = [
    '../src/modules/files/files.service.ts',
    '../src/modules/files/files.controller.ts',
    '../src/modules/files/upload.ts',
    '../src/modules/files/file-access.ts',
    '../src/modules/files/object-storage.ts',
    '../src/common/actor-transaction.ts',
    '../src/modules/auth/guards.ts',
  ];

  it('каждый код ProblemException этих файлов есть в списке, и каждый код списка встречается', () => {
    const thrown = new Set<string>();
    for (const source of SOURCES) {
      const text = readFileSync(new URL(source, import.meta.url), 'utf8');
      for (const match of text.matchAll(/new ProblemException\(\s*\d+,\s*'([a-z_]+)'/g)) thrown.add(match[1]!);
    }
    // validation — ZodError схемы и разбор multipart, internal — непредвиденная ошибка (500).
    const expected = new Set<string>([...thrown, 'validation', 'internal']);
    expect([...expected].sort()).toEqual([...FILE_PROBLEM_CODES].sort());
  });
});
