import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { FILE_PROBLEM_CODES, MAX_FILE_BYTES } from '@imbc/contracts';
import { Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { acceptUpload, uploadInterceptor } from '../src/modules/files/upload.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница загрузки (DATA-06): multer с пределами, тип по содержимому, расширение имени, имя файла UTF-8.
// Хранилища и БД здесь нет: отказ происходит до них (файлы с базой — files.integration.test.ts).
const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));

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
}

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

  it('без сеанса — 401, файл не разбирается', async () => {
    const res = await http.upload('/api/test/upload', undefined, form(['file', fixture('sample.pdf'), 'a.pdf']));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'unauthenticated' });
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
