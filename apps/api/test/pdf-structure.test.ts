import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAX_OBJECT_STREAMS, type PdfStructureIssue, pdfStructureIssue } from '../src/modules/files/pdf-structure.js';
import { createInflateBudget, type InflateBudget, MAX_INFLATED_BYTES } from '../src/modules/files/zip-structure.js';

// Вложения PDF при загрузке (DATA-06, DATA-07, расхождение 5 плана): файл, вложенный в PDF, антивирус может не
// проверить (архив ZIP64 во вложении clamd признаёт чистым), поэтому PDF с вложениями не принимается. Правило —
// гигиеническое, по именам: `EmbeddedFile`, `EmbeddedFiles`, `FileAttachment` в байтах файла и в потоках объектов
// `/Type /ObjStm` с единственным фильтром `/FlateDecode`. Фикстуры — генератор задачи 3 (проверены poppler:
// `pdfdetach -list`, `pdfinfo`); прочие файлы собираются здесь по байтам.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));

const issue = (bytes: Buffer, budget: InflateBudget = createInflateBudget()) => pdfStructureIssue(bytes, budget);

const latin1 = (text: string) => Buffer.from(text, 'latin1');

/** PDF из частей: заголовок, части как есть (строки — latin1), конец файла. */
const pdf = (...parts: (string | Buffer)[]) =>
  Buffer.concat([
    latin1('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'),
    ...parts.map((part) => (typeof part === 'string' ? latin1(part) : part)),
    latin1('\nstartxref\n0\n%%EOF\n'),
  ]);

/** Содержимое потока объектов: один объект — каталог с деревом вложений (или то, что передано). */
const CATALOG_WITH_FILES = '1 0 << /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 3 0 R >> >>';
const CATALOG = '1 0 << /Type /Catalog /Pages 2 0 R >>';

const OBJSTM_DICT = '<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 0 >>';

/** Объект-поток: словарь, ключевое слово `stream`, конец строки, данные, `endstream` (если `end`). */
const streamObject = (
  num: number,
  data: Buffer,
  { dict = OBJSTM_DICT, eol = '\n', end = true }: { dict?: string; eol?: string; end?: boolean } = {},
) => Buffer.concat([latin1(`${num} 0 obj\n${dict}\nstream${eol}`), data, latin1(end ? '\nendstream\nendobj\n' : '')]);

/** Поток объектов с содержимым `content`, сжатым zlib (FlateDecode). */
const objStm = (num: number, content: string, options?: Parameters<typeof streamObject>[2]) =>
  streamObject(num, deflateSync(latin1(content)), options);

describe('pdfStructureIssue: фикстуры (DATA-06, DATA-07)', () => {
  it('sample.pdf — null; attachment.pdf, attachment-objstm.pdf, attachment-escaped.pdf, attachment-annotation.pdf — attachments; owner-password.pdf — null (потоки зашифрованного PDF не читаются, вложений в несжатой части нет)', () => {
    expect(issue(fixture('sample.pdf'))).toBeNull();
    for (const name of [
      'attachment.pdf',
      'attachment-objstm.pdf',
      'attachment-escaped.pdf',
      'attachment-annotation.pdf',
    ])
      expect(issue(fixture(name)), name).toBe<PdfStructureIssue>('attachments');
    expect(issue(fixture('owner-password.pdf'))).toBeNull();
  });

  it('attachment-objstm.pdf: имя вложения есть только в распакованном потоке объектов; распакованное списано с бюджета', () => {
    const bytes = fixture('attachment-objstm.pdf');
    for (const name of ['EmbeddedFile', 'FileAttachment']) expect(bytes.includes(name)).toBe(false);
    const budget = createInflateBudget();
    expect(issue(bytes, budget)).toBe('attachments');
    expect(budget.remainingBytes).toBeLessThan(MAX_INFLATED_BYTES);
    expect(budget.remainingBytes).toBeGreaterThan(MAX_INFLATED_BYTES - 1024);
  });
});

describe('pdfStructureIssue: имена PDF в байтах файла (DATA-06, DATA-07)', () => {
  it.each([
    '/EmbeddedFile',
    '/EmbeddedFiles',
    '/FileAttachment',
    '/Type/EmbeddedFile/Length 5',
    '/Names<</EmbeddedFiles 3 0 R>>',
    '/Subtype /FileAttachment/Rect[0 0 1 1]',
    '/EmbeddedFile]',
    '/EmbeddedFiles(x)',
    '/EmbeddedFiles{',
    '/EmbeddedFiles%comment',
    '/EmbeddedFiles\r',
    '/EmbeddedFiles\0',
    // Коды #xx раскрываются, в любом регистре цифр (ISO 32000-1, 7.3.5).
    '/Embedded#46iles',
    '/#45mbedded#46ile',
    '/#46ile#41ttachment',
    '/Embedded#46#69les',
    '/#45#6d#62#65#64#64#65#64#46#69#6c#65#73',
    '/#45#6D#62#65#64#64#65#64#46#69#6C#65#73',
  ])('%j — attachments', (name) => {
    expect(issue(pdf(`1 0 obj\n<< ${name} >>\nendobj\n`))).toBe('attachments');
    // Имя в самом конце файла, без разделителя после него.
    expect(issue(Buffer.concat([latin1('%PDF-1.7\n'), latin1(name)]))).toBe('attachments');
  });

  it.each([
    '/EmbeddedFilesX',
    '/MyEmbeddedFile',
    '/embeddedfiles',
    '/EMBEDDEDFILES',
    '/Embedded Files',
    '/Embedded#4Giles',
    '/Embedded#4',
    '/FileAttachments',
    '/EF',
    '/Filespec',
    '/AF',
    '(EmbeddedFiles)',
    'EmbeddedFile',
    '/Embedded#2046iles',
  ])('%j — null', (text) => {
    expect(issue(pdf(`1 0 obj\n<< /X ${text} >>\nendobj\n`))).toBeNull();
  });
});

describe('pdfStructureIssue: потоки объектов /Type /ObjStm с FlateDecode (DATA-06, DATA-07)', () => {
  it('имя вложения в распакованном потоке объектов — attachments; поток без него — null', () => {
    expect(issue(pdf(objStm(5, CATALOG_WITH_FILES)))).toBe('attachments');
    expect(issue(pdf(objStm(5, '1 0 << /Subtype /FileAttachment /FS 4 0 R >>')))).toBe('attachments');
    expect(issue(pdf(objStm(5, '1 0 << /Names << /Embedded#46iles 3 0 R >> >>')))).toBe('attachments');
    expect(issue(pdf(objStm(5, CATALOG)))).toBeNull();
    // Второй поток объектов тоже читается.
    expect(issue(pdf(objStm(5, CATALOG), objStm(6, CATALOG_WITH_FILES)))).toBe('attachments');
  });

  it.each([
    ['фильтр массивом из одного элемента', '<< /Type /ObjStm /N 1 /First 4 /Filter [ /FlateDecode ] /Length 9 >>'],
    ['без пробелов', '<</Type/ObjStm/N 1/First 4/Filter/FlateDecode/Length 9>>'],
    [
      'ключи в другом порядке, вложенный словарь параметров',
      '<< /Filter /FlateDecode /DecodeParms << /Columns 1 >> /Length 9 /N 1 /Type /ObjStm /First 4 >>',
    ],
    ['имена с кодами #xx', '<< /Ty#70e /Obj#53tm /N 1 /First 4 /Filt#65r /Fl#61teDecode >>'],
    [
      'ссылка на длину и /Extends',
      '<< /Type /ObjStm /Extends 9 0 R /N 1 /First 4 /Length 12 0 R /Filter /FlateDecode >>',
    ],
    [
      'комментарий и строка в словаре',
      '<< /Type /ObjStm % comment (\n /Note (a (nested) \\) /N) /N 1 /First 4 /Filter /FlateDecode >>',
    ],
    [
      'шестнадцатеричная строка перед концом словаря',
      '<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /ID <0a1b>>>',
    ],
  ])('словарь: %s — поток читается', (_case, dict) => {
    expect(issue(pdf(objStm(5, CATALOG_WITH_FILES, { dict })))).toBe('attachments');
  });

  it.each([
    ['не поток объектов (поток содержимого страницы)', '<< /Filter /FlateDecode /Length 9 >>'],
    ['/Type /XRef', '<< /Type /XRef /Filter /FlateDecode /W [1 2 1] >>'],
    ['фильтр не FlateDecode', '<< /Type /ObjStm /N 1 /First 4 /Filter /LZWDecode >>'],
    ['два фильтра', '<< /Type /ObjStm /N 1 /First 4 /Filter [ /ASCIIHexDecode /FlateDecode ] >>'],
    ['без фильтра', '<< /Type /ObjStm /N 1 /First 4 >>'],
    ['/ObjStm не значение /Type', '<< /Type /Metadata /Subtype /ObjStm /Filter /FlateDecode >>'],
    ['/Type /ObjStm только во вложенном словаре', '<< /DecodeParms << /Type /ObjStm >> /Filter /FlateDecode >>'],
    ['/Type /ObjStm только в комментарии', '<< /Filter /FlateDecode % /Type /ObjStm\n /N 1 >>'],
    ['/Type /ObjStm только в строке', '<< /Filter /FlateDecode /Note (/Type /ObjStm) /N 1 >>'],
  ])('словарь: %s — сжатые данные не читаются (null)', (_case, dict) => {
    expect(issue(pdf(objStm(5, CATALOG_WITH_FILES, { dict })))).toBeNull();
  });

  it('конец строки после stream — \\n, \\r\\n или \\r (пробелы перед ним допустимы); без endstream поток идёт до конца файла; endstream не принимается за начало потока', () => {
    for (const eol of ['\n', '\r\n', '\r', ' \r\n', '\t\n'])
      expect(issue(pdf(objStm(5, CATALOG_WITH_FILES, { eol }))), JSON.stringify(eol)).toBe('attachments');
    expect(issue(pdf(objStm(5, CATALOG_WITH_FILES, { end: false })))).toBe('attachments');
    // Ключевое слово без конца строки — не начало данных потока.
    expect(issue(pdf(objStm(5, CATALOG_WITH_FILES, { eol: ' ' })))).toBeNull();
    // Словарь, за которым endstream, — не начало потока.
    expect(issue(pdf(`${OBJSTM_DICT}endstream\n`, deflateSync(latin1(CATALOG_WITH_FILES)), '\nendobj\n'))).toBeNull();
  });

  it('поток оборван (нет последнего блока deflate) — читается распакованное начало; неверная контрольная сумма Adler-32 — поток читается', () => {
    // Содержимое сжимается плохо: обрыв на середине сжатых данных приходится на середину распакованного.
    const filler = Array.from({ length: 3000 }, (_, i) => String((i * 7919) % 100_003)).join(' ');
    const packed = deflateSync(latin1(`${CATALOG_WITH_FILES} ${filler}`));
    expect(packed.length).toBeGreaterThan(4000);
    // Обрыв посреди данных: имя — в первых байтах распакованного.
    expect(issue(pdf(streamObject(5, packed.subarray(0, Math.floor(packed.length / 2)))))).toBe('attachments');
    const badChecksum = Buffer.from(packed);
    badChecksum.writeUInt32BE((badChecksum.readUInt32BE(badChecksum.length - 4) ^ 1) >>> 0, badChecksum.length - 4);
    expect(issue(pdf(streamObject(5, badChecksum)))).toBe('attachments');
  });

  it('данные не в формате zlib (неверный заголовок) — поток пропускается без списания бюджета', () => {
    const budget = createInflateBudget();
    const notZlib = Buffer.concat([Buffer.from([0x78, 0x00]), deflateSync(latin1(CATALOG_WITH_FILES)).subarray(2)]);
    expect(issue(pdf(streamObject(5, notZlib), objStm(6, CATALOG)), budget)).toBeNull();
    expect(budget.remainingBytes).toBe(MAX_INFLATED_BYTES - CATALOG.length);
  });

  it('поток с испорченными данными deflate — пропускается, но списывает весь остаток бюджета: следующий поток объектов — inflate_limit (NFR-09)', () => {
    // Заголовок zlib верный, затем блок с недопустимым типом 11.
    const corrupt = Buffer.from([0x78, 0x9c, 0x07, 0xff, 0xff]);
    const alone = createInflateBudget();
    expect(issue(pdf(streamObject(5, corrupt)), alone)).toBeNull();
    expect(alone.remainingBytes).toBe(0);
    expect(issue(pdf(streamObject(5, corrupt), objStm(6, CATALOG)))).toBe('inflate_limit');
    // Имя вложения в несжатой части проверяется раньше потоков.
    expect(issue(pdf(streamObject(5, corrupt), '\n/EmbeddedFiles\n', objStm(6, CATALOG)))).toBe('attachments');
  });
});

describe('pdfStructureIssue: бюджет распаковки (DATA-07, NFR-09)', () => {
  it('распакованное списывается с remainingBytes; больше остатка — inflate_limit, ровно остаток — принят', () => {
    const budget = createInflateBudget();
    expect(issue(pdf(objStm(5, CATALOG), objStm(6, CATALOG)), budget)).toBeNull();
    expect(budget.remainingBytes).toBe(MAX_INFLATED_BYTES - 2 * CATALOG.length);

    const exact: InflateBudget = { ...createInflateBudget(), remainingBytes: CATALOG.length };
    expect(issue(pdf(objStm(5, CATALOG)), exact)).toBeNull();
    expect(exact.remainingBytes).toBe(0);
    const short: InflateBudget = { ...createInflateBudget(), remainingBytes: CATALOG.length - 1 };
    expect(issue(pdf(objStm(5, CATALOG)), short)).toBe('inflate_limit');
    // Остаток исчерпан — следующий поток объектов не распаковывается.
    expect(issue(pdf(objStm(5, CATALOG)), { ...createInflateBudget(), remainingBytes: 0 })).toBe('inflate_limit');
  });

  it('поток объектов больше MAX_INFLATED_BYTES распакованным — inflate_limit; два потока, вместе больше, — тоже', () => {
    const huge = streamObject(5, deflateSync(Buffer.alloc(MAX_INFLATED_BYTES + 1, 0x20)));
    expect(issue(pdf(huge))).toBe('inflate_limit');
    const half = streamObject(5, deflateSync(Buffer.alloc(MAX_INFLATED_BYTES / 2 + 1, 0x20)));
    expect(issue(pdf(half, half))).toBe('inflate_limit');
  });

  it(`потоков объектов больше MAX_OBJECT_STREAMS (${MAX_OBJECT_STREAMS}) — inflate_limit; ровно столько — принят`, () => {
    const one = objStm(5, CATALOG);
    expect(issue(pdf(...Array<Buffer>(MAX_OBJECT_STREAMS).fill(one)))).toBeNull();
    expect(issue(pdf(...Array<Buffer>(MAX_OBJECT_STREAMS + 1).fill(one)))).toBe('inflate_limit');
  });

  it('прочие потоки (содержимое страниц, картинки) не распаковываются и бюджет не тратят', () => {
    const budget = createInflateBudget();
    const content = streamObject(5, deflateSync(Buffer.alloc(MAX_INFLATED_BYTES + 1, 0x20)), {
      dict: '<< /Filter /FlateDecode >>',
    });
    expect(issue(pdf(content, content), budget)).toBeNull();
    expect(budget.remainingBytes).toBe(MAX_INFLATED_BYTES);
  });
});

describe('pdfStructureIssue: зашифрованный PDF — потоки объектов не читаются (расхождение 5)', () => {
  it('в файле есть имя Encrypt — несжатая часть проверяется, потоки объектов нет (их проверяет ClamAV)', () => {
    const trailer = 'trailer\n<< /Size 9 /Root 1 0 R /Encrypt 8 0 R >>';
    expect(issue(pdf(objStm(5, CATALOG_WITH_FILES), trailer))).toBeNull();
    expect(issue(pdf(objStm(5, CATALOG_WITH_FILES), '<< /Encr#79pt 8 0 R >>'))).toBeNull();
    expect(issue(pdf(objStm(5, CATALOG), trailer, '/EmbeddedFiles'))).toBe('attachments');
    // Похожее имя — не Encrypt.
    expect(issue(pdf(objStm(5, CATALOG_WITH_FILES), '<< /EncryptMetadata false >>'))).toBe('attachments');
  });
});
