import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ZipStructureIssue, zipStructureIssue } from '../src/modules/files/zip-structure.js';

// Структура ZIP документа DOCX и XLSX (DATA-06, DATA-07): ClamAV 1.4 не разбирает записи ZIP64 и отвечает по ним
// «OK», поэтому архив с любым признаком ZIP64 или повреждённой структурой платформа не принимает. Архивы собираются
// здесь по байтам — каждый признак отдельно; фикстуры — архивы, записанные Python `zipfile`.
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

interface Entry {
  name: string;
  data: Buffer;
  localExtra?: Buffer;
  centralExtra?: Buffer;
  /** Подмена полей локального заголовка. */
  local?: { compressed?: number; uncompressed?: number; signature?: number };
  /** Подмена полей записи каталога. */
  central?: { compressed?: number; uncompressed?: number; offset?: number; disk?: number; signature?: number };
}

/**
 * Архив без сжатия: локальные заголовки и данные, центральный каталог, запись его конца. `end` подменяет поля
 * записи конца, `beforeEnd` вставляется между каталогом и записью конца (записи ZIP64).
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
    beforeEnd?: (directoryOffset: number, directorySize: number, endOffset: number) => Buffer;
    comment?: Buffer;
  } = {},
): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const header = Buffer.concat([
      u32(entry.local?.signature ?? 0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(entry.local?.compressed ?? entry.data.length),
      u32(entry.local?.uncompressed ?? entry.data.length),
      u16(name.length),
      u16(localExtra.length),
      name,
      localExtra,
      entry.data,
    ]);
    offsets.push(offset);
    parts.push(header);
    offset += header.length;
  }
  const directoryOffset = offset;
  const central = entries.map((entry, index) => {
    const name = Buffer.from(entry.name);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    return Buffer.concat([
      u32(entry.central?.signature ?? 0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(entry.central?.compressed ?? entry.data.length),
      u32(entry.central?.uncompressed ?? entry.data.length),
      u16(name.length),
      u16(centralExtra.length),
      u16(0),
      u16(entry.central?.disk ?? 0),
      u16(0),
      u32(0),
      u32(entry.central?.offset ?? offsets[index]!),
      name,
      centralExtra,
    ]);
  });
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
  return Buffer.concat([...parts, directory, between, end]);
}

const ENTRIES: Entry[] = [
  { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
  { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
];
const withEntry = (index: number, change: Partial<Entry>) =>
  ENTRIES.map((entry, i) => (i === index ? { ...entry, ...change } : entry));

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

describe('zipStructureIssue: признаки ZIP64 и повреждённая структура (DATA-07)', () => {
  it('обычный архив и документы sample.docx, sample.xlsx — null; комментарий архива и выравнивание дополнительных полей не мешают', () => {
    expect(zipStructureIssue(zip(ENTRIES))).toBeNull();
    expect(zipStructureIssue(zip(ENTRIES, { comment: Buffer.from('IMBC') }))).toBeNull();
    expect(
      zipStructureIssue(
        zip(withEntry(0, { localExtra: Buffer.alloc(3), centralExtra: extra(0x5455, Buffer.alloc(5)) })),
      ),
    ).toBeNull();
    expect(zipStructureIssue(fixture('sample.docx'))).toBeNull();
    expect(zipStructureIssue(fixture('sample.xlsx'))).toBeNull();
  });

  it.each<[string, () => Buffer, ZipStructureIssue]>([
    // Запись конца каталога.
    ['нет записи конца каталога (усечённый архив)', () => zip(ENTRIES).subarray(0, -10), 'end_record_missing'],
    ['не ZIP', () => Buffer.from('%PDF-1.7 не архив'), 'end_record_missing'],
    [
      'комментарий длиннее остатка файла',
      () => zip(ENTRIES, { comment: Buffer.from('IMBC') }).subarray(0, -1),
      'end_record_missing',
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
    // Локальные заголовки.
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
      () => zip(withEntry(1, { central: { compressed: 1000 } })),
      'local_header_malformed',
    ],
    [
      'локальный: дополнительное поле длиннее своей области',
      () => zip(withEntry(1, { localExtra: Buffer.concat([u16(0x5455), u16(40), Buffer.alloc(4)]) })),
      'local_header_malformed',
    ],
    // Две записи каталога на одни данные (архивная бомба с перекрытием).
    ['данные записей перекрываются', () => zip(withEntry(1, { central: { offset: 0 } })), 'entries_overlap'],
  ])('%s — %s', (_name, build, issue) => {
    expect(zipStructureIssue(build())).toBe(issue);
  });

  it('архивы Python zipfile: запись с force_zip64 (ZIP64 только в локальном заголовке, каталог обычный) в DOCX и XLSX, каталог ZIP64, усечённый DOCX', () => {
    expect(zipStructureIssue(fixture('zip64-local.docx'))).toBe('zip64_local_values');
    expect(zipStructureIssue(fixture('zip64-local.xlsx'))).toBe('zip64_local_values');
    expect(zipStructureIssue(fixture('zip64-directory.docx'))).toBe('zip64_locator');
    expect(zipStructureIssue(fixture('truncated.docx'))).toBe('end_record_missing');
    // В каталоге zip64-local.docx размеры обычные: признак виден только по локальному заголовку.
    const local = fixture('zip64-local.docx');
    const central = local.lastIndexOf(Buffer.from('word/media/x.bin')) - 46;
    expect(local.readUInt32LE(central)).toBe(0x02014b50);
    expect(local.readUInt32LE(central + 20)).toBe(24);
    expect(local.readUInt16LE(central + 30)).toBe(0);
  });
});
