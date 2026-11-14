import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  createInflateBudget,
  MAX_ARCHIVE_ENTRIES,
  MAX_INFLATED_BYTES,
  MAX_NESTED_DEPTH,
  MAX_NESTED_PACKAGES,
  type ZipStructureIssue,
  zipStructureIssue,
} from '../src/modules/files/zip-structure.js';

// Структура ZIP документа DOCX и XLSX (DATA-06, DATA-07): антивирус (libclamav при сброшенном бите 3 берёт размеры
// и метод из локального заголовка) и Office (читает по центральному каталогу) должны читать архив одинаково.
// Архивы собираются здесь по байтам — каждая причина отказа отдельно; фикстуры — архивы Python `zipfile`.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));

const u16 = (value: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
};
const u32 = (value: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
};
const u64 = (value: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
};
/** Дополнительное поле: id, размер, данные. */
const extra = (id: number, data: Buffer = Buffer.alloc(16)) => Buffer.concat([u16(id), u16(data.length), data]);

const STORED = 0;
const DEFLATE = 8;
const DESCRIPTOR = 0x0008;

interface Header {
  signature?: number;
  flags?: number;
  method?: number;
  compressed?: number;
  uncompressed?: number;
}

interface Entry {
  name: string;
  /** Содержимое до сжатия; при методе 8 записывается сжатым deflate. */
  data: Buffer;
  /** Метод в обоих заголовках (по умолчанию 0 — stored). */
  method?: number;
  /** Флаги в обоих заголовках. */
  flags?: number;
  /** Описатель данных после записи: бит 3 в обоих заголовках, нули размеров в локальном. */
  descriptor?: 'signed' | 'unsigned';
  localExtra?: Buffer;
  centralExtra?: Buffer;
  /** Подмена полей локального заголовка. */
  local?: Header;
  /** Подмена полей записи каталога. */
  central?: Header & { offset?: number; disk?: number };
  /** Байты перед локальным заголовком записи — вне каталога; смещения записей их учитывают. */
  before?: Buffer;
  /** Данные записи как есть (уже сжатые) вместо сжатия `data`; `data` — для CRC и несжатого размера. */
  payload?: Buffer;
}

/**
 * Архив: локальные заголовки, данные и описатели, центральный каталог, запись его конца. `end` подменяет поля
 * записи конца, `beforeDirectory` вставляется между последней записью и каталогом, `beforeEnd` — между каталогом
 * и записью конца (записи ZIP64), `comment` — комментарий архива, `after` — байты после записи конца.
 */
function zip(
  entries: Entry[],
  options: {
    end?: {
      disk?: number;
      directoryDisk?: number;
      diskEntries?: number;
      entries?: number;
      size?: number;
      offset?: number;
    };
    beforeDirectory?: Buffer;
    beforeEnd?: (directoryOffset: number, directorySize: number, endOffset: number) => Buffer;
    comment?: Buffer;
    after?: Buffer;
  } = {},
): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (entry.before) {
      parts.push(entry.before);
      offset += entry.before.length;
    }
    const method = entry.method ?? STORED;
    const payload = entry.payload ?? (method === DEFLATE ? deflateRawSync(entry.data) : entry.data);
    const crc = crc32(entry.data);
    const flags = (entry.flags ?? 0) | (entry.descriptor ? DESCRIPTOR : 0);
    const name = Buffer.from(entry.name);
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const descriptor =
      entry.descriptor === undefined
        ? Buffer.alloc(0)
        : Buffer.concat([
            entry.descriptor === 'signed' ? u32(0x08074b50) : Buffer.alloc(0),
            u32(crc),
            u32(payload.length),
            u32(entry.data.length),
          ]);
    const local = Buffer.concat([
      u32(entry.local?.signature ?? 0x04034b50),
      u16(20),
      u16(entry.local?.flags ?? flags),
      u16(entry.local?.method ?? method),
      u16(0),
      u16(0),
      u32(entry.descriptor ? 0 : crc),
      u32(entry.local?.compressed ?? (entry.descriptor ? 0 : payload.length)),
      u32(entry.local?.uncompressed ?? (entry.descriptor ? 0 : entry.data.length)),
      u16(name.length),
      u16(localExtra.length),
      name,
      localExtra,
      payload,
      descriptor,
    ]);
    central.push(
      Buffer.concat([
        u32(entry.central?.signature ?? 0x02014b50),
        u16(20),
        u16(20),
        u16(entry.central?.flags ?? flags),
        u16(entry.central?.method ?? method),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.central?.compressed ?? payload.length),
        u32(entry.central?.uncompressed ?? entry.data.length),
        u16(name.length),
        u16(centralExtra.length),
        u16(0),
        u16(entry.central?.disk ?? 0),
        u16(0),
        u32(0),
        u32(entry.central?.offset ?? offset),
        name,
        centralExtra,
      ]),
    );
    offsets.push(offset);
    parts.push(local);
    offset += local.length;
  }
  if (options.beforeDirectory) {
    parts.push(options.beforeDirectory);
    offset += options.beforeDirectory.length;
  }
  const directoryOffset = offset;
  const directory = Buffer.concat(central);
  const endOffset = directoryOffset + directory.length;
  const between = options.beforeEnd?.(directoryOffset, directory.length, endOffset) ?? Buffer.alloc(0);
  const comment = options.comment ?? Buffer.alloc(0);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(options.end?.disk ?? 0),
    u16(options.end?.directoryDisk ?? 0),
    u16(options.end?.diskEntries ?? entries.length),
    u16(options.end?.entries ?? entries.length),
    u32(options.end?.size ?? directory.length),
    u32(options.end?.offset ?? directoryOffset),
    u16(comment.length),
    comment,
  ]);
  return Buffer.concat([...parts, directory, between, end, options.after ?? Buffer.alloc(0)]);
}

const TEXT = Buffer.from('<w:document>'.concat('Құрылым IMBC '.repeat(40), '</w:document>'));
const ENTRIES: Entry[] = [
  { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
  { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
];
const withEntry = (index: number, change: Partial<Entry>) =>
  ENTRIES.map((entry, i) => (i === index ? { ...entry, ...change } : entry));
/** Вторая запись — сжатый текст с подменой полей. */
const deflated = (change: Partial<Entry> = {}) => withEntry(1, { data: TEXT, method: DEFLATE, ...change });

/**
 * Настоящий архив, в комментарии записи конца которого — поддельная запись конца каталога (указывает на каталог
 * другого архива) и `tail`.
 */
const forgedEnd = (tail: Buffer) => {
  const real = zip(ENTRIES);
  const other = zip(withEntry(1, { data: Buffer.from('<w:document>подмена</w:document>') }));
  const forged = other.subarray(other.length - 22);
  return Buffer.concat([real.subarray(0, real.length - 2), u16(forged.length + tail.length), forged, tail]);
};

/** Запись конца каталога ZIP64 (56 байт) и её локатор (20 байт). */
const zip64Records = (entries: number) => (directoryOffset: number, directorySize: number, endOffset: number) =>
  Buffer.concat([
    u32(0x06064b50),
    u64(44),
    u16(45),
    u16(45),
    u32(0),
    u32(0),
    u64(entries),
    u64(entries),
    u64(directorySize),
    u64(directoryOffset),
    u32(0x07064b50),
    u32(0),
    u64(endOffset),
    u32(1),
  ]);

describe('zipStructureIssue: архив, который антивирус и Office читают одинаково (DATA-07)', () => {
  it.each<[string, () => Buffer]>([
    ['stored', () => zip(ENTRIES)],
    ['deflate', () => zip(deflated())],
    [
      'описатель данных с сигнатурой (бит 3, нули в локальном заголовке), stored',
      () => zip(withEntry(1, { descriptor: 'signed' })),
    ],
    ['описатель данных без сигнатуры, deflate', () => zip(deflated({ descriptor: 'unsigned' }))],
    [
      'описатель данных, в локальном заголовке настоящие размеры',
      () => {
        const payload = deflateRawSync(TEXT);
        return zip(
          deflated({ descriptor: 'signed', local: { compressed: payload.length, uncompressed: TEXT.length } }),
        );
      },
    ],
    [
      'все записи с описателем данных',
      () => zip(ENTRIES.map((entry) => ({ ...entry, method: DEFLATE, descriptor: 'signed' as const }))),
    ],
    [
      'UTF-8 имя (бит 11) и выравнивание дополнительных полей',
      () =>
        zip(withEntry(0, { flags: 0x0800, localExtra: Buffer.alloc(3), centralExtra: extra(0x5455, Buffer.alloc(5)) })),
    ],
    [
      'запись-каталог нулевой длины (word/)',
      () => zip([ENTRIES[0]!, { name: 'word/', data: Buffer.alloc(0) }, ENTRIES[1]!]),
    ],
    ['sample.docx', () => fixture('sample.docx')],
    ['sample.xlsx', () => fixture('sample.xlsx')],
    ['DOCX, записанный Python zipfile с ZIP_DEFLATED', () => fixture('sample-deflated.docx')],
  ])('принимается: %s', (_name, build) => {
    expect(zipStructureIssue(build())).toBeNull();
  });

  it.each<[string, () => Buffer, ZipStructureIssue]>([
    // Запись конца каталога: ровно последние 22 байта, комментария нет.
    ['нет записи конца каталога (усечённый архив)', () => zip(ENTRIES).subarray(0, -10), 'end_record_missing'],
    ['не ZIP', () => Buffer.from('%PDF-1.7 не архив'), 'end_record_missing'],
    ['комментарий архива', () => zip(ENTRIES, { comment: Buffer.from('IMBC') }), 'archive_comment'],
    [
      'комментарий длиннее остатка файла',
      () => zip(ENTRIES, { comment: Buffer.from('IMBC') }).subarray(0, -1),
      'archive_comment',
    ],
    ['байты после записи конца каталога', () => zip(ENTRIES, { after: Buffer.from('trailer') }), 'archive_comment'],
    [
      // clamd и читатели Office берут первую сигнатуру с конца — подделку; функция проверяет ту же запись.
      'поддельная запись конца каталога в комментарии настоящей, за ней ещё байты комментария',
      () => forgedEnd(Buffer.from('!')),
      'archive_comment',
    ],
    [
      'поддельная запись конца каталога — весь комментарий настоящей: проверяется подделка, её каталог не вплотную',
      () => forgedEnd(Buffer.alloc(0)),
      'central_directory_bounds',
    ],
    ['локатор конца каталога ZIP64 (0x07064b50)', () => zip(ENTRIES, { beforeEnd: zip64Records(2) }), 'zip64_locator'],
    [
      'запись конца каталога ZIP64 (0x06064b50) без локатора',
      () => zip(ENTRIES, { beforeEnd: (o, s, e) => zip64Records(2)(o, s, e).subarray(0, 56) }),
      'zip64_end_record',
    ],
    ['число записей тома 0xFFFF', () => zip(ENTRIES, { end: { diskEntries: 0xffff } }), 'zip64_end_values'],
    ['общее число записей 0xFFFF', () => zip(ENTRIES, { end: { entries: 0xffff } }), 'zip64_end_values'],
    ['размер каталога 0xFFFFFFFF', () => zip(ENTRIES, { end: { size: 0xffffffff } }), 'zip64_end_values'],
    ['смещение каталога 0xFFFFFFFF', () => zip(ENTRIES, { end: { offset: 0xffffffff } }), 'zip64_end_values'],
    ['номер диска не 0', () => zip(ENTRIES, { end: { disk: 1 } }), 'multi_disk'],
    ['число записей тома не равно общему', () => zip(ENTRIES, { end: { diskEntries: 1 } }), 'multi_disk'],
    [
      'смещение каталога за пределами файла',
      () => zip(ENTRIES, { end: { offset: 100_000 } }),
      'central_directory_bounds',
    ],
    [
      'каталог не вплотную к записи конца',
      () => zip(ENTRIES, { beforeEnd: () => Buffer.alloc(8) }),
      'central_directory_bounds',
    ],
    [
      'в записи конца записей меньше, чем в каталоге',
      () => zip(ENTRIES, { end: { diskEntries: 1, entries: 1 } }),
      'central_directory_bounds',
    ],
    // Записи центрального каталога.
    [
      'каталог: сжатый размер 0xFFFFFFFF',
      () => zip(withEntry(1, { central: { compressed: 0xffffffff } })),
      'zip64_central_values',
    ],
    [
      'каталог: несжатый размер 0xFFFFFFFF',
      () => zip(withEntry(1, { central: { uncompressed: 0xffffffff } })),
      'zip64_central_values',
    ],
    [
      'каталог: смещение 0xFFFFFFFF',
      () => zip(withEntry(1, { central: { offset: 0xffffffff } })),
      'zip64_central_values',
    ],
    ['каталог: номер диска 0xFFFF', () => zip(withEntry(1, { central: { disk: 0xffff } })), 'zip64_central_values'],
    [
      'каталог: дополнительное поле ZIP64 0x0001',
      () => zip(withEntry(1, { centralExtra: extra(0x0001) })),
      'zip64_central_extra',
    ],
    [
      'каталог: поле ZIP64 после другого поля',
      () => zip(withEntry(1, { centralExtra: Buffer.concat([extra(0x5455, Buffer.alloc(5)), extra(0x0001)]) })),
      'zip64_central_extra',
    ],
    ['каталог: номер диска записи не 0', () => zip(withEntry(1, { central: { disk: 1 } })), 'multi_disk'],
    [
      'каталог: нет сигнатуры записи',
      () => zip(withEntry(1, { central: { signature: 0x12345678 } })),
      'central_entry_malformed',
    ],
    [
      'каталог: дополнительное поле длиннее своей области',
      () => zip(withEntry(1, { centralExtra: Buffer.concat([u16(0x5455), u16(40), Buffer.alloc(4)]) })),
      'central_entry_malformed',
    ],
    // Локальные заголовки: ZIP64 и повреждения.
    [
      'локальный: сжатый размер 0xFFFFFFFF',
      () => zip(withEntry(1, { local: { compressed: 0xffffffff } })),
      'zip64_local_values',
    ],
    [
      'локальный: несжатый размер 0xFFFFFFFF',
      () => zip(withEntry(1, { local: { uncompressed: 0xffffffff } })),
      'zip64_local_values',
    ],
    [
      'локальный: дополнительное поле ZIP64 0x0001',
      () => zip(withEntry(1, { localExtra: extra(0x0001) })),
      'zip64_local_extra',
    ],
    [
      'локальный: нет сигнатуры заголовка',
      () => zip(withEntry(1, { local: { signature: 0x12345678 } })),
      'local_header_malformed',
    ],
    [
      'локальный: смещение за началом каталога',
      () => zip(withEntry(1, { central: { offset: 10_000 } })),
      'local_header_malformed',
    ],
    [
      'локальный: данные заходят в каталог',
      () => zip(withEntry(1, { local: { compressed: 1000 }, central: { compressed: 1000 } })),
      'local_header_malformed',
    ],
    [
      'локальный: дополнительное поле длиннее своей области',
      () => zip(withEntry(1, { localExtra: Buffer.concat([u16(0x5455), u16(40), Buffer.alloc(4)]) })),
      'local_header_malformed',
    ],
    // Локальный заголовок расходится с каталогом: так запись проходит мимо антивируса.
    ['шифрование: бит 0 в обоих заголовках', () => zip(withEntry(1, { flags: 0x0001 })), 'encrypted'],
    [
      'шифрование: бит 0 только в локальном заголовке',
      () => zip(withEntry(1, { local: { flags: 0x0001 } })),
      'encrypted',
    ],
    ['шифрование: бит 0 только в каталоге', () => zip(withEntry(1, { central: { flags: 0x0001 } })), 'encrypted'],
    ['шифрование каталога: бит 13', () => zip(withEntry(1, { flags: 0x2000 })), 'encrypted'],
    ['сильное шифрование: бит 6 сам по себе', () => zip(withEntry(1, { flags: 0x0040 })), 'encrypted'],
    ['бит 3 только в каталоге', () => zip(deflated({ central: { flags: DESCRIPTOR } })), 'descriptor_flag_mismatch'],
    [
      'бит 3 только в локальном заголовке',
      () => zip(deflated({ local: { flags: DESCRIPTOR } })),
      'descriptor_flag_mismatch',
    ],
    [
      'метод 8 в каталоге, 0 в локальном заголовке',
      () => zip(deflated({ local: { method: STORED } })),
      'method_mismatch',
    ],
    [
      'метод 0 в каталоге, 8 в локальном заголовке',
      () => zip(deflated({ central: { method: STORED } })),
      'method_mismatch',
    ],
    ['метод 14 (LZMA) в обоих заголовках', () => zip(withEntry(1, { method: 14 })), 'method_unsupported'],
    ['метод 12 (bzip2) в обоих заголовках', () => zip(withEntry(1, { method: 12 })), 'method_unsupported'],
    [
      'бит 3 сброшен, в локальном заголовке csize = usize = 0 при настоящих размерах в каталоге',
      () => zip(deflated({ local: { compressed: 0, uncompressed: 0 } })),
      'local_sizes_mismatch',
    ],
    [
      'бит 3 сброшен, локальный csize меньше настоящего',
      () => zip(deflated({ local: { compressed: 10 } })),
      'local_sizes_mismatch',
    ],
    [
      'бит 3 сброшен, локальный usize не равен каталогу',
      () => zip(deflated({ local: { uncompressed: 1 } })),
      'local_sizes_mismatch',
    ],
    [
      'бит 3 установлен, в локальном заголовке не нули и не размеры каталога',
      () => zip(deflated({ descriptor: 'signed', local: { compressed: 10, uncompressed: TEXT.length } })),
      'local_sizes_mismatch',
    ],
    [
      'бит 3 установлен, в локальном заголовке сжатый 0, несжатый настоящий',
      () => zip(deflated({ descriptor: 'signed', local: { compressed: 0, uncompressed: TEXT.length } })),
      'local_sizes_mismatch',
    ],
    // Несжатая запись: clamd и Office читают её данные по разным размерам, если они не равны.
    [
      'stored: несжатый размер не равен сжатому (в обоих заголовках)',
      () => zip(withEntry(1, { local: { uncompressed: 99 }, central: { uncompressed: 99 } })),
      'stored_sizes_mismatch',
    ],
    [
      'stored с описателем данных: в каталоге несжатый размер не равен сжатому',
      () => zip(withEntry(1, { descriptor: 'signed', central: { uncompressed: 99 } })),
      'stored_sizes_mismatch',
    ],
    // Каталог описывает пакет Office: хотя бы одна запись и [Content_Types].xml в корне.
    ['каталог из нуля записей', () => zip([]), 'directory_empty'],
    [
      'нет записи [Content_Types].xml',
      () => zip([{ name: 'word/document.xml', data: Buffer.from('<w:document/>') }]),
      'content_types_missing',
    ],
    [
      '[content_types].xml в другом регистре',
      () => zip(withEntry(0, { name: '[content_types].xml' })),
      'content_types_missing',
    ],
    [
      '[Content_Types].xml не в корне архива',
      () => zip(withEntry(0, { name: 'word/[Content_Types].xml' })),
      'content_types_missing',
    ],
    // Две записи каталога на одни данные (архивная бомба с перекрытием).
    [
      'данные записей перекрываются',
      () =>
        zip([
          { name: 'a.xml', data: Buffer.from('AAAA') },
          { name: 'b.xml', data: Buffer.from('BBBB'), central: { offset: 0 } },
        ]),
      'entries_overlap',
    ],
  ])('отказ: %s — %s', (_name, build, issue) => {
    expect(zipStructureIssue(build())).toBe(issue);
  });

  it('архивы Python zipfile: запись с force_zip64 (ZIP64 только в локальном заголовке, каталог обычный) в DOCX и XLSX, каталог ZIP64, усечённый DOCX — отказ', () => {
    expect(zipStructureIssue(fixture('zip64-local.docx'))).toBe('zip64_local_values');
    expect(zipStructureIssue(fixture('zip64-local.xlsx'))).toBe('zip64_local_values');
    expect(zipStructureIssue(fixture('zip64-directory.docx'))).toBe('zip64_locator');
    expect(zipStructureIssue(fixture('truncated.docx'))).toBe('end_record_missing');
    // В каталоге zip64-local.docx размеры обычные: причина видна только по локальному заголовку.
    const local = fixture('zip64-local.docx');
    const central = local.lastIndexOf(Buffer.from('word/media/x.bin')) - 46;
    expect(local.readUInt32LE(central)).toBe(0x02014b50);
    expect(local.readUInt32LE(central + 20)).toBe(24);
    expect(local.readUInt16LE(central + 30)).toBe(0);
  });
});

// Вложенные пакеты (DOCX с диаграммой хранит XLSX): clamd разбирает их тем же кодом, что и внешний архив, — каждый
// проверяется той же функцией, с пределами глубины, числа пакетов и объёма распаковки на файл.
const XLSX_ENTRIES: Entry[] = [
  { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
  { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') },
];
/** Запись с вложенным пакетом (по умолчанию сжата deflate, как пишет Word). */
const embedded = (data: Buffer, change: Partial<Entry> = {}): Entry => ({
  name: 'word/embeddings/sheet.xlsx',
  data,
  method: DEFLATE,
  ...change,
});
/** DOCX из двух записей и `extra`. */
const docx = (...extra: Entry[]) => zip([...ENTRIES, ...extra]);
/** XLSX из двух записей и `extra`. */
const xlsx = (...extra: Entry[]) => zip([...XLSX_ENTRIES, ...extra]);
/** Пустые несжатые блоки deflate (5 байт каждый): поток не даёт ни байта, пока они не кончатся. */
const emptyBlocks = (count: number) =>
  Buffer.concat(Array.from({ length: count }, () => Buffer.from('000000ffff', 'hex')));

describe('zipStructureIssue: вложенные пакеты, записи вне каталога (DATA-07)', () => {
  it('вложенный законный XLSX в DOCX принят; вложенный XLSX с ZIP64 в локальном заголовке — zip64_local_values (DATA-07)', () => {
    expect(zipStructureIssue(fixture('nested.docx'))).toBeNull();
    expect(zipStructureIssue(fixture('nested-zip64.docx'))).toBe('zip64_local_values');
    // Тот же вложенный файл, собранный по байтам: сжатый, несжатый, под именем [Content_Types].xml.
    expect(zipStructureIssue(docx(embedded(fixture('sample.xlsx'))))).toBeNull();
    expect(zipStructureIssue(docx(embedded(fixture('sample.xlsx'), { method: STORED })))).toBeNull();
    expect(zipStructureIssue(docx(embedded(fixture('zip64-local.xlsx'))))).toBe('zip64_local_values');
    expect(zipStructureIssue(docx(embedded(fixture('zip64-local.xlsx'), { method: STORED })))).toBe(
      'zip64_local_values',
    );
    expect(zipStructureIssue(zip([{ name: '[Content_Types].xml', data: fixture('zip64-local.xlsx') }]))).toBe(
      'zip64_local_values',
    );
    // Первая причина вложенного пакета возвращается как есть.
    expect(zipStructureIssue(docx(embedded(fixture('truncated.docx'))))).toBe('end_record_missing');
    expect(zipStructureIssue(docx(embedded(fixture('gap.docx'))))).toBe('entries_gap');
    expect(zipStructureIssue(docx(embedded(zip([{ name: 'a.txt', data: Buffer.from('a') }]))))).toBe(
      'content_types_missing',
    );
    // Бюджет файла расходуется: один пакет, распакованные байты (пакет в 604 байта и начала записей), пять записей.
    const budget = createInflateBudget();
    expect(budget).toEqual({
      remainingBytes: MAX_INFLATED_BYTES,
      remainingPackages: MAX_NESTED_PACKAGES,
      remainingEntries: MAX_ARCHIVE_ENTRIES,
    });
    expect(zipStructureIssue(fixture('nested.docx'), { budget })).toBeNull();
    expect(budget.remainingPackages).toBe(MAX_NESTED_PACKAGES - 1);
    expect(budget.remainingBytes).toBeLessThan(MAX_INFLATED_BYTES - 604);
    expect(budget.remainingEntries).toBe(MAX_ARCHIVE_ENTRIES - 5);
  });

  it('три уровня вложения — nested_too_deep; 33 вложенных пакета — nested_too_many; вложенный пакет больше 64 МиБ после распаковки — inflate_limit (бюджет общий на файл)', () => {
    expect(MAX_NESTED_DEPTH).toBe(2);
    expect(MAX_NESTED_PACKAGES).toBe(32);
    expect(MAX_INFLATED_BYTES).toBe(64 * 1024 * 1024);

    expect(zipStructureIssue(fixture('nested-deep.docx'))).toBe('nested_too_deep');
    const level2 = fixture('sample.xlsx');
    const level1 = xlsx(embedded(level2, { name: 'xl/embeddings/level2.xlsx' }));
    expect(zipStructureIssue(docx(embedded(level1)))).toBeNull();
    const deeper = xlsx(embedded(xlsx(embedded(level2, { name: 'xl/embeddings/level3.xlsx' })), { name: 'x.xlsx' }));
    expect(zipStructureIssue(docx(embedded(deeper)))).toBe('nested_too_deep');
    // Глубина задаётся параметром: пакет на глубине 2 вложенного уже не содержит.
    expect(zipStructureIssue(fixture('nested.docx'), { depth: 1 })).toBeNull();
    expect(zipStructureIssue(fixture('nested.docx'), { depth: 2 })).toBe('nested_too_deep');

    const sheets = (count: number) =>
      Array.from({ length: count }, (_, i) => embedded(level2, { name: `word/embeddings/sheet${i}.xlsx` }));
    expect(zipStructureIssue(docx(...sheets(32)))).toBeNull();
    expect(zipStructureIssue(docx(...sheets(33)))).toBe('nested_too_many');
    // Пакеты второго уровня считаются в том же бюджете: 16 × (пакет + вложенный в него) = 32.
    const pairs = (count: number) =>
      Array.from({ length: count }, (_, i) => embedded(level1, { name: `word/embeddings/pair${i}.xlsx` }));
    expect(zipStructureIssue(docx(...pairs(16)))).toBeNull();
    expect(zipStructureIssue(docx(...pairs(16), embedded(level2, { name: 'word/embeddings/one-more.xlsx' })))).toBe(
      'nested_too_many',
    );

    // Пакет больше 64 МиБ после распаковки (сжатый — около 64 КиБ).
    const huge = xlsx({ name: 'xl/media/zeros.bin', data: Buffer.alloc(MAX_INFLATED_BYTES) });
    expect(huge.length).toBeGreaterThan(MAX_INFLATED_BYTES);
    const hugeEntry = embedded(huge);
    expect(zipStructureIssue(docx(hugeEntry))).toBe('inflate_limit');
    // Бюджет общий на файл: два пакета по 40 МиБ порознь принимаются, вместе — нет.
    const large = xlsx({ name: 'xl/media/zeros.bin', data: Buffer.alloc(40 * 1024 * 1024) });
    const first = { ...embedded(large, { name: 'word/embeddings/a.xlsx' }), payload: deflateRawSync(large) };
    const second = { ...first, name: 'word/embeddings/b.xlsx' };
    expect(zipStructureIssue(docx(first))).toBeNull();
    expect(zipStructureIssue(docx(first, second))).toBe('inflate_limit');
    // Переданный бюджет соблюдается: на распаковку начала записей уже не хватает байтов, пакетов не осталось.
    const left = (change: Partial<ReturnType<typeof createInflateBudget>>) => ({ ...createInflateBudget(), ...change });
    expect(zipStructureIssue(fixture('nested.docx'), { budget: left({ remainingBytes: 100 }) })).toBe('inflate_limit');
    expect(zipStructureIssue(fixture('nested.docx'), { budget: left({ remainingPackages: 0 }) })).toBe(
      'nested_too_many',
    );
  });

  it('записей в файле и вложенных пакетах вместе больше 65 535 — entries_too_many: ограничено время проверки', () => {
    expect(MAX_ARCHIVE_ENTRIES).toBe(65_535);
    // DOCX из трёх записей и вложенный XLSX из 2 + n записей: всего 65 535 — принят, 65 536 — отказ.
    const filler = (count: number) =>
      Array.from({ length: count }, (): Entry => ({ name: 'a', data: Buffer.alloc(0) }));
    expect(zipStructureIssue(docx(embedded(xlsx(...filler(65_530)))))).toBeNull();
    expect(zipStructureIssue(docx(embedded(xlsx(...filler(65_531)))))).toBe('entries_too_many');
    // Сам файл пределом не ограничен сильнее, чем форматом: 65 534 записи (больше — только ZIP64) принимаются.
    expect(zipStructureIssue(docx(...filler(65_532)))).toBeNull();
    expect(
      zipStructureIssue(fixture('nested.docx'), { budget: { ...createInflateBudget(), remainingEntries: 4 } }),
    ).toBe('entries_too_many');
  });

  it('64 нулевых байта между записями — entries_gap; байты до первой записи — entries_gap; записи с битом 3 и описателем 12 и 16 байт — приняты', () => {
    expect(zipStructureIssue(fixture('gap.docx'))).toBe('entries_gap');
    expect(zipStructureIssue(zip(withEntry(1, { before: Buffer.alloc(64) })))).toBe('entries_gap');
    expect(zipStructureIssue(zip(withEntry(0, { before: Buffer.from('MZ') })))).toBe('entries_gap');
    expect(zipStructureIssue(zip(ENTRIES, { beforeDirectory: Buffer.alloc(1) }))).toBe('entries_gap');
    // Запись вне каталога: целый локальный заголовок с данными, на который каталог не ссылается.
    const hidden = zip([
      { name: 'word/hidden.bin', data: Buffer.from('скрытая запись IMBC '.repeat(8)), method: DEFLATE },
    ]);
    const hiddenRecord = hidden.subarray(0, hidden.readUInt32LE(hidden.length - 6));
    expect(zipStructureIssue(zip(withEntry(1, { before: hiddenRecord })))).toBe('entries_gap');
    expect(zipStructureIssue(zip(ENTRIES, { beforeDirectory: hiddenRecord }))).toBe('entries_gap');

    // Описатель данных: 16 байт с сигнатурой 50 4B 07 08 (Java, Python без seek), 12 байт без неё.
    expect(zipStructureIssue(fixture('descriptor.xlsx'))).toBeNull();
    expect(zipStructureIssue(zip(deflated({ descriptor: 'signed' })))).toBeNull();
    expect(zipStructureIssue(zip(deflated({ descriptor: 'unsigned' })))).toBeNull();
    expect(zipStructureIssue(zip(withEntry(0, { descriptor: 'unsigned' })))).toBeNull();
    expect(
      zipStructureIssue(zip(ENTRIES.map((entry) => ({ ...entry, method: DEFLATE, descriptor: 'unsigned' as const })))),
    ).toBeNull();
    // Бит 3 без описателя и описатель без бита 3 — данные записи кончаются не там, где начинается следующая.
    expect(zipStructureIssue(zip(withEntry(0, { flags: DESCRIPTOR })))).toBe('entries_gap');
    expect(zipStructureIssue(zip(withEntry(1, { flags: DESCRIPTOR })))).toBe('entries_gap');
    expect(zipStructureIssue(zip(withEntry(1, { before: Buffer.concat([u32(0x08074b50), Buffer.alloc(12)]) })))).toBe(
      'entries_gap',
    );
    // Описатель длиннее 16 байт (ZIP64: 24) — промежуток.
    expect(
      zipStructureIssue(
        zip([
          { ...ENTRIES[0]!, descriptor: 'signed' },
          { ...ENTRIES[1]!, before: Buffer.alloc(8) },
        ]),
      ),
    ).toBe('entries_gap');
  });

  it('фикстуры этапа 2 sample.docx и sample.xlsx по-прежнему приняты', () => {
    for (const name of ['sample.docx', 'sample.xlsx', 'sample-deflated.docx']) {
      const budget = createInflateBudget();
      expect(zipStructureIssue(fixture(name), { budget }), name).toBeNull();
      // Вложенных пакетов нет — бюджет пакетов не тронут.
      expect(budget.remainingPackages, name).toBe(MAX_NESTED_PACKAGES);
    }
  });

  it('начало сжатой записи: пакет за пустыми блоками deflate виден по первому КиБ; больше КиБ без данных, испорченный поток, обрыв и неверный размер вложенного пакета — entry_data_malformed', () => {
    const nested = (blocks: number, data: Buffer, change: Partial<Entry> = {}) =>
      docx(embedded(data, { payload: Buffer.concat([emptyBlocks(blocks), deflateRawSync(data)]), ...change }));
    // 70 байт пустых блоков: первые 64 байта не дают данных, первый КиБ — даёт.
    expect(zipStructureIssue(nested(14, fixture('sample.xlsx')))).toBeNull();
    expect(zipStructureIssue(nested(14, fixture('zip64-local.xlsx')))).toBe('zip64_local_values');
    // 1050 байт пустых блоков: начало данных записи не определить — отказ, а не «не пакет».
    expect(zipStructureIssue(nested(210, fixture('zip64-local.xlsx')))).toBe('entry_data_malformed');
    expect(zipStructureIssue(nested(210, Buffer.from('<w:document/>'), { name: 'word/document2.xml' }))).toBe(
      'entry_data_malformed',
    );
    // Короткая запись, весь поток прочитан: меньше 4 байт данных — не пакет.
    expect(zipStructureIssue(nested(100, Buffer.from('ab'), { name: 'word/short.xml' }))).toBeNull();
    expect(zipStructureIssue(docx({ name: 'word/empty.xml', data: Buffer.alloc(0), method: DEFLATE }))).toBeNull();

    // Испорченный поток deflate: блок типа 3.
    expect(
      zipStructureIssue(
        docx({
          name: 'word/bad.xml',
          data: Buffer.from('abcd'),
          method: DEFLATE,
          payload: Buffer.from([0x07, 0, 0, 0]),
        }),
      ),
    ).toBe('entry_data_malformed');
    // Вложенный пакет: поток оборван, распакованный размер больше или меньше заявленного в обоих заголовках.
    const sample = fixture('sample.xlsx');
    const stream = deflateRawSync(sample);
    expect(zipStructureIssue(docx(embedded(sample, { payload: stream.subarray(0, stream.length - 8) })))).toBe(
      'entry_data_malformed',
    );
    const sized = (uncompressed: number) => embedded(sample, { local: { uncompressed }, central: { uncompressed } });
    expect(zipStructureIssue(docx(sized(sample.length - 1)))).toBe('entry_data_malformed');
    expect(zipStructureIssue(docx(sized(sample.length + 1)))).toBe('entry_data_malformed');
    expect(zipStructureIssue(docx(sized(3)))).toBe('entry_data_malformed');
    // Короткий «пакет» (сигнатура и обрывок, 18 байт) распаковывается и проверяется как пакет.
    const stub = Buffer.concat([u32(0x04034b50), Buffer.from('обрывок')]);
    expect(zipStructureIssue(docx(embedded(stub)))).toBe('end_record_missing');
    expect(zipStructureIssue(docx(embedded(stub, { method: STORED })))).toBe('end_record_missing');
    // Заявлен маленький размер, а распаковывается 64 МиБ — распаковка останавливается на заявленном.
    const huge = xlsx({ name: 'xl/media/zeros.bin', data: Buffer.alloc(MAX_INFLATED_BYTES) });
    expect(
      zipStructureIssue(docx(embedded(huge, { local: { uncompressed: 4096 }, central: { uncompressed: 4096 } }))),
    ).toBe('entry_data_malformed');
  });
});
